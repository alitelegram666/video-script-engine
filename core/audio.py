"""Speech: free Persian TTS (edge-tts, word timings) and ASR (faster-whisper on CPU)."""
import subprocess, threading, json
import numpy as np
import edge_tts

VOICES = {"fa-IR-FaridNeural": "فرید (مرد)", "fa-IR-DilaraNeural": "دلارا (زن)"}
_models, _lock = {}, threading.Lock()


def ffprobe_duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
                       capture_output=True, text=True)
    try:
        return float(json.loads(r.stdout)["format"]["duration"])
    except Exception:
        return 0.0


def video_size(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                        "-of", "json", path], capture_output=True, text=True)
    try:
        s = json.loads(r.stdout)["streams"][0]
        return int(s["width"]), int(s["height"])
    except Exception:
        return None


async def tts(text, voice, rate_pct, out_mp3):
    rate = f"{'+' if rate_pct >= 0 else ''}{int(rate_pct)}%"
    c = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    words = []
    with open(out_mp3, "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                st = ch["offset"] / 1e7
                words.append({"start": round(st, 3), "end": round(st + ch["duration"] / 1e7, 3), "text": ch["text"]})
    return words


def get_model(name):
    from faster_whisper import WhisperModel
    with _lock:
        if name not in _models:
            _models[name] = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=2)
        return _models[name]


def load_audio(path):
    b = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                       capture_output=True).stdout
    if not b:
        raise RuntimeError("فایل صوتی/ویدیویی قابل خواندن نبود.")
    return np.frombuffer(b, np.int16).astype(np.float32) / 32768


def transcribe(path, model="turbo", language="fa", progress=None):
    audio = load_audio(path)
    dur = len(audio) / 16000
    m = get_model(model)
    segs, info = m.transcribe(audio, language=language or None, word_timestamps=True, vad_filter=True,
                              beam_size=1, condition_on_previous_text=False)
    words = []
    for s in segs:
        for w in (s.words or []):
            t = w.word.strip()
            if t:
                words.append({"start": round(w.start, 3), "end": round(w.end, 3), "text": t})
        if progress and dur:
            progress(min(0.99, s.end / dur))
    return words, info.language, dur
