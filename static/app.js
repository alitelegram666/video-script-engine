(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fa = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const cfg = { provider: 'gemini', apiKey: '', model: '', baseUrl: '' };
  const API = VSE.API;
  let style = 'Smart';
  let last = null;

  // populate controls
  for (let d = 5; d <= 60; d += 5) $('duration').insertAdjacentHTML('beforeend', `<option value="${d}" ${d === 30 ? 'selected' : ''}>${fa(d)} ثانیه</option>`);
  Object.entries(VSE.MODELS).forEach(([k, m]) => $('target').insertAdjacentHTML('beforeend', `<option value="${k}">${m.name}</option>`));
  Object.entries(VSE.STYLES).forEach(([k, s]) => {
    $('styleChips').insertAdjacentHTML('beforeend', `<button type="button" class="chip ${k === style ? 'on' : ''}" data-style="${k}">${s.fa}</button>`);
  });
  $('styleChips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    style = b.dataset.style;
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
  });

  // settings
  const PNAME = { dev: 'DEV', free: 'رایگان بدون کلید (محدود)', gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter', custom: 'سفارشی' };
  const updHint = () => {
    $('modeHint').textContent = `موتور متن: ${PNAME[cfg.provider]}${cfg.model ? ' · ' + cfg.model : ''} · ${cfg.apiKey || cfg.provider === 'dev' ? 'کلید وارد شده' : 'کلید وارد نشده'} — از «تنظیمات هوش مصنوعی»`;
  };
  const syncDlg = () => {
    const p = $('provider').value;
    $('keyWrap').hidden = p === 'dev'; $('modelWrap').hidden = p === 'dev'; $('baseWrap').hidden = p !== 'custom';
    $('model').placeholder = { gemini: 'gemini-3.5-flash', groq: 'llama-3.3-70b-versatile', openrouter: 'نام مدل :free', custom: 'model-id' }[p] || '';
  };
  $('settingsBtn').onclick = () => {
    $('provider').value = cfg.provider; $('apiKey').value = cfg.apiKey; $('model').value = cfg.model; $('baseUrl').value = cfg.baseUrl;
    syncDlg(); $('settings').showModal();
  };
  $('provider').onchange = syncDlg;
  $('settings').addEventListener('close', () => {
    cfg.provider = $('provider').value; cfg.apiKey = $('apiKey').value.trim();
    cfg.model = $('model').value.trim(); cfg.baseUrl = $('baseUrl').value.trim();
    updHint();
  });
  updHint();

  // server status
  async function ping() {
    try {
      const r = await fetch(`${API}/api/health`); const j = await r.json();
      $('status').className = 'status ok';
      if (j.dev && !$('provider').querySelector('[value=dev]')) $('provider').insertAdjacentHTML('beforeend', '<option value="dev">DEV (test only)</option>');
      $('status').querySelector('span').textContent = j.asr_loaded.length ? 'سرور ابری آماده' : 'سرور آماده · مدل گفتار در حال بارگذاری';
      if (!j.asr_loaded.length) setTimeout(ping, 8000);
    } catch { $('status').className = 'status bad'; $('status').querySelector('span').textContent = 'سرور در دسترس نیست'; setTimeout(ping, 6000); }
  }
  ping();

  // modes
  $('modes').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#modes button').forEach(x => x.classList.toggle('on', x === b));
    $('mode-script').hidden = b.dataset.mode !== 'script'; $('mode-subs').hidden = b.dataset.mode !== 'subs';
  });
  const SUBSTYLES = { shorts: 'شورتس — سفید با حاشیهٔ مشکی', yellow: 'شورتس — زرد پررنگ', box: 'کادر تیره پشت متن', minimal: 'ساده و کوچک (پایین)' };
  document.querySelectorAll('.substyle').forEach(sel => Object.entries(SUBSTYLES).forEach(([k, v]) => sel.insertAdjacentHTML('beforeend', `<option value="${k}">${v}</option>`)));
  document.querySelectorAll('.maxw').forEach(sel => [1, 2, 3, 4, 5, 6].forEach(n => sel.insertAdjacentHTML('beforeend', `<option value="${n}" ${n === 3 ? 'selected' : ''}>${fa(n)}</option>`)));

  // ---- shared helpers for cloud jobs ----
  async function api(path, opts = {}) {
    const r = await fetch(`${API}${path}`, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || `خطای سرور (${r.status})`);
    return j;
  }
  async function poll(id, onProg) {
    for (;;) {
      const j = await api(`/api/job/${id}`);
      if (j.status === 'done') return j.result;
      if (j.status === 'error') throw new Error(j.error || 'خطا');
      onProg && onProg(j);
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  const fileUrl = (id, n) => `${API}/api/file/${id}/${encodeURIComponent(n)}`;
  const fmtT = t => { const m = Math.floor(t / 60), s = (t % 60).toFixed(1); return `${m}:${s.padStart(4, '0')}`; };
  const progressBar = (el, label) => { el.innerHTML = `<div class="prog"><div class="bar"><i style="width:0"></i></div><span>${label}</span></div>`; return (p, l) => { el.querySelector('.bar i').style.width = Math.round(p * 100) + '%'; if (l) el.querySelector('.prog span').textContent = l; }; };

  function subsPanel(el, jobId, res, { sourceVideo = false, styleSel, maxwSel, hasVoice = false } = {}) {
    const files = res.files.map(f => `<a class="dl" href="${fileUrl(jobId, f)}" download>${f}</a>`).join('');
    el.innerHTML = `
      ${hasVoice ? `<audio controls src="${fileUrl(jobId, 'voiceover.mp3')}"></audio>` : ''}
      <p class="hint">${res.duration ? `مدت: ${fa(res.duration)} ثانیه · ` : ''}${fa(res.cues.length)} خط زیرنویس${res.rate !== undefined ? ` · سرعت گفتار ${fa(res.rate)}٪${res.fitted ? ' (خودکار تنظیم شد)' : ''}` : ''}${res.corrected ? ' · با متن اسکریپت اصلاح شد' : ''}</p>
      <div class="files">${files}</div>
      <div class="cues">${res.cues.map(c => `<div><span dir="ltr">${fmtT(c.start)} → ${fmtT(c.end)}</span><b>${esc(c.text)}</b></div>`).join('')}</div>
      ${res.raw ? `<details class="adv"><summary>متن خام Whisper (قبل از اصلاح)</summary><p>${esc(res.raw)}</p></details>` : ''}
      <div class="render">
        <h4>ساخت ویدیوی نهایی با زیرنویس سوخته${hasVoice ? ' و نریشن' : ''}</h4>
        ${sourceVideo ? `<p class="hint">زیرنویس روی همین ویدیوی آپلودشده سوزانده می‌شود.</p>` :
          `<p class="hint">کلیپ‌هایی که از Veo / Kling گرفته‌اید را به ترتیب صحنه انتخاب کنید (چند فایل مجاز است). کلیپ‌ها به هم وصل و به ۹:۱۶ تبدیل می‌شوند${hasVoice ? '، نریشن روی آن‌ها قرار می‌گیرد' : ''} و زیرنویس سوزانده می‌شود.</p>
          <input type="file" class="clips" accept="video/*" multiple>`}
        <button class="primary rbtn" type="button">ساخت ویدیوی نهایی</button>
        <div class="rout"></div>
      </div>`;
    el.querySelector('.rbtn').onclick = async () => {
      const out = el.querySelector('.rout'), btn = el.querySelector('.rbtn');
      const fd = new FormData();
      fd.append('subs_job', jobId); fd.append('style', $(styleSel).value); fd.append('max_words', $(maxwSel).value);
      fd.append('mux_voice', hasVoice ? 'true' : 'false');
      if (sourceVideo) fd.append('use_source', 'true');
      else {
        const fs = el.querySelector('.clips').files;
        if (!fs.length) { out.innerHTML = '<p class="error">اول کلیپ ویدیو را انتخاب کنید.</p>'; return; }
        [...fs].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).forEach(f => fd.append('files', f));
      }
      btn.disabled = true;
      const set = progressBar(out, 'در حال آپلود…');
      try {
        const { job } = await api('/api/render', { method: 'POST', body: fd });
        const r = await poll(job, j => set(j.progress || 0, j.status === 'queued' ? 'در صف…' : `در حال ساخت ویدیو… ${fa(Math.round((j.progress || 0) * 100))}٪`));
        out.innerHTML = `<video controls playsinline src="${fileUrl(job, 'final.mp4')}"></video>
          <p class="hint">${fa(r.duration)} ثانیه${r.clips > 1 ? ` · ${fa(r.clips)} کلیپ به هم وصل شد` : ''}</p>
          <div class="files"><a class="dl primary" href="${fileUrl(job, 'final.mp4')}" download>دانلود ویدیوی نهایی (MP4)</a></div>`;
      } catch (e) { out.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
      btn.disabled = false;
    };
  }

  // ---- TTS from script ----
  $('ttsBtn').onclick = async () => {
    if (!last) return;
    const sc = last.out.scenes || [];
    const text = sc.map(s => (s.voiceover || '').trim()).filter(Boolean).map(t => /[.!?؟…]$/.test(t) ? t : t + '.').join(' ');
    const out = $('ttsOut'); $('ttsBtn').disabled = true;
    out.innerHTML = '<p class="hint">در حال ساخت صدا روی سرور…</p>';
    try {
      const r = await api('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        text, voice: $('voice').value, target: last.plan.duration, autofit: $('autofit').checked, style: $('subStyle1').value, max_words: Number($('maxw1').value) }) });
      subsPanel(out, r.job, r, { hasVoice: true, styleSel: 'subStyle1', maxwSel: 'maxw1' });
    } catch (e) { out.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    $('ttsBtn').disabled = false;
  };

  // ---- ASR mode ----
  $('asrBtn').onclick = async () => {
    const f = $('asrFile').files[0], out = $('asrOut');
    if (!f) { out.innerHTML = '<p class="error">فایل را انتخاب کنید.</p>'; return; }
    const fd = new FormData();
    fd.append('file', f); fd.append('model', $('asrModel').value); fd.append('language', $('asrLang').value);
    fd.append('script', $('asrScript').value); fd.append('style', $('subStyle2').value); fd.append('max_words', $('maxw2').value);
    $('asrBtn').disabled = true;
    const set = progressBar(out, 'در حال آپلود…');
    try {
      const { job } = await api('/api/transcribe', { method: 'POST', body: fd });
      const r = await poll(job, j => set(j.progress || 0,
        j.status === 'queued' ? 'در صف…' : j.stage === 'loading_model' ? 'بارگذاری مدل گفتار (فقط بار اول کمی طول می‌کشد)…' : `در حال تشخیص گفتار… ${fa(Math.round((j.progress || 0) * 100))}٪`));
      subsPanel(out, job, r, { sourceVideo: r.video, styleSel: 'subStyle2', maxwSel: 'maxw2' });
      if (!r.video) out.querySelector('.render').remove();
    } catch (e) { out.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    $('asrBtn').disabled = false;
  };

  const getInput = () => ({
    title: $('title').value.trim(), desc: $('desc').value.trim(),
    duration: Number($('duration').value), intent: $('intent').value, style,
    platform: $('platform').value, target: $('target').value,
    wps: Number($('wps').value) || 2.5, autoRepair: $('autoRepair').checked
  });

  // pipeline indicator
  const steps = ['analyze', 'direct', 'scenes', 'qc', 'adapt'];
  const setStep = s => {
    const i = steps.indexOf(s);
    document.querySelectorAll('#pipeline div').forEach((d, j) => {
      d.classList.toggle('done', j < i); d.classList.toggle('active', j === i);
    });
  };
  const doneAll = () => document.querySelectorAll('#pipeline div').forEach(d => { d.classList.remove('active'); d.classList.add('done'); });
  const resetSteps = () => document.querySelectorAll('#pipeline div').forEach(d => d.classList.remove('active', 'done'));

  const showErr = m => { $('error').hidden = false; $('error').textContent = m; };

  $('runBtn').onclick = async () => {
    const input = getInput();
    $('error').hidden = true;
    if (!input.title) return showErr('عنوان را وارد کنید.');
    if (cfg.provider !== 'dev' && !cfg.apiKey) { showErr('کلید رایگان Gemini را در تنظیمات وارد کنید، یا از «حالت دستی» استفاده کنید.'); $('settingsBtn').click(); return; }
    $('runBtn').disabled = true; $('runBtn').textContent = 'در حال ساخت…';
    $('empty').hidden = true; $('manual').hidden = true;
    resetSteps();
    try {
      last = await VSE.run(input, cfg, setStep);
      doneAll(); render(last);
    } catch (e) {
      resetSteps(); showErr(e.message || String(e));
      if (!last) $('empty').hidden = false;
    } finally {
      $('runBtn').disabled = false; $('runBtn').textContent = 'ساخت اسکریپت';
    }
  };

  $('manualBtn').onclick = () => {
    const input = getInput();
    $('error').hidden = true;
    if (!input.title) return showErr('اول عنوان را وارد کنید تا پرامپت ساخته شود.');
    $('manualPrompt').textContent = VSE.manualPrompt(input, VSE.plan(input.duration, input.wps), input.target);
    $('manual').hidden = false; $('empty').hidden = true;
  };
  $('manualClose').onclick = () => { $('manual').hidden = true; if (!last) $('empty').hidden = false; };
  $('manualRun').onclick = () => {
    $('error').hidden = true;
    try {
      last = VSE.fromManual(getInput(), $('manualJson').value);
      doneAll(); $('manual').hidden = true; render(last);
    } catch (e) { showErr(e.message); }
  };

  // re-adapt on model change without regenerating
  $('target').onchange = () => {
    if (!last) return;
    last.input.target = $('target').value;
    last.adapted = VSE.adapt(last.out, last.input.target, last.input.platform);
    render(last);
  };

  // copy buttons (delegated)
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const el = $(b.dataset.copy); if (!el) return;
    try { await navigator.clipboard.writeText(el.textContent); b.textContent = 'کپی شد'; }
    catch { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); b.textContent = 'انتخاب شد'; }
    setTimeout(() => (b.textContent = 'کپی'), 1400);
  });

  // tabs
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(t => (t.hidden = t.id !== 'tab-' + b.dataset.tab));
  });

  function codebox(id, text, ltr = true) {
    return `<div class="codebox"><button class="copy" data-copy="${id}" type="button">کپی</button><pre id="${id}" ${ltr ? 'dir="ltr"' : ''}>${esc(text)}</pre></div>`;
  }

  function render(r) {
    const { out, qc, adapted, plan } = r;
    const sc = out.scenes || [];
    $('result').hidden = false; $('empty').hidden = true; $('ttsOut').innerHTML = '';

    const st = VSE.STYLES[out.direction?.style]?.fa || out.direction?.style;
    $('verdict').className = 'verdict ' + (qc.ready ? 'ok' : 'bad');
    $('verdict').innerHTML = `<b>${qc.ready ? 'READY TO GENERATE' : 'NEEDS REVIEW'}</b>
      <span>${fa(plan.duration)} ثانیه · ${esc(st)} · ${esc(out.direction?.intent || '')} · ${esc(adapted.model.name)}</span>
      <span>${fa(qc.checks.filter(c => c.ok).length)}/${fa(qc.checks.length)} بررسی موفق${qc.warns.length ? ` · ${fa(qc.warns.length)} هشدار` : ''}${r.repaired ? ' · یک بار خودکار اصلاح شد' : ''}</span>`;

    // script table
    $('tab-script').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>#</th><th>زمان</th><th>Beat</th><th>تصویر</th><th>نریشن</th><th>دوربین / ترنزیشن</th><th>متن روی تصویر</th><th>صدا</th></tr></thead>
      <tbody>${sc.map(s => `<tr>
        <td>${fa(s.n)}</td><td class="nowrap" dir="ltr">${fa(s.start)}–${fa(s.end)}s</td><td><span class="beat">${esc(s.beat)}</span></td>
        <td dir="ltr" class="en">${esc(s.visual)}</td><td class="vo">${esc(s.voiceover)}</td>
        <td dir="ltr" class="en">${esc(s.camera)}<br><em>→ ${esc(s.transition)}</em></td>
        <td>${esc(s.overlay)}</td><td dir="ltr" class="en">${esc(s.sfx)}</td></tr>`).join('')}</tbody></table></div>
      <div class="extras">
        <div><h4>عنوان‌های پیشنهادی</h4><ol>${(out.titles || []).map(t => `<li>${esc(t)}</li>`).join('')}</ol></div>
        <div><h4>هشتگ‌ها</h4><p class="tags">${(out.hashtags || []).map(h => `<span>${esc(h.startsWith('#') ? h : '#' + h)}</span>`).join('')}</p>
        <h4>تامبنیل</h4><p>${esc(out.thumbnail?.fa || '')}</p>${out.thumbnail?.prompt ? codebox('thumbP', out.thumbnail.prompt) : ''}</div>
      </div>`;

    // prompts
    const allShots = adapted.shots.map(s => `[${s.id}] ${s.generate}s clip${s.use < s.generate ? ` (use first ${s.use}s)` : ''}\n${s.prompt}${s.negative ? `\nNegative: ${s.negative}` : ''}`).join('\n\n');
    $('tab-prompts').innerHTML = `<p class="hint">مدل را از فهرست «مدل ویدیو» عوض کنید؛ پرامپت‌ها بدون تولید دوباره بازنویسی می‌شوند. نریشن و متن فارسی را در مونتاژ اضافه کنید، چون مدل‌های ویدیو حروف فارسی را خراب می‌کنند.</p>
      <h4>Master Prompt</h4>${codebox('masterP', adapted.master)}
      <h4>Shot Prompts — ${esc(adapted.model.name)}</h4>
      ${adapted.shots.map(s => `<div class="shot"><div class="shothead"><b dir="ltr">${s.id}</b><span>صحنهٔ ${fa(s.scene)} · تولید ${fa(s.generate)}s${s.use < s.generate ? ` · استفاده ${fa(s.use)}s` : ''}</span></div>
        ${codebox('shot_' + s.id, s.prompt + (s.negative ? `\n\nNegative prompt: ${s.negative}` : ''))}</div>`).join('')}
      <h4>همهٔ Shotها یک‌جا</h4>${codebox('allShots', adapted.master + '\n\n' + allShots)}`;

    // voiceover
    const vo = sc.map(s => s.voiceover).join('\n');
    const words = VSE.faWords(vo);
    $('tab-vo').innerHTML = `<p class="hint">${fa(words)} کلمه · حدود ${fa(Math.round(words / plan.wps))} ثانیه با سرعت ${fa(plan.wps)} کلمه در ثانیه</p>${codebox('voP', vo, false)}
      <div class="tablewrap"><table><thead><tr><th>زمان</th><th>نریشن</th><th>کلمه</th></tr></thead><tbody>
      ${sc.map(s => `<tr><td class="nowrap" dir="ltr">${fa(s.start)}–${fa(s.end)}s</td><td class="vo">${esc(s.voiceover)}</td><td>${fa(VSE.faWords(s.voiceover))}</td></tr>`).join('')}</tbody></table></div>`;

    // qc
    $('tab-qc').innerHTML = `<ul class="qc">${qc.checks.map(c => `<li class="${c.level}"><i>${c.ok ? '✓' : c.level === 'warn' ? '!' : '✕'}</i><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></li>`).join('')}</ul>
      <p class="hint">این بررسی‌ها با کد انجام می‌شوند، نه با هوش مصنوعی؛ پس نتیجه‌شان قطعی و قابل اعتماد است. کیفیت خلاقانه را خودتان قضاوت کنید.</p>`;

    // analysis
    const a = out.analysis || {}, d = out.direction || {};
    $('tab-analysis').innerHTML = `<div class="cards">
      <div class="card"><h4>پیام اصلی</h4><p>${esc(a.core_message)}</p></div>
      <div class="card"><h4>مخاطب</h4><p>${esc(a.audience)}</p></div>
      <div class="card"><h4>زاویهٔ احساسی</h4><p>${esc(a.emotional_angle)}</p></div>
      <div class="card"><h4>CTA</h4><p>${esc(a.cta)}</p></div>
      <div class="card wide"><h4>فکت‌ها</h4><ul>${(a.facts || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
      <div class="card wide"><h4>فرصت‌های بصری</h4><ul dir="ltr" class="en">${(a.visual_opportunities || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
      <div class="card wide"><h4>تصمیم کارگردان</h4><p>هدف: <b>${esc(d.intent)}</b> · سبک: <b>${esc(st)}</b> · نوع Hook: <b>${esc(d.hook_type)}</b> · لحن: ${esc(d.tone)}</p>${d.style_reason ? `<p>${esc(d.style_reason)}</p>` : ''}
        <p class="hint">ساختار: ${esc(plan.structure)}</p>
        <ol class="beats">${(out.structure || []).map(b => `<li><span class="beat">${esc(b.beat)}</span> ${fa(b.seconds)}s — ${esc(b.idea)}</li>`).join('')}</ol>
        ${(out.dropped_ideas || []).length ? `<h4>ایده‌های حذف‌شده (برای این مدت جا نمی‌شوند)</h4><ul>${out.dropped_ideas.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
    </div>`;

    $('tab-all').innerHTML = codebox('allP', toMarkdown(r), false);
  }

  function toMarkdown(r) {
    const { out, qc, adapted, plan, input } = r;
    const sc = out.scenes || [];
    const cell = s => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
    return `# ${input.title}
${plan.duration}s · ${out.direction?.style} · ${out.direction?.intent} · ${input.platform} · ${adapted.model.name}
وضعیت: ${qc.ready ? 'READY TO GENERATE' : 'NEEDS REVIEW'}

## اسکریپت
| # | زمان | Beat | تصویر | نریشن | دوربین | ترنزیشن | متن روی تصویر | صدا |
|---|---|---|---|---|---|---|---|---|
${sc.map(s => `| ${s.n} | ${s.start}-${s.end}s | ${cell(s.beat)} | ${cell(s.visual)} | ${cell(s.voiceover)} | ${cell(s.camera)} | ${cell(s.transition)} | ${cell(s.overlay)} | ${cell(s.sfx)} |`).join('\n')}

## نریشن
${sc.map(s => s.voiceover).join('\n')}

## Master Prompt
\`\`\`
${adapted.master}
\`\`\`

## Shot Prompts
${adapted.shots.map(s => `### ${s.id} — ${s.generate}s\n\`\`\`\n${s.prompt}${s.negative ? `\nNegative: ${s.negative}` : ''}\n\`\`\``).join('\n\n')}

## عنوان‌ها
${(out.titles || []).map(t => `- ${t}`).join('\n')}

## هشتگ‌ها
${(out.hashtags || []).join(' ')}

## تامبنیل
${out.thumbnail?.fa || ''}
\`${out.thumbnail?.prompt || ''}\`

## کنترل کیفیت
${qc.checks.map(c => `- ${c.ok ? '✓' : c.level === 'warn' ? '!' : '✕'} ${c.label}: ${c.detail}`).join('\n')}
`;
  }

  const download = (name, text, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const slug = () => (last?.input.title || 'script').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40);
  $('dlMd').onclick = () => last && download(slug() + '.md', toMarkdown(last), 'text/markdown');
  $('dlJson').onclick = () => last && download(slug() + '.json', JSON.stringify(last, null, 2), 'application/json');

  // expose for testing
  window.__vse = { render, get last() { return last; }, set last(v) { last = v; } };
})();
