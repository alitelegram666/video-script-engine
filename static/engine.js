/* Video Script Engine V2 — core (UI-agnostic) */
const VSE = (() => {

  /* ---------------- STYLE ENGINE ---------------- */
  const STYLES = {
    Smart: { fa: 'هوشمند', desc: 'کارگردان خودش انتخاب می‌کند' },
    Stickman: {
      fa: 'استیکمن',
      keywords: ['stick figure'],
      bible: `STICKMAN STYLE BIBLE
- Simple black stick figures on white/very light solid background, hand-drawn line-art feel
- Emotion carried by exaggerated body language and gestures; faces = minimal dot eyes + line mouth
- Props are simple geometric shapes; no textures, no shading, no depth
- 2D flat camera only (no 3D angles); moves = pan, zoom-in, pop-in
- Transitions: wipe, slide, pop-in, line-draw reveal
- Humor via exaggerated, snappy stick-figure motion
- Every shot prompt MUST start with: "Simple stick figure animation, minimalist 2D line art, black lines on white background,"`
    },
    Cinematic: {
      fa: 'سینمایی',
      keywords: ['cinematic'],
      bible: `MOTION PICTURE (CINEMATIC) STYLE BIBLE
- Film-grade cinematography, dramatic motivated lighting, rim light, deep shadows
- Shallow depth of field, cinematic color grade (teal-orange or moody desaturated) — keep ONE grade for the whole video
- Specify shot type (ECU/CU/MS/WS/aerial), lens (24/35/50/85mm), and camera move (dolly, crane, handheld, tracking, slow push-in)
- Rule-of-thirds composition, visual metaphor over literal depiction
- Transitions: match cut, cross-dissolve, whip pan
- Every shot prompt MUST start with: "Cinematic film still in motion,"`
    },
    PaperCut: {
      fa: 'کاغذی (Paper Cut)',
      keywords: ['paper'],
      bible: `PAPER CUT STYLE BIBLE
- Layered handmade paper craft; visible cut edges and soft drop shadows between layers
- Stop-motion feel with slight frame jitter; flat cut-out characters with articulated joints
- Warm organic palette (kraft brown, cream, pastel accents) — fixed palette for whole video
- Depth via parallax: describe foreground / midground / background layers
- Transitions: paper slide, flip, tear, fold
- Sound: paper rustle, scissor snips, soft acoustic music
- Every shot prompt MUST start with: "Paper cutout stop-motion animation, layered paper craft with visible edges and drop shadows,"`
    },
    Pixar3D: {
      fa: 'سه‌بعدی پیکسارگونه',
      keywords: ['3d animat'],
      bible: `STYLIZED 3D (PIXAR-INSPIRED, NOT BRAND-IMITATING) STYLE BIBLE
- High-quality family-friendly stylized 3D animation; soft global illumination, subsurface scattering
- Expressive characters: big eyes, friendly rounded proportions, squash-and-stretch
- Vibrant but harmonious palette; material notes (soft fabric, glossy plastic, worn wood)
- Virtual 3D camera with depth and gentle parallax; depth-of-field shifts
- Never write the word "Pixar" or "Disney" in shot prompts; say "stylized 3D animated feature film look"
- Every shot prompt MUST start with: "Stylized 3D animated feature film look, soft global illumination,"`
    },
    Normal: {
      fa: 'عادی / توضیحی',
      keywords: ['presenter', 'screen', 'b-roll', 'footage', 'shot of'],
      bible: `NORMAL / EXPLAINER STYLE BIBLE
- Clean professional presentation: presenter to camera, screen recordings, simple slides, real-world B-roll
- Neutral well-lit environment, natural colors
- Smooth cuts, subtle punch-in zooms
- Visuals functional, never decorative
- Music: soft corporate or lo-fi
- Shot prompts describe realistic footage: "[Presenter / B-roll / screen], [content], [camera note]"`
    }
  };

  const INTENTS = ['Educational', 'Storytelling', 'Motivational', 'Marketing', 'Entertainment', 'News'];
  const HOOKS = ['curiosity', 'question', 'shock', 'contrarian', 'promise', 'story'];

  /* ---------------- MODEL ADAPTERS ---------------- */
  // clips = allowed clip lengths (seconds). Editable assumptions — check provider docs when they change.
  const MODELS = {
    veo:    { name: 'Google Veo 3.1', clips: [4, 6, 8], audio: true,  negativeField: false },
    kling:  { name: 'Kling',          clips: [5, 10],   audio: false, negativeField: true },
    runway: { name: 'Runway',         clips: [5, 10],   audio: false, negativeField: false },
    luma:   { name: 'Luma',           clips: [5, 9],    audio: false, negativeField: false },
    grok:   { name: 'Grok Imagine',   clips: [6],       audio: true,  negativeField: false },
    generic:{ name: 'سایر مدل‌ها (عمومی)', clips: [5, 10], audio: false, negativeField: true }
  };

  /* ---------------- DURATION INTELLIGENCE ---------------- */
  const SCENE_TABLE = {5:[1,1],10:[1,2],15:[2,2],20:[2,3],25:[3,3],30:[3,4],35:[3,4],40:[4,4],45:[4,5],50:[5,5],55:[5,6],60:[6,6]};

  function plan(duration, wps) {
    const d = Number(duration);
    const [minS, maxS] = SCENE_TABLE[d] || [Math.max(1, Math.round(d / 12)), Math.max(1, Math.round(d / 9))];
    const words = Math.round(d * wps);
    let structure, maxPoints, cta;
    if (d <= 10)      { maxPoints = 1; cta = false; structure = 'HOOK → PAYOFF (one single idea, the hook IS the content)'; }
    else if (d <= 20) { maxPoints = 1; cta = false; structure = 'HOOK → ONE CORE IDEA → PAYOFF'; }
    else if (d <= 35) { maxPoints = 2; cta = true;  structure = 'HOOK → POINT 1 → POINT 2 → PAYOFF (+ micro CTA ≤ 3s, optional)'; }
    else if (d <= 45) { maxPoints = 3; cta = true;  structure = 'HOOK → up to 3 POINTS → PAYOFF → CTA'; }
    else              { maxPoints = 4; cta = true;  structure = 'HOOK → SETUP (optional) → up to 4 POINTS → PAYOFF → CTA'; }
    const hookMax = d <= 10 ? d : 3;
    return { duration: d, minScenes: minS, maxScenes: maxS, words, wps, maxPoints, cta, structure, hookMax };
  }

  /* ---------------- PROMPT BUILDERS ---------------- */
  function stage1Prompt(input, p) {
    const styleList = Object.keys(STYLES).filter(s => s !== 'Smart').join(' | ');
    return {
      system: `You are CONTENT ANALYZER + DURATION PLANNER + SMART DIRECTOR inside a short-form video script engine.
You think like a senior short-form editor: ruthless compression, one idea per beat, strong hook in the first ${p.hookMax} seconds.
Return ONLY valid JSON, no markdown fences, no commentary.
All human-facing text fields in Persian (Farsi). Fields marked [en] in English.`,
      user: `INPUT
title: ${input.title}
description: ${input.desc || '(none — infer from title)'}
duration_seconds: ${p.duration}
requested_intent: ${input.intent}   (Smart = you decide from: ${INTENTS.join(', ')})
requested_style: ${input.style}     (Smart = you decide from: ${styleList})
platform: ${input.platform} (vertical 9:16)

HARD CONSTRAINTS FROM DURATION INTELLIGENCE
- Narrative structure: ${p.structure}
- Max number of POINT beats: ${p.maxPoints}. If the input contains more ideas, keep the strongest and list the rest in "dropped_ideas". Do NOT just shorten text — choose.
- Beat seconds must sum EXACTLY to ${p.duration}.
- HOOK beat ≤ ${p.hookMax}s and must be first.
- CTA allowed: ${p.cta ? 'yes (short)' : 'no'}.
- Do not invent statistics. Only list facts that are in the input or are common, verifiable knowledge; mark uncertain ones with "(نیاز به بررسی)".

JSON SCHEMA
{
  "analysis": {
    "core_message": "one sentence",
    "facts": ["..."],
    "emotional_angle": "...",
    "audience": "...",
    "visual_opportunities": ["[en] concrete visual ideas"],
    "cta": "..."
  },
  "direction": {
    "intent": "one of ${INTENTS.join('|')}",
    "style": "one of ${styleList}",
    "style_reason": "why this style fits (only if Smart)",
    "hook_type": "one of ${HOOKS.join('|')}",
    "hook_line": "the actual first spoken line",
    "tone": "..."
  },
  "structure": [ { "beat": "HOOK|SETUP|POINT|PAYOFF|CTA", "idea": "...", "seconds": 0 } ],
  "dropped_ideas": ["..."]
}`
    };
  }

  function stage2Prompt(input, p, s1, model, issues) {
    const style = s1.direction.style;
    const bible = (STYLES[style] || STYLES.Normal).bible;
    const m = MODELS[model];
    return {
      system: `You are SCENE ENGINE + STYLE DIRECTOR of a short-form video script engine.
You turn an approved creative plan into a production-ready script and AI-video prompts.
Return ONLY valid JSON, no markdown fences.
Persian (Farsi) for: voiceover, overlay, titles, thumbnail_fa. English for: every visual/camera/transition/sfx/prompt field.`,
      user: `APPROVED PLAN
${JSON.stringify(s1, null, 1)}

${bible}

PRODUCTION CONSTRAINTS
- Total duration: ${p.duration}s, ${p.minScenes}-${p.maxScenes} scenes, timeline continuous from 0 to ${p.duration} (each start = previous end).
- Scenes follow the plan's beats in order (a beat may span 2 scenes, never merge two POINTs into one scene).
- Voiceover total ≈ ${p.words} Persian words (±10%). Per scene ≈ seconds × ${p.wps} words. Natural spoken Persian, not formal written style.
- Scene 1 = HOOK; its voiceover is the hook_line (may be polished).
- Overlay text: max 6 Persian words per scene. Overlays are added in editing, NOT generated by the video model.
- CONSISTENCY LOCK: define every recurring character once in master.character_lock with fixed visual descriptors (age, body, clothing, colors, distinctive features). In every shot_prompt, re-describe the character using exactly those descriptors.
- shot_prompt: 25-90 English words, one continuous action, present tense, describes subject + action + setting + camera + lighting. No on-screen text, no logos, no subtitles. No Persian characters.
- Target video model: ${m.name}, clip lengths it supports: ${m.clips.join('/')}s.
${issues && issues.length ? `\nPREVIOUS ATTEMPT FAILED QUALITY CHECK — FIX ALL OF THESE:\n- ${issues.join('\n- ')}\n` : ''}
JSON SCHEMA
{
  "master": {
    "style": "[en] one paragraph style definition",
    "character_lock": [ { "name": "Short ID e.g. HERO", "description": "[en] fixed descriptors" } ],
    "world": "[en] setting rules",
    "lighting": "[en]",
    "color_palette": "[en]",
    "camera_rules": "[en]",
    "negative": "[en] things to avoid"
  },
  "scenes": [ {
    "n": 1, "start": 0, "end": 3, "beat": "HOOK",
    "visual": "[en] what appears on screen",
    "voiceover": "Persian narration",
    "camera": "[en]", "transition": "[en] transition OUT of this scene",
    "overlay": "Persian on-screen text",
    "sfx": "[en] music/sfx",
    "characters": ["HERO"],
    "shot_prompt": "[en]"
  } ],
  "thumbnail": { "fa": "Persian description", "prompt": "[en] image prompt, 9:16, no text" },
  "titles": ["3 Persian SEO title variations"],
  "hashtags": ["5 hashtags"]
}`
    };
  }

  function manualPrompt(input, p, model) {
    // single-shot prompt for manual mode (paste into any chat AI)
    const s1 = stage1Prompt(input, p);
    const styleBlock = input.style === 'Smart'
      ? Object.entries(STYLES).filter(([k]) => k !== 'Smart').map(([, v]) => v.bible).join('\n\n')
      : STYLES[input.style].bible;
    const m = MODELS[model];
    return `${s1.system}
You also act as SCENE ENGINE + STYLE DIRECTOR. Do both stages in ONE answer.

${s1.user}

STYLE BIBLE(S) — apply the one you choose:
${styleBlock}

PRODUCTION CONSTRAINTS
- ${p.minScenes}-${p.maxScenes} scenes, continuous timeline 0→${p.duration}s.
- Voiceover total ≈ ${p.words} Persian words (±10%).
- Overlay max 6 Persian words per scene.
- CONSISTENCY LOCK: fixed character descriptors in master.character_lock, repeated in every shot_prompt.
- shot_prompt: 25-90 English words, no on-screen text, no Persian characters.
- Target video model: ${m.name} (clips ${m.clips.join('/')}s).

OUTPUT: ONE JSON object that merges both schemas:
{ "analysis": {...}, "direction": {...}, "structure": [...], "dropped_ideas": [...],
  "master": { "style","character_lock":[{"name","description"}],"world","lighting","color_palette","camera_rules","negative" },
  "scenes": [ { "n","start","end","beat","visual","voiceover","camera","transition","overlay","sfx","characters":[],"shot_prompt" } ],
  "thumbnail": {"fa","prompt"}, "titles": [3], "hashtags": [5] }`;
  }

  /* ---------------- LLM CLIENT ---------------- */
  // All LLM calls go through our cloud backend (no CORS issues, works with the free no-key provider)
  const API = '__PORT_8000__'.startsWith('__') ? '' : '__PORT_8000__';
  async function callLLM(cfg, { system, user }, temperature = 0.8) {
    const res = await fetch(`${API}/api/llm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: cfg.provider, apiKey: cfg.apiKey || '', model: cfg.model || '', baseUrl: cfg.baseUrl || '', system, user, temperature })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.detail || `خطای سرور (${res.status})`);
    return j.data;
  }

  /* deterministic auto-fix: make the timeline continuous and exactly match the duration */
  function normalizeTimeline(out, duration) {
    const sc = Array.isArray(out.scenes) ? out.scenes : [];
    if (!sc.length) return out;
    let lens = sc.map(s => Math.max(0.5, Number(s.end) - Number(s.start) || duration / sc.length));
    const sum = lens.reduce((a, b) => a + b, 0);
    lens = lens.map(l => Math.max(1, Math.round((l * duration / sum) * 2) / 2));
    let diff = duration - lens.reduce((a, b) => a + b, 0);
    lens[lens.length - 1] = Math.max(0.5, lens[lens.length - 1] + diff);
    let t = 0;
    sc.forEach((s, i) => { s.n = i + 1; s.start = t; t = +(t + lens[i]).toFixed(2); s.end = t; if (!Array.isArray(s.characters)) s.characters = []; });
    if (sc[0] && !/HOOK/i.test(sc[0].beat || '')) sc[0].beat = 'HOOK';
    return out;
  }

  function parseJSON(text) {
    if (typeof text !== 'string') return text;
    let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a > -1 && b > a) t = t.slice(a, b + 1);
    try { return JSON.parse(t); }
    catch { throw new Error('پاسخ مدل JSON معتبر نبود. دوباره امتحان کنید.'); }
  }

  /* ---------------- QUALITY CHECKER ---------------- */
  const faWords = s => (s || '').replace(/[«»"'.,!?؟،؛:…\-–—()]/g, ' ').split(/\s+/).filter(Boolean).length;
  const enWords = s => (s || '').split(/\s+/).filter(Boolean).length;
  const hasPersian = s => /[\u0600-\u06FF]/.test(s || '');

  function qualityCheck(out, p) {
    const checks = [];
    const add = (id, label, ok, detail, level = 'error') => checks.push({ id, label, ok, detail, level: ok ? 'ok' : level });
    const sc = Array.isArray(out.scenes) ? out.scenes : [];
    const style = out.direction?.style;

    add('scenes', 'تعداد صحنه', sc.length >= p.minScenes && sc.length <= p.maxScenes,
      `${sc.length} صحنه (مجاز: ${p.minScenes}–${p.maxScenes})`, sc.length ? 'warn' : 'error');

    const end = sc.length ? Number(sc[sc.length - 1].end) : 0;
    add('duration', 'مدت کل', Math.abs(end - p.duration) <= 0.5, `پایان تایم‌لاین: ${end}s / هدف: ${p.duration}s`);

    let gaps = [];
    sc.forEach((s, i) => {
      const st = Number(s.start), en = Number(s.end);
      if (!(en > st)) gaps.push(`صحنه ${i + 1}: زمان نامعتبر`);
      if (i === 0 && st !== 0) gaps.push('صحنه ۱ از صفر شروع نمی‌شود');
      if (i > 0 && Math.abs(st - Number(sc[i - 1].end)) > 0.01) gaps.push(`فاصله/هم‌پوشانی بین صحنه ${i} و ${i + 1}`);
    });
    add('timing', 'پیوستگی زمان‌بندی', gaps.length === 0, gaps.join('، ') || 'پیوسته');

    const total = sc.reduce((a, s) => a + faWords(s.voiceover), 0);
    const ratio = p.words ? total / p.words : 1;
    add('vo', 'طول نریشن', ratio >= 0.8 && ratio <= 1.2,
      `${total} کلمه / هدف ≈ ${p.words} (${Math.round(ratio * 100)}٪)`, ratio >= 0.65 && ratio <= 1.35 ? 'warn' : 'error');

    const tight = sc.filter(s => faWords(s.voiceover) > (s.end - s.start) * p.wps * 1.35).map(s => s.n);
    add('vo_scene', 'جا شدن نریشن در هر صحنه', tight.length === 0,
      tight.length ? `نریشن برای زمان صحنهٔ ${tight.join('، ')} زیاد است` : 'همه صحنه‌ها قابل خواندن', 'warn');

    const h = sc[0];
    const hookOk = h && /HOOK/i.test(h.beat || '') && faWords(h.voiceover) > 0 && (h.end - h.start) <= Math.max(p.hookMax, 3.5) + 0.01;
    add('hook', 'وجود Hook', !!hookOk, hookOk ? `«${h.voiceover}»` : `صحنهٔ اول باید HOOK باشد و ≤ ${p.hookMax}s`);

    const kw = STYLES[style]?.keywords || [];
    const offStyle = sc.filter(s => kw.length && !kw.some(k => (s.shot_prompt || '').toLowerCase().includes(k))).map(s => s.n);
    add('style', 'یکپارچگی سبک', !!STYLES[style] && offStyle.length === 0,
      !STYLES[style] ? `سبک نامعتبر: ${style}` : offStyle.length ? `صحنهٔ ${offStyle.join('، ')} نشانهٔ سبک ${STYLES[style].fa} را ندارد` : `همه Shotها ${STYLES[style].fa}`);

    const lock = (out.master?.character_lock || []).map(c => (c.name || '').trim()).filter(Boolean);
    const badChar = [];
    sc.forEach(s => (s.characters || []).forEach(c => { if (!lock.includes(c)) badChar.push(`${c}@${s.n}`); }));
    add('chars', 'یکپارچگی شخصیت', badChar.length === 0,
      badChar.length ? `شخصیت تعریف‌نشده: ${badChar.join('، ')}` : `${lock.length} شخصیت قفل‌شده`);

    const points = (out.structure || []).filter(b => /POINT/i.test(b.beat || '')).length;
    add('lean', 'بدون اضافه‌گویی', points <= p.maxPoints, `${points} نکته / حداکثر ${p.maxPoints}`);

    const bad = [];
    sc.forEach(s => {
      const w = enWords(s.shot_prompt);
      if (!s.shot_prompt) bad.push(`صحنه ${s.n}: خالی`);
      else if (hasPersian(s.shot_prompt)) bad.push(`صحنه ${s.n}: حروف فارسی در پرامپت`);
      else if (w < 15 || w > 120) bad.push(`صحنه ${s.n}: ${w} کلمه`);
      if (/\b(pixar|disney)\b/i.test(s.shot_prompt || '')) bad.push(`صحنه ${s.n}: نام برند`);
    });
    add('prompt', 'قابل‌استفاده بودن پرامپت', bad.length === 0, bad.join('، ') || 'همه آماده');

    const longOv = sc.filter(s => faWords(s.overlay) > 7).map(s => s.n);
    add('overlay', 'کوتاهی متن روی تصویر', longOv.length === 0,
      longOv.length ? `متن طولانی در صحنهٔ ${longOv.join('، ')}` : 'خوانا', 'warn');

    const errors = checks.filter(c => c.level === 'error');
    const warns = checks.filter(c => c.level === 'warn');
    return { checks, ready: errors.length === 0, errors, warns };
  }

  /* ---------------- MODEL ADAPTER ---------------- */
  function splitClips(sec, allowed) {
    // pick smallest allowed clip >= sec; otherwise split into chunks of max
    const max = Math.max(...allowed);
    const out = [];
    let left = sec;
    while (left > 0.01) {
      const fit = allowed.filter(c => c >= left).sort((a, b) => a - b)[0];
      if (fit) { out.push({ gen: fit, use: +left.toFixed(2) }); break; }
      out.push({ gen: max, use: max }); left -= max;
    }
    return out;
  }

  function adapt(out, modelKey, platform) {
    const m = MODELS[modelKey];
    const ms = out.master || {};
    const chars = Object.fromEntries((ms.character_lock || []).map(c => [c.name, c.description]));
    const shots = [];
    (out.scenes || []).forEach(s => {
      const dur = Number(s.end) - Number(s.start);
      const parts = splitClips(dur, m.clips);
      const charText = (s.characters || []).map(c => chars[c] ? `${c}: ${chars[c]}` : '').filter(Boolean).join('; ');
      parts.forEach((pt, i) => {
        const cont = parts.length > 1 ? (i === 0 ? ' (part 1 of ' + parts.length + ')' : ` (continuation ${i + 1}/${parts.length}, same framing and characters as previous clip)`) : '';
        let prompt;
        const base = s.shot_prompt + cont;
        const look = [ms.lighting && `Lighting: ${ms.lighting}`, ms.color_palette && `Palette: ${ms.color_palette}`].filter(Boolean).join('. ');
        switch (modelKey) {
          case 'veo':
            prompt = `${base}\nCharacters: ${charText || 'none'}\nCamera: ${s.camera}\n${look}\nAudio: ${s.sfx}; no spoken dialogue, no narration (voiceover added in edit).\nNo on-screen text, no subtitles, no logos. Vertical 9:16.`;
            break;
          case 'kling':
            prompt = `${base} ${charText ? 'Characters: ' + charText + '.' : ''} Camera: ${s.camera}. ${look}. Vertical 9:16.`;
            break;
          case 'runway':
            prompt = `${s.camera}: ${base} ${charText ? '(' + charText + ')' : ''}`.trim();
            break;
          case 'grok':
            prompt = `${base} ${charText ? 'Characters: ' + charText + '.' : ''} Camera: ${s.camera}. Sound: ${s.sfx}, no speech. Vertical 9:16, no text.`;
            break;
          default:
            prompt = `${base} ${charText ? 'Characters: ' + charText + '.' : ''} Camera: ${s.camera}. ${look}. Vertical 9:16, no on-screen text.`;
        }
        shots.push({
          id: `S${String(s.n).padStart(2, '0')}${parts.length > 1 ? String.fromCharCode(97 + i) : ''}`,
          scene: s.n, generate: pt.gen, use: pt.use, prompt: prompt.replace(/\s+\n/g, '\n').trim(),
          negative: m.negativeField ? (ms.negative || 'text, watermark, subtitles, logo, distorted hands, extra limbs') : null
        });
      });
    });
    const master = [
      `MASTER PROMPT — ${m.name} — ${platform} (9:16)`,
      `STYLE: ${ms.style || ''}`,
      `CHARACTERS (CONSISTENCY LOCK):\n${(ms.character_lock || []).map(c => `- ${c.name}: ${c.description}`).join('\n') || '- none'}`,
      `WORLD: ${ms.world || ''}`,
      `LIGHTING: ${ms.lighting || ''}`,
      `COLOR PALETTE: ${ms.color_palette || ''}`,
      `CAMERA RULES: ${ms.camera_rules || ''}`,
      `AVOID: ${ms.negative || ''}`
    ].join('\n');
    return { model: m, master, shots };
  }

  /* ---------------- PIPELINE ---------------- */
  async function run(input, cfg, onStep) {
    const p = plan(input.duration, input.wps);
    onStep('analyze');
    const s1 = await callLLM(cfg, stage1Prompt(input, p), 0.7);
    if (!s1.direction) throw new Error('مرحلهٔ تحلیل خروجی ناقص داد.');
    if (input.style !== 'Smart') s1.direction.style = input.style;
    if (!STYLES[s1.direction.style] || s1.direction.style === 'Smart') s1.direction.style = 'Normal';
    onStep('direct');
    onStep('scenes');
    let s2 = await callLLM(cfg, stage2Prompt(input, p, s1, input.target), 0.8);
    let out = normalizeTimeline({ ...s1, ...s2 }, p.duration);
    onStep('qc');
    let qc = qualityCheck(out, p);
    let repaired = false;
    if (!qc.ready && input.autoRepair) {
      onStep('scenes');
      const issues = qc.errors.concat(qc.warns).map(c => `${c.id}: ${c.detail}`);
      s2 = await callLLM(cfg, stage2Prompt(input, p, s1, input.target, issues), 0.5);
      out = normalizeTimeline({ ...s1, ...s2 }, p.duration);
      onStep('qc');
      qc = qualityCheck(out, p);
      repaired = true;
    }
    onStep('adapt');
    return { input, plan: p, out, qc, repaired, adapted: adapt(out, input.target, input.platform) };
  }

  function fromManual(input, json) {
    const p = plan(input.duration, input.wps);
    const out = normalizeTimeline(parseJSON(json), p.duration);
    if (input.style !== 'Smart' && out.direction) out.direction.style = input.style;
    return { input, plan: p, out, qc: qualityCheck(out, p), repaired: false, adapted: adapt(out, input.target, input.platform) };
  }

  return { API, STYLES, MODELS, plan, run, fromManual, manualPrompt, adapt, qualityCheck, faWords };
})();
