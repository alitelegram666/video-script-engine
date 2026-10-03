"""LLM gateway: one interface for free / keyed providers. Runs server-side (no CORS, no browser limits)."""
import asyncio, json, os, re
import httpx

PROVIDERS = {
    # free, no key (Pollinations anonymous tier, open-weight model)
    "free":       {"kind": "openai", "base": "https://text.pollinations.ai/openai", "full": True, "model": "openai", "key": False},
    "gemini":     {"kind": "gemini", "model": "gemini-3.5-flash", "key": True},
    "groq":       {"kind": "openai", "base": "https://api.groq.com/openai/v1", "model": "llama-3.3-70b-versatile", "key": True},
    "openrouter": {"kind": "openai", "base": "https://openrouter.ai/api/v1", "model": "openrouter/free", "key": True},
    "custom":     {"kind": "openai", "base": "", "model": "", "key": True},
}


class LLMError(Exception):
    pass


def _safe_base(url: str) -> str:
    """Block SSRF: custom base URLs must be public HTTPS hosts."""
    import ipaddress, socket
    from urllib.parse import urlparse
    u = urlparse(url)
    if u.scheme != "https" or not u.hostname:
        raise LLMError("Base URL باید با https شروع شود.")
    try:
        infos = socket.getaddrinfo(u.hostname, 443)
    except OSError:
        raise LLMError("آدرس Base URL پیدا نشد.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise LLMError("Base URL مجاز نیست.")
    return url


def parse_json(text: str):
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?", "", t, flags=re.I).strip()
    t = re.sub(r"```$", "", t).strip()
    a, b = t.find("{"), t.rfind("}")
    if a > -1 and b > a:
        t = t[a:b + 1]
    try:
        return json.loads(t)
    except Exception:
        # common small-model glitch: trailing commas
        t2 = re.sub(r",\s*([}\]])", r"\1", t)
        try:
            return json.loads(t2)
        except Exception:
            raise LLMError("پاسخ مدل JSON معتبر نبود.")


async def _dev_chat(system, user, temperature):
    # development-only provider (sandbox credential proxy) used for automated testing; never enabled in production
    from anthropic import AsyncAnthropic
    c = AsyncAnthropic()
    m = await c.messages.create(model="claude_haiku_4_5", max_tokens=8000, system=system,
                                messages=[{"role": "user", "content": user}])
    return parse_json("".join(b.text for b in m.content if getattr(b, "type", "") == "text"))


async def chat(provider: str, system: str, user: str, api_key: str = "", model: str = "",
               base_url: str = "", temperature: float = 0.7, retries: int = 2):
    if provider == "dev" and os.environ.get("VSE_DEV") == "1":
        return await _dev_chat(system, user, temperature)
    p = PROVIDERS.get(provider)
    if not p:
        raise LLMError(f"ارائه‌دهندهٔ ناشناخته: {provider}")
    if p["key"] and not api_key:
        raise LLMError("برای این ارائه‌دهنده کلید API لازم است.")
    model = model or p["model"]
    last = None
    async with httpx.AsyncClient(timeout=180) as cx:
        for attempt in range(retries + 1):
            try:
                if p["kind"] == "gemini":
                    r = await cx.post(
                        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                        headers={"x-goog-api-key": api_key},
                        json={"systemInstruction": {"parts": [{"text": system}]},
                              "contents": [{"role": "user", "parts": [{"text": user}]}],
                              "generationConfig": {"temperature": temperature, "responseMimeType": "application/json"}})
                    j = r.json() if r.content else {}
                    if r.status_code != 200:
                        raise LLMError(f"Gemini {r.status_code}: {j.get('error', {}).get('message', r.text[:200])}")
                    text = "".join(x.get("text", "") for x in j["candidates"][0]["content"]["parts"])
                else:
                    base = (_safe_base(base_url) if provider == "custom" else p["base"]).rstrip("/")
                    if not base:
                        raise LLMError("Base URL تنظیم نشده است.")
                    url = base if p.get("full") else f"{base}/chat/completions"
                    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                    body = {"model": model, "temperature": temperature,
                            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
                    if provider != "free":
                        body["response_format"] = {"type": "json_object"}
                    r = await cx.post(url, headers=headers, json=body)
                    if r.status_code in (402, 429):
                        raise LLMError("سهمیهٔ سرویس رایگان بدون کلید موقتاً پر شده است. چند دقیقه بعد دوباره امتحان کنید یا کلید رایگان Gemini را در تنظیمات وارد کنید.")
                    j = r.json() if r.content else {}
                    if r.status_code != 200:
                        msg = j.get("error", {}) if isinstance(j, dict) else {}
                        msg = msg.get("message") if isinstance(msg, dict) else str(msg)
                        raise LLMError(f"API {r.status_code}: {msg or r.text[:200]}")
                    text = j["choices"][0]["message"]["content"]
                return parse_json(text)
            except (LLMError, httpx.HTTPError, KeyError, IndexError) as e:
                last = e
                if attempt < retries:
                    await asyncio.sleep((8 if provider == "free" else 3) * (attempt + 1))
    raise LLMError(str(last))
