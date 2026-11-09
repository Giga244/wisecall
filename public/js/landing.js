// The home page (docs/CLAUDE-CODE-NEW-HOME.md): the hero's search (before launch, the waiting list and how many are on it), the popular fields,
// the phone with one real question and answer. "Meet our experts" is public/js/home-mentors.js; Browse experts
// is its own page, /experts.html.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const prefix = () => (WisecallI18n.getLang() === 'ka' ? '/ka' : '');
  const prelaunch = () => WisecallI18n.launchMode() === 'prelaunch';
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // An old link to Browse on the home page (/#experts) goes to Browse itself; "join the waiting list" (/#join) to the hero's form.
  if (window.location.hash === '#experts') { window.location.replace(`${/^\/ka(\/|$)/.test(window.location.pathname) ? '/ka' : ''}/experts.html`); return; }

  // ---- The popular fields: up to five (2.1). After launch each opens Browse with it; before launch a tap chooses the waiting list's field.
  const POPULAR = [
    { field: 'med', word: 'home2.chip.med' },
    { field: 'it' },
    { field: 'edu', chip: 'edu.ielts', word: 'home2.chip.ielts' },
    { field: 'law' },
    { field: 'abroad' }
  ];
  function drawChips() {
    const box = document.getElementById('heroChips');
    if (!box) return;
    const all = WisecallI18n.fields();
    const items = POPULAR.map((p) => ({ ...p, f: all.find((x) => x.id === p.field) })).filter((p) => p.f).slice(0, 5);
    const label = (p) => (p.word ? t(p.word) : WisecallI18n.nameIn(p.f.short || p.f));
    const icon = (p) => (p.chip ? '📚' : p.f.icon);
    if (prelaunch()) {
      box.innerHTML = items.map((p) => `<li><button type="button" class="chip lchip" data-wait-field="${esc(p.field)}" aria-pressed="false"><span aria-hidden="true">${icon(p)}</span> ${esc(label(p))}</button></li>`).join('');
    } else {
      box.innerHTML = items.map((p) => `<li><a class="chip lchip" href="${prefix()}/experts.html?field=${encodeURIComponent(p.field)}${p.chip ? `&chip=${encodeURIComponent(p.chip)}` : ''}"><span aria-hidden="true">${icon(p)}</span> ${esc(label(p))}</a></li>`).join('');
    }
  }
  // Before launch: the chosen chip becomes the waiting list's field (a second tap on it: any field again).
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-wait-field]');
    if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    document.querySelectorAll('[data-wait-field]').forEach((x) => x.setAttribute('aria-pressed', String(x === b && on)));
    if (window.WisecallWaitlist) WisecallWaitlist.chooseField(on ? b.dataset.waitField : 'any');
  });

  // ---- The hero's search (after launch): the words go to Browse experts, which searches the fields and the mentors (2.1).
  function wireSearch() {
    const form = document.getElementById('heroSearch');
    if (!form) return;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = form.q.value.trim();
      window.location.href = `${prefix()}/experts.html${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    });
  }

  // ---- Before launch: "90+ people are already on the waiting list", the real number rounded down to ten, only from 50 (4).
  async function drawCount() {
    const el = document.getElementById('waitCount');
    if (!el || !prelaunch()) return;
    let r = null;
    try { r = await WisecallAPI.apiFetch('/waitlist-count'); } catch (e) { return; }
    if (!r || !Number.isInteger(r.approx)) { el.hidden = true; return; }
    el.textContent = t('home2.wait.count').replace('{n}', r.approx);
    el.hidden = false;
  }

  // ---- The phone (2.2) --------------------------------------------------------------------------------------------------------------------
  // One real question and answer (server/homeQa.js), played in a loop of about 11 seconds: the question is typed and sent ("გაგზავნილია ✓"),
  // "2 days later" and the typing dots, the answer slides in and its words appear, "✓ answered in 2 days", and the stars fill one by one (as
  // many as the student really gave). It pauses while off screen or in a hidden tab; with reduced motion it shows the finished state, still.
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const back = (x) => { x = clamp(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  function timeline(q, a, stars) {
    const typeEnd = 0.4 + Math.min(2.6, Math.max(1.2, [...q].length / 32));
    const send = typeEnd + 0.3;
    const later = send + 0.8;
    const dots = [later + 0.3, later + 1.3];
    const ans = dots[1];
    const ansEnd = ans + 0.15 + Math.min(2.2, Math.max(1.2, [...a].length / 130));
    const days = ansEnd + 0.2;
    const star0 = days + 0.4;
    const end = star0 + 0.2 * (stars || 0) + 0.4;
    return { typeEnd, send, later, dots, ans, ansEnd, days, star0, loop: Math.max(11, end + 1.6) };
  }
  function playPhone(root, qa) {
    const $ = (sel) => root.querySelector(sel);
    const q = qa.question;
    const a = qa.answer;
    const stars = Number.isInteger(qa.stars) ? qa.stars : 0;
    const T = timeline(q, a, stars);
    const qChars = [...q];
    const aWords = a.split(/(\s+)/);
    const show = (el, p, dy = 10) => { el.style.opacity = String(clamp(p * 1.5)); el.style.transform = `translateY(${(1 - back(p)) * dy}px) scale(${0.92 + 0.08 * back(p)})`; el.style.visibility = p <= 0 ? 'hidden' : 'visible'; };
    const starEls = [...root.querySelectorAll('.qa-stars i')];
    const inp = $('.qa-inp');
    const placeholder = `<span class="qa-ph">${esc(t('home2.qa.input'))}</span>`;
    function render(time) {
      // the question, typed into the input, then sent
      if (time < T.typeEnd) {
        const n = Math.floor(qChars.length * clamp((time - 0.4) / (T.typeEnd - 0.4)));
        inp.innerHTML = n ? `${esc(qChars.slice(0, n).join(''))}<span class="qa-cur"></span>` : placeholder;
      } else if (time < T.send) inp.innerHTML = `${esc(q)}<span class="qa-cur"></span>`;
      else inp.innerHTML = placeholder;
      $('.qa-send').classList.toggle('is-tap', time >= T.send - 0.15 && time < T.send + 0.15);
      show($('.qa-q'), clamp((time - T.send) / 0.35));
      $('.qa-sent').style.opacity = String(clamp((time - T.send - 0.35) / 0.3));
      show($('.qa-d2'), clamp((time - T.later) / 0.3), 4);
      const typing = time >= T.dots[0] && time < T.dots[1];
      $('.qa-typing').style.display = typing ? '' : 'none';
      const ap = clamp((time - T.ans) / 0.4);
      $('.qa-a').style.display = time >= T.ans ? '' : 'none';
      show($('.qa-a'), ap, 14);
      const shown = Math.ceil(aWords.length * clamp((time - T.ans - 0.15) / (T.ansEnd - T.ans - 0.15)));
      $('.qa-atext').textContent = aWords.slice(0, shown).join('');
      $('.qa-adays').style.opacity = String(clamp((time - T.days) / 0.3));
      $('.qa-rate').style.opacity = String(clamp((time - T.days) / 0.3));
      starEls.forEach((s, i) => s.classList.toggle('is-on', i < stars && time >= T.star0 + 0.2 * i));
    }
    // (still: the finished conversation)
    if (reduceMotion()) { render(T.loop - 0.01); return; }
    let visible = false;
    let elapsed = 0;
    let last = null;
    let frame = null;
    const tick = (now) => {
      if (last !== null) elapsed = (elapsed + (now - last) / 1000) % T.loop;
      last = now;
      render(elapsed);
      frame = requestAnimationFrame(tick);
    };
    const run = () => {
      const on = visible && document.visibilityState === 'visible';
      if (on && frame === null) { last = null; frame = requestAnimationFrame(tick); }
      if (!on && frame !== null) { cancelAnimationFrame(frame); frame = null; }
    };
    render(0);
    if ('IntersectionObserver' in window) new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); run(); }).observe(root);
    else { visible = true; run(); }
    document.addEventListener('visibilitychange', run);
  }
  async function drawPhone() {
    const box = document.getElementById('homeQa');
    if (!box) return;
    let qa = null;
    try { qa = (await WisecallAPI.apiFetch('/home-qa')).qa; } catch (e) { qa = null; }
    if (!qa || !qa.question || !qa.answer) { box.hidden = true; return; }
    const m = qa.mentor || {};
    const field = WisecallI18n.fieldName({ niche: qa.niche }) || '';
    const days = qa.days || 1;
    box.querySelector('.qa-avatar').innerHTML = WisecallAPI.avatar({ name: m.name, color: m.color }, { cls: 'avatar-sm', size: 34 });
    box.querySelector('.qa-name').textContent = m.name || '';
    box.querySelector('.qa-meta').textContent = [`✓ ${t('home2.qa.verified')}`, m.roleTitle].filter(Boolean).join(' · ');
    // (the student, never named: only the question's field)
    box.querySelector('.qa-d1').textContent = field ? t('home2.qa.question').replace('{field}', field) : t('home2.qa.questionPlain');
    box.querySelector('.qa-qtext').textContent = qa.question;
    box.querySelector('.qa-sent').textContent = t('home2.qa.sent');
    box.querySelector('.qa-d2').textContent = t(days === 1 ? 'home2.qa.later1' : 'home2.qa.later').replace('{n}', days);
    box.querySelector('.qa-aname').textContent = m.name || '';
    box.querySelector('.qa-adays').textContent = t(days === 1 ? 'home2.qa.days1' : 'home2.qa.days').replace('{n}', days);
    box.querySelector('.qa-ratelabel').textContent = Number.isInteger(qa.stars) ? t('home2.qa.rated') : t('home2.qa.rate');
    if (!Number.isInteger(qa.stars)) box.querySelector('.qa-stars').classList.add('is-empty');
    box.querySelector('#qaCaption').textContent = t('home2.qa.caption').replace('{mentor}', m.name || '').replace('{question}', qa.question).replace('{answer}', qa.answer);
    box.hidden = false;
    playPhone(box.querySelector('.qa-phone'), qa);
  }

  (async () => {
    await WisecallI18n.initI18n();
    await WisecallNav.initNav();
    drawChips();
    wireSearch();
    drawCount();
    drawPhone();
    if (window.location.hash === '#join' && window.WisecallWaitlist) WisecallWaitlist.goToHero();
  })().catch(() => {});
  document.addEventListener('wisecall:lang-changed', () => { drawChips(); });
})();
