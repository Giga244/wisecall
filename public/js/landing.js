// The home page (docs/CLAUDE-CODE-NEW-HOME.md): the hero's search (before launch, the waiting list and how many are on it), the popular fields,
// the phone (real questions and answers in a random order; an example, marked as such, while there are fewer than three: docs/CLAUDE-CODE-RANDOM-PHONE.md). "Meet our experts" is public/js/home-mentors.js; Browse experts
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
    // (right under the email and its button, above the age box and the privacy note: docs/CLAUDE-CODE-FINISH.md part 1)
    const box = document.getElementById('heroWait');
    const place = () => { const row = box && box.querySelector('.wlc-row'); if (row && row.nextElementSibling !== el) row.after(el); };
    place();
    if (box && 'MutationObserver' in window) new MutationObserver(place).observe(box, { childList: true, subtree: true });
  }

  // ---- The phone: live texting, as in docs/new-home/phone-animation.html (its render(t) timeline, with the questions from /api/home-qa) --
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const back = (x) => { x = clamp(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  // When each letter of the question is typed: a little uneven, with short pauses after punctuation and spaces (as a person types).
  function typedTimes(chars, t0, cps) {
    let t = t0;
    return chars.map((ch, i) => { t += (1 / cps) * (0.7 + (0.6 * ((i * 37) % 10)) / 10); if (',.?!:'.includes(ch)) t += 0.25; else if (ch === ' ') t += 0.03; return t; });
  }
  // S: the moment it is sent. The answer comes 3.1 s later, its stars (a real, rated one) after it; the loop is at least 12 s.
  function timeline(qChars, stars) {
    const TT = typedTimes(qChars, 0.4, 30);
    const S = (TT.length ? TT[TT.length - 1] : 0.4) + 0.35;
    const end = S + (stars ? 6.6 : 5.4);
    return { TT, S, loop: Math.max(12, end + 1.4) };
  }
  // (an example's picture: a person, not a letter or a face)
  const PERSON = '<span class="qa-avatar-ex"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg></span>';

  // One item on the phone. A real answer: the mentor's name, "verified", their days and, when the student rated it, the stars. An example
  // (fewer than three real ones): "Example" on the status bar, "Expert · <field>" with a neutral picture, no badge, no rating, and the
  // deadline ("Answer within 7 days"), never a number of days that did not happen (docs/CLAUDE-CODE-FINISH.md part 1).
  function fill(box, item) {
    const ex = Boolean(item.example);
    const q = ex ? t(`home2.ex.${item.n}.q`) : item.question;
    const a = ex ? t(`home2.ex.${item.n}.a`) : item.answer;
    const field = WisecallI18n.fieldName({ niche: item.niche }) || '';
    const m = ex ? {} : (item.mentor || {});
    const days = ex ? null : (item.days || 1);
    const stars = !ex && Number.isInteger(item.stars) && item.stars > 0 ? item.stars : 0;
    const $ = (sel) => box.querySelector(sel);
    $('.qa-example').hidden = !ex;
    $('.qa-example').textContent = ex ? t('home2.qa.example') : '';
    $('.qa-avatar').innerHTML = ex ? PERSON : WisecallAPI.avatar({ name: m.name, color: m.color }, { cls: 'avatar-sm', size: 34 });
    $('.qa-name').textContent = ex ? [t('home2.qa.expert'), field].filter(Boolean).join(' · ') : (m.name || '');
    $('.qa-meta').hidden = ex;
    $('.qa-meta').textContent = ex ? '' : [`✓ ${t('home2.qa.verified')}`, m.roleTitle].filter(Boolean).join(' · ');
    // (the student, never named: only the question's field)
    $('.qa-d1').textContent = field ? t('home2.qa.question').replace('{field}', field) : t('home2.qa.questionPlain');
    $('.qa-qtext').textContent = q;
    $('.qa-sent').textContent = t('home2.qa.sent');
    $('.qa-d2').textContent = ex ? '' : t(days === 1 ? 'home2.qa.later1' : 'home2.qa.later').replace('{n}', days);
    $('.qa-aname').textContent = ex ? t('home2.qa.expert') : (m.name || '');
    $('.qa-adays').textContent = ex ? t('home2.qa.exampleDays') : t(days === 1 ? 'home2.qa.days1' : 'home2.qa.days').replace('{n}', days);
    $('#qaCaption').textContent = (ex ? t('home2.qa.exampleCaption').replace('{field}', field) : t('home2.qa.caption').replace('{mentor}', m.name || ''))
      .replace('{question}', q).replace('{answer}', a);
    box.dataset.item = ex ? `example-${item.n}` : item.id;
    return { q, a, stars, ex };
  }

  // Plays the rotation: a different question and answer on each loop, the phone's screen fading between them; still while off screen or in
  // a hidden tab. With reduced motion: one of them, finished, and no rotation.
  function playPhone(box, rotation) {
    const root = box.querySelector('.qa-phone');
    const $ = (sel) => root.querySelector(sel);
    const screen = $('.qa-screen');
    const chat = $('.qa-chat');
    const inp = $('.qa-inp');
    const dots = [...root.querySelectorAll('.qa-typing i')];
    const starEls = [...root.querySelectorAll('.qa-stars i')];
    let cur; // { q, a, stars, ex, qChars, aChars, T }
    // (a bubble pops in: it grows from its corner, and is not there at all before)
    const show = (el, p, dy = 10) => {
      el.style.display = p <= 0 ? 'none' : '';
      el.style.opacity = String(clamp(p * 1.5));
      el.style.transform = `translateY(${(1 - back(p)) * dy}px) scale(${0.9 + 0.1 * back(p)})`;
    };
    function render(time) {
      const { qChars, aChars, T, stars, ex } = cur;
      const S = T.S;
      const ph = `<span class="qa-ph">${esc(t('home2.qa.input'))}</span>`;
      const caret = '<span class="qa-cur"></span>';
      // the question, letter by letter in the input (which grows), the cursor after it; before the first letter the cursor blinks
      if (time < S) {
        const n = T.TT.filter((x) => x <= time).length;
        // (one span: the input is a column that grows upward, and the cursor stays at the end of the last line)
        inp.innerHTML = `<span>${n ? esc(qChars.slice(0, n).join('')) + caret : ph + (Math.floor(time * 2.2) % 2 ? '' : caret)}</span>`;
      } else inp.innerHTML = `<span>${ph}</span>`;
      $('.qa-send').classList.toggle('is-tap', time > S - 0.2 && time < S + 0.15);
      show($('.qa-d1'), (time - S) / 0.3, 6);
      show($('.qa-q'), (time - S) / 0.45, 20);
      $('.qa-sent').style.opacity = String(clamp((time - S - 0.6) / 0.3));
      if (ex) $('.qa-d2').style.display = 'none'; else show($('.qa-d2'), (time - S - 1.4) / 0.3, 6);
      // the typing dots, bouncing one after the other
      $('.qa-typing').style.display = time > S + 1.7 && time < S + 3.1 ? '' : 'none';
      dots.forEach((d, i) => { d.style.transform = `translateY(${-Math.max(0, Math.sin(time * 7 - i)) * 4}px)`; });
      // the answer, letter by letter
      show($('.qa-a'), (time - S - 3.1) / 0.45, 20);
      $('.qa-atext').textContent = aChars.slice(0, Math.floor(clamp((time - S - 3.2) / 1.6) * aChars.length)).join('');
      $('.qa-adays').style.opacity = String(clamp((time - S - 4.8) / 0.3));
      // the stars, one by one: only a real answer the student rated
      if (stars) {
        show($('.qa-rate'), (time - S - 5.0) / 0.3, 6);
        starEls.forEach((el, i) => {
          const p = i < stars ? clamp((time - S - 5.3 - i * 0.15) / 0.2) : 0;
          el.style.opacity = String(0.2 + 0.8 * p);
          el.style.transform = `scale(${1 + 0.4 * Math.sin(Math.PI * p)})`;
        });
        $('.qa-ratelabel').textContent = time > S + 6.2 ? t('home2.qa.thanks').replace('{n}', stars) : t('home2.qa.rate');
      } else $('.qa-rate').style.display = 'none';
      // the screen fades out at the end of the loop and in at its start
      const L = T.loop;
      screen.style.opacity = String(time > L - 0.4 ? clamp((L - time) / 0.4) : time < 0.3 ? clamp(time / 0.3) : 1);
      // (the chat starts under the header; once it no longer fits, it keeps to the bottom, as a chat app scrolls)
      chat.classList.remove('is-tall');
      if (chat.scrollHeight > chat.clientHeight + 1) chat.classList.add('is-tall');
    }
    const set = (item) => {
      const f = fill(box, item);
      const qChars = [...f.q];
      cur = { ...f, qChars, aChars: [...f.a], T: timeline(qChars, f.stars) };
    };
    set(rotation.next());
    // (still: one finished conversation)
    if (reduceMotion()) { render(cur.T.loop - 0.6); screen.style.opacity = '1'; return; }
    let visible = false;
    let elapsed = 0;
    let last = null;
    let frame = null;
    const tick = (now) => {
      if (last !== null) elapsed += (now - last) / 1000;
      last = now;
      if (elapsed >= cur.T.loop) { elapsed = 0; set(rotation.next()); } // (the next loop: the next question)
      render(elapsed);
      frame = requestAnimationFrame(tick);
    };
    const run = () => {
      const on = visible && document.visibilityState === 'visible';
      if (on && frame === null) { last = null; frame = requestAnimationFrame(tick); }
      if (!on && frame !== null) { cancelAnimationFrame(frame); frame = null; }
    };
    render(0);
    if ('IntersectionObserver' in window) new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); run(); }).observe(box);
    else { visible = true; run(); }
    document.addEventListener('visibilitychange', run);
  }
  async function drawPhone() {
    const box = document.getElementById('homeQa');
    if (!box || !window.WisecallPhoneRotation) return;
    // (the real ones from the server; if they cannot be had, the example alone)
    let data = null;
    try { data = await WisecallAPI.apiFetch('/home-qa'); } catch (e) { data = null; }
    playPhone(box, WisecallPhoneRotation.create(data));
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
