---
title: Video Script Engine
emoji: 🎬
colorFrom: red
colorTo: gray
sdk: docker
app_port: 7860
---
# Video Script Engine — Cloud

موتور فارسی برای اسکریپت ویدیوی کوتاه، پرامپت Veo/Kling، نریشن صوتی و زیرنویس خودکار. همه‌چیز روی سرور اجرا می‌شود.

## اجزا (همه متن‌باز و رایگان)
| بخش | ابزار |
|---|---|
| مغز اسکریپت | Gemini (کلید رایگان) / Groq / OpenRouter / Pollinations (بدون کلید، محدود) |
| نریشن فارسی | edge-tts — صداهای fa-IR-FaridNeural و fa-IR-DilaraNeural با زمان‌بندی کلمه‌به‌کلمه |
| تشخیص گفتار | faster-whisper (مدل turbo، int8 روی CPU) |
| اصلاح زیرنویس | هم‌ترازسازی با متن اسکریپت (difflib)؛ کلمات اشتباه Whisper با متن درست جایگزین می‌شوند |
| زیرنویس | SRT / VTT / ASS با فونت Vazirmatn و پشتیبانی کامل راست‌به‌چپ |
| ویدیوی نهایی | ffmpeg + libass: اتصال کلیپ‌ها، تبدیل به ۹:۱۶، نریشن و زیرنویس سوخته |

## اجرا روی Hugging Face Space (رایگان)
1. در huggingface.co یک Space جدید با SDK = Docker و سخت‌افزار CPU Basic (رایگان) بسازید.
2. همهٔ فایل‌های این پوشه را آپلود کنید.
3. بعد از build، آدرس Space آماده است.

## اجرای محلی
```
pip install -r requirements.txt   # ffmpeg هم لازم است
python -m uvicorn app:app --port 8000
```
متغیرها: `VSE_ASR_MODEL` (پیش‌فرض turbo)، `VSE_WARM=0` برای بارگذاری تنبل مدل.
