"""Video Script Engine — Cloud. FastAPI backend: LLM gateway, Persian TTS + subtitles, ASR subtitles, burn-in render."""
import asyncio, json, os, shutil, subprocess, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from core import llm, subs, audio

ROOT = Path(__file__).parent
WORK = Path(os.environ.get("VSE_WORK", "/tmp/vse-jobs"))
WORK.mkdir(parents=True, exist_ok=True)
FONTS = ROOT / "fonts"
MAX_UPLOAD = 300 * 1024 * 1024
DEFAULT_ASR = os.environ.get("VSE_ASR_MODEL", "turbo")

app = FastAPI(title="Video Script Engine Cloud")
POOL = ThreadPoolExecutor(max_workers=1)  # CPU-heavy jobs run one at a time on a 2-vCPU box
JOBS: dict[str, dict] = {}
_HITS: dict[str, list] = {}


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    # simple per-IP limit on mutating endpoints (60 requests / 10 min)
    if request.method == "POST":
        ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
        now = time.time()
        hits = [t for t in _HITS.get(ip, []) if now - t < 600]
        if len(hits) >= 60:
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "تعداد درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره امتحان کنید."}, status_code=429)
        hits.append(now); _HITS[ip] = hits
    return await call_next(request)


def new_job(kind):
    jid = uuid.uuid4().hex[:12]
    d = WORK / jid
    d.mkdir(parents=True)
    JOBS[jid] = {"id": jid, "kind": kind, "status": "queued", "progress": 0.0, "created": time.time(), "result": None, "error": None}
    return jid, d


def cleanup():
    now = time.time()
    for jid, j in list(JOBS.items()):
        if now - j["created"] > 3 * 3600:
            shutil.rmtree(WORK / jid, ignore_errors=True)
            JOBS.pop(jid, None)


def write_subs(d: Path, words, style, max_words, width=1080, height=1920):
    cues = subs.group(words, max_words=max_words)
    (d / "words.json").write_text(json.dumps(words, ensure_ascii=False))
    (d / "subtitles.srt").write_text(subs.to_srt(cues), encoding="utf-8")
    (d / "subtitles.vtt").write_text(subs.to_vtt(cues), encoding="utf-8")
    (d / "subtitles.ass").write_text(subs.to_ass(cues, style, width, height), encoding="utf-8")
    return cues


# ---------------- health ----------------
@app.get("/api/health")
def health():
    return {"ok": True, "asr_loaded": list(audio._models.keys()), "jobs": len(JOBS), "voices": audio.VOICES,
            "providers": list(llm.PROVIDERS.keys()), "dev": os.environ.get("VSE_DEV") == "1"}


@app.on_event("startup")
def warm():
    # download/load the ASR model in background so the first transcription is fast
    if os.environ.get("VSE_WARM", "1") == "1":
        threading.Thread(target=lambda: audio.get_model(DEFAULT_ASR), daemon=True).start()


# ---------------- LLM ----------------
class LLMReq(BaseModel):
    provider: str = "free"
    apiKey: str = ""
    model: str = ""
    baseUrl: str = ""
    system: str
    user: str
    temperature: float = 0.7


@app.post("/api/llm")
async def llm_call(r: LLMReq):
    try:
        return {"ok": True, "data": await llm.chat(r.provider, r.system, r.user, r.apiKey, r.model, r.baseUrl, r.temperature)}
    except llm.LLMError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # never leak a bare 500 to the UI
        raise HTTPException(400, f"خطای موتور متن: {type(e).__name__}: {str(e)[:200]}")


# ---------------- TTS + subtitles (from script) ----------------
class TTSReq(BaseModel):
    text: str
    voice: str = "fa-IR-FaridNeural"
    rate: int = 0
    target: float = 0          # target seconds; if autofit, speed is adjusted to land near it
    autofit: bool = True
    style: str = "shorts"
    max_words: int = 4


@app.post("/api/tts")
async def tts_job(r: TTSReq):
    cleanup()
    if not r.text.strip():
        raise HTTPException(400, "متن نریشن خالی است.")
    if r.voice not in audio.VOICES:
        raise HTTPException(400, "صدای نامعتبر")
    jid, d = new_job("tts")
    mp3 = str(d / "voiceover.mp3")
    try:
        rate = max(-30, min(40, r.rate))
        words = await audio.tts(r.text, r.voice, rate, mp3)
        dur = audio.ffprobe_duration(mp3)
        fitted = False
        if r.autofit and r.target and dur and abs(dur - r.target) / r.target > 0.06:
            # speech rate scales ~linearly with duration
            new_rate = int(round(((dur / r.target) * (100 + rate)) - 100))
            new_rate = max(-30, min(30, new_rate))
            if new_rate != rate:
                rate = new_rate
                words = await audio.tts(r.text, r.voice, rate, mp3)
                dur = audio.ffprobe_duration(mp3)
                fitted = True
        words = subs.align_to_script(words, r.text)  # restore exact script wording + punctuation
        cues = write_subs(d, words, r.style, r.max_words)
        res = {"duration": round(dur, 2), "rate": rate, "fitted": fitted, "words": len(words), "cues": cues,
               "files": ["voiceover.mp3", "subtitles.srt", "subtitles.vtt", "subtitles.ass"]}
        JOBS[jid].update(status="done", progress=1, result=res)
        return {"job": jid, **res}
    except Exception as e:
        JOBS[jid].update(status="error", error=str(e))
        raise HTTPException(400, f"ساخت صدا ناموفق بود: {e}")


# ---------------- ASR subtitles (from uploaded audio/video) ----------------
async def save_upload(f: UploadFile, dest: Path):
    size = 0
    with open(dest, "wb") as out:
        while chunk := await f.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD:
                raise HTTPException(413, "فایل بزرگ‌تر از ۳۰۰ مگابایت است.")
            out.write(chunk)


@app.post("/api/transcribe")
async def transcribe_job(file: UploadFile = File(...), model: str = Form(DEFAULT_ASR), language: str = Form("fa"),
                         script: str = Form(""), style: str = Form("shorts"), max_words: int = Form(4)):
    cleanup()
    if model not in ("small", "medium", "turbo", "large-v3"):
        raise HTTPException(400, "مدل نامعتبر")
    jid, d = new_job("transcribe")
    ext = Path(file.filename or "in.bin").suffix[:8] or ".bin"
    src = d / f"source{ext}"
    await save_upload(file, src)

    def work():
        j = JOBS[jid]
        try:
            j["status"] = "running"
            j["stage"] = "loading_model"
            words, lang, dur = audio.transcribe(str(src), model, language, progress=lambda p: j.update(progress=round(p, 3), stage="transcribing"))
            raw = list(words)
            corrected = False
            if script.strip():
                words = subs.align_to_script(words, script)
                corrected = True
            size = audio.video_size(str(src)) or (1080, 1920)
            cues = write_subs(d, words, style, max_words, *size)
            (d / "raw_transcript.txt").write_text(" ".join(w["text"] for w in raw), encoding="utf-8")
            j.update(status="done", progress=1, result={
                "language": lang, "duration": round(dur, 2), "words": len(words), "corrected": corrected,
                "cues": cues, "raw": " ".join(w["text"] for w in raw), "video": bool(audio.video_size(str(src))),
                "files": ["subtitles.srt", "subtitles.vtt", "subtitles.ass", "raw_transcript.txt"]})
        except Exception as e:
            j.update(status="error", error=str(e))

    POOL.submit(work)
    return {"job": jid}


# ---------------- render: burn subtitles (+ optional voiceover) into video ----------------
@app.post("/api/render")
async def render_job(subs_job: str = Form(...), files: list[UploadFile] | None = File(None), use_source: bool = Form(False),
                     mux_voice: bool = Form(True), style: str = Form("shorts"), max_words: int = Form(4)):
    """Burn subtitles into one video, or join several clips (e.g. Veo shots in order) into one 9:16 short."""
    cleanup()
    sj = JOBS.get(subs_job)
    if not sj or sj["status"] != "done":
        raise HTTPException(400, "اول زیرنویس را بسازید.")
    sd = WORK / subs_job
    jid, d = new_job("render")
    srcs = []
    if use_source:
        src = next(sd.glob("source.*"), None)
        if not src:
            raise HTTPException(400, "ویدیوی منبع پیدا نشد.")
        srcs = [src]
    else:
        files = [f for f in (files or []) if f and f.filename]
        if not files:
            raise HTTPException(400, "ویدیو را آپلود کنید.")
        if len(files) > 20:
            raise HTTPException(400, "حداکثر ۲۰ کلیپ.")
        for i, f in enumerate(files):
            p = d / f"clip{i:02d}{Path(f.filename).suffix[:8] or '.mp4'}"
            await save_upload(f, p)
            srcs.append(p)
    voice = sd / "voiceover.mp3"

    def work():
        j = JOBS[jid]
        try:
            j["status"] = "running"
            sizes = [audio.video_size(str(p)) for p in srcs]
            if not all(sizes):
                raise RuntimeError("یکی از فایل‌ها ویدیوی معتبر نیست.")
            multi = len(srcs) > 1
            W, H = (1080, 1920) if multi else sizes[0]
            words = json.loads((sd / "words.json").read_text())
            write_subs(d, words, style, max_words, W, H)
            ass = (d / "subtitles.ass").as_posix()
            total = sum(audio.ffprobe_duration(str(p)) for p in srcs)
            use_voice = mux_voice and voice.exists()
            if use_voice:
                total = min(total, audio.ffprobe_duration(str(voice))) or total
            cmd = ["ffmpeg", "-y", "-nostdin", "-v", "error"]
            for p in srcs:
                cmd += ["-i", str(p)]
            if use_voice:
                cmd += ["-i", str(voice)]
            sub = f"ass={ass}:fontsdir={FONTS.as_posix()}"
            if multi:
                parts = "".join(f"[{i}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v{i}];" for i in range(len(srcs)))
                fc = parts + "".join(f"[v{i}]" for i in range(len(srcs))) + f"concat=n={len(srcs)}:v=1:a=0[vc];[vc]{sub}[vo]"
                cmd += ["-filter_complex", fc, "-map", "[vo]"]
            else:
                cmd += ["-vf", sub, "-map", "0:v:0"]
            if use_voice:
                cmd += ["-map", f"{len(srcs)}:a:0", "-shortest"]
            elif not multi:
                cmd += ["-map", "0:a?"]
            cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-progress", "pipe:1", str(d / "final.mp4")]
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            for line in p.stdout:
                if line.startswith("out_time_ms=") and total:
                    try:
                        j["progress"] = min(0.99, int(line.split("=")[1]) / 1e6 / total)
                    except ValueError:
                        pass
            p.wait()
            if p.returncode != 0:
                raise RuntimeError("ffmpeg: " + p.stderr.read()[-400:])
            j.update(status="done", progress=1, result={"files": ["final.mp4", "subtitles.ass"], "clips": len(srcs),
                                                       "duration": round(audio.ffprobe_duration(str(d / 'final.mp4')), 2)})
        except Exception as e:
            j.update(status="error", error=str(e))

    POOL.submit(work)
    return {"job": jid}


# ---------------- jobs & files ----------------
@app.get("/api/job/{jid}")
def job(jid: str):
    j = JOBS.get(jid)
    if not j:
        raise HTTPException(404, "کار پیدا نشد (ممکن است منقضی شده باشد).")
    return j


@app.get("/api/file/{jid}/{name}")
def file(jid: str, name: str):
    if jid not in JOBS or "/" in name or ".." in name:
        raise HTTPException(404)
    p = WORK / jid / name
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, filename=name)


if (ROOT / "static").exists():
    app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
