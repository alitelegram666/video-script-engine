"""Subtitle engine: word timings -> cues -> SRT / VTT / ASS, + script-guided correction of ASR output."""
import re, difflib

PUNCT_END = re.compile(r"[.!?؟…]$")
PUNCT_SOFT = re.compile(r"[،,;؛:]$")


def norm(w: str) -> str:
    w = w.replace("\u200c", "").replace("ي", "ی").replace("ك", "ک").replace("ة", "ه")
    w = re.sub(r"[^\w]", "", w)
    return w.lower()


def tokenize(text: str):
    return [t for t in re.split(r"\s+", (text or "").strip()) if t]


def align_to_script(asr_words, script_text):
    """Replace ASR words with the known script words while keeping ASR timings.
    asr_words: [{'start','end','text'}]. Returns corrected list in script wording."""
    script = tokenize(script_text)
    if not script or not asr_words:
        return asr_words
    # Compare on joined-normalized character streams per word to survive split/merge (e.g. "می زنی" vs "می‌زنی")
    a = [norm(w["text"]) for w in asr_words]
    b = [norm(w) for w in script]
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    out = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                w = asr_words[i1 + k]
                out.append({"start": w["start"], "end": w["end"], "text": script[j1 + k]})
        elif op in ("replace", "insert"):
            if op == "replace":
                t0, t1 = asr_words[i1]["start"], asr_words[i2 - 1]["end"]
            else:  # script words with no audio match: squeeze between neighbours
                t0 = out[-1]["end"] if out else (asr_words[i1]["start"] if i1 < len(asr_words) else 0)
                t1 = asr_words[i1]["start"] if i1 < len(asr_words) else t0 + 0.3 * (j2 - j1)
                if t1 <= t0:
                    t1 = t0 + 0.25 * (j2 - j1)
            words = script[j1:j2]
            total = sum(max(len(norm(w)), 1) for w in words)
            cur = t0
            for w in words:
                d = (t1 - t0) * max(len(norm(w)), 1) / total
                out.append({"start": round(cur, 3), "end": round(cur + d, 3), "text": w})
                cur += d
        # 'delete' = ASR hallucination/extra words → dropped
    # monotonic fix
    for i in range(1, len(out)):
        if out[i]["start"] < out[i - 1]["end"]:
            out[i]["start"] = out[i - 1]["end"]
        if out[i]["end"] < out[i]["start"]:
            out[i]["end"] = out[i]["start"] + 0.05
    return out


def group(words, max_words=4, max_chars=26, max_dur=2.6, min_gap_break=0.45):
    cues, cur = [], []

    def flush():
        if cur:
            cues.append({"start": cur[0]["start"], "end": cur[-1]["end"], "text": " ".join(w["text"] for w in cur)})
            cur.clear()

    for i, w in enumerate(words):
        if cur:
            text_len = len(" ".join(x["text"] for x in cur)) + 1 + len(w["text"])
            gap = w["start"] - cur[-1]["end"]
            if (len(cur) >= max_words or text_len > max_chars or w["end"] - cur[0]["start"] > max_dur
                    or gap > min_gap_break):
                flush()
        cur.append(w)
        if PUNCT_END.search(w["text"]) or (PUNCT_SOFT.search(w["text"]) and len(cur) >= 2):
            flush()
    flush()
    # merge orphan one-word cues (e.g. "نه؟") into the previous cue when they are close
    merged = []
    for c in cues:
        if merged and len(c["text"].split()) == 1 and c["start"] - merged[-1]["end"] < 0.35 \
                and len(merged[-1]["text"].split()) < max_words + 1 and c["end"] - merged[-1]["start"] <= max_dur + 0.8:
            merged[-1]["end"] = c["end"]; merged[-1]["text"] += " " + c["text"]
        else:
            merged.append(dict(c))
    cues = merged
    # keep each cue on screen until the next one starts (no flicker), max +0.6s
    for i in range(len(cues) - 1):
        nxt = cues[i + 1]["start"]
        if 0 < nxt - cues[i]["end"] <= 0.6:
            cues[i]["end"] = nxt
    return cues


def _ts(t, sep=","):
    t = max(0, t)
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d}{sep}{int(round((s - int(s)) * 1000)) % 1000:03d}"


RLE, PDF = "\u202b", "\u202c"  # RTL embedding so players show Persian punctuation correctly


def to_srt(cues, rtl=True):
    return "\n".join(f"{i}\n{_ts(c['start'])} --> {_ts(c['end'])}\n{RLE + c['text'] + PDF if rtl else c['text']}\n"
                     for i, c in enumerate(cues, 1))


def to_vtt(cues):
    return "WEBVTT\n\n" + "\n".join(f"{_ts(c['start'], '.')} --> {_ts(c['end'], '.')}\n{c['text']}\n" for c in cues)


STYLES = {
    # name: (font size @1080x1920, primary, outline colour, outline px, box?)
    "shorts": dict(size=92, primary="&H00FFFFFF", outline="&H00000000", bord=6, shadow=2, box=False, marginv=560),
    "yellow": dict(size=92, primary="&H0000E5FF", outline="&H00000000", bord=6, shadow=2, box=False, marginv=560),
    "box":    dict(size=70, primary="&H00FFFFFF", outline="&H96000000", bord=18, shadow=0, box=True, marginv=480),
    "minimal":dict(size=58, primary="&H00FFFFFF", outline="&H64000000", bord=3, shadow=1, box=False, marginv=220),
}


def to_ass(cues, style="shorts", width=1080, height=1920, font="Vazirmatn"):
    s = STYLES.get(style, STYLES["shorts"])
    scale = height / 1920
    border_style = 3 if s["box"] else 1

    def at(t):
        h, rem = divmod(max(0, t), 3600)
        m, sec = divmod(rem, 60)
        return f"{int(h)}:{int(m):02d}:{sec:05.2f}"

    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,{font},{round(s['size']*scale)},{s['primary']},&H000000FF,{s['outline']},&H80000000,-1,0,0,0,100,100,0,0,{border_style},{round(s['bord']*scale)},{s['shadow']},2,{round(60*scale)},{round(60*scale)},{round(s['marginv']*scale)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    pop = r"{\fad(60,40)\t(0,90,\fscx106\fscy106)\t(90,160,\fscx100\fscy100)}"
    rlm = "\u200f"  # right-to-left mark: keeps Persian punctuation on the correct (left) side in libass
    fix = lambda t: (rlm + t + rlm) if re.search(r"[\u0600-\u06FF]", t) else t
    lines = [f"Dialogue: 0,{at(c['start'])},{at(c['end'])},Main,,0,0,0,,{pop}{fix(c['text'])}" for c in cues]
    return head + "\n".join(lines) + "\n"
