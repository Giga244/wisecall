// The home page (docs/CLAUDE-CODE-COMPACT-HOME.md): the top card's waiting list (after launch: the search) and how many are on it, the popular
// fields, the example chat (real questions and answers in a random order; an example, marked as such, while there are fewer than three:
// docs/CLAUDE-CODE-RANDOM-PHONE.md), the header's join button on a computer and the pinned one on a phone. "Meet our experts" is
// public/js/home-mentors.js; Browse experts is its own page, /experts.html.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const prefix = () => (WisecallI18n.getLang() === 'ka' ? '/ka' : '');
  const prelaunch = () => WisecallI18n.launchMode() === 'prelaunch';
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // An old link to Browse on the home page (/#experts) goes to Browse itself; "join the waiting list" (/#join) to the top card's form.
  if (window.location.hash === '#experts') { window.location.replace(`${/^\/ka(\/|$)/.test(window.location.pathname) ? '/ka' : ''}/experts.html`); return; }

  let phone = null; // (the chat, once it plays: phone.showField(field))
  let chosenField = null;

  // ---- The popular fields: up to five. Choosing one shows that field's question and answer in the chat when there is one; before launch it
  // is also the waiting list's field, after launch the search's (a second tap: none again).
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
    const pre = prelaunch();
    box.innerHTML = items.map((p) => `<li><button type="button" class="chip lchip" data-field="${esc(p.field)}"${p.chip ? ` data-chip="${esc(p.chip)}"` : ''}${pre ? ` data-wait-field="${esc(p.field)}"` : ''} aria-pressed="${p.field === chosenField}"><span aria-hidden="true">${icon(p)}</span> ${esc(label(p))}</button></li>`).join('');
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('#heroChips [data-field]');
    if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    chosenField = on ? b.dataset.field : null;
    document.querySelectorAll('#heroChips [data-field]').forEach((x) => x.setAttribute('aria-pressed', String(x === b && on)));
    if (prelaunch() && window.WisecallWaitlist) WisecallWaitlist.chooseField(on ? b.dataset.field : 'any');
    if (on && phone) phone.showField(b.dataset.field);
  });

  // ---- The search (after launch): the words, and the chosen field, go to Browse experts.
  function wireSearch() {
    const form = document.getElementById('heroSearch');
    if (!form) return;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = form.q.value.trim();
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (chosenField) params.set('field', chosenField);
      const chip = chosenField && document.querySelector(`#heroChips [data-field="${chosenField}"]`);
      if (chip && chip.dataset.chip) params.set('chip', chip.dataset.chip);
      window.location.href = `${prefix()}/experts.html${params.toString() ? `?${params}` : ''}`;
    });
  }

  // ---- Before launch: "90+ people are already on the waiting list", the real number rounded down to ten, only from 50 (a shorter line on a phone).
  async function drawCount() {
    const el = document.getElementById('waitCount');
    if (!el || !prelaunch()) return;
    let r = null;
    try { r = await WisecallAPI.apiFetch('/waitlist-count'); } catch (e) { return; }
    if (!r || !Number.isInteger(r.approx)) { el.hidden = true; return; }
    el.innerHTML = `<span class="only-narrow">${esc(t('home2.wait.countShort').replace('{n}', r.approx))}</span><span class="only-wide">${esc(t('home2.wait.count').replace('{n}', r.approx))}</span>`;
    el.hidden = false;
  }

  // ---- The way to the form: the header's button on a computer, the pinned one on a phone (hidden while the form is on screen, so there are
  // never two join buttons in sight, and once joined). Both bring the email (after launch: the search) into view and focus it.
  const formEl = () => document.querySelector('#heroWait .waitlist-form, #heroSearch') || document.getElementById('heroWait');
  function goToForm(ev) {
    if (ev) ev.preventDefault();
    const input = document.querySelector('#heroWait input[type="email"], #heroQ');
    const target = input || formEl();
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    if (input) setTimeout(() => input.focus({ preventScroll: true }), reduceMotion() ? 0 : 350);
  }
  function wireWayToForm() {
    // the header (from 768px): "Join the list" (after launch: "Find an expert") beside the language switch
    // (the button itself is in the header's first frame: public/js/header.js)
    const cta = document.querySelector('#siteHeader .nav-cta');
    if (cta) cta.addEventListener('click', goToForm);
    const pin = document.getElementById('homePin');
    if (!pin) return;
    pin.addEventListener('click', goToForm);
    let formOnScreen = true;
    const joined = () => Boolean(document.querySelector('#heroWait .waitlist-done'));
    const draw = () => { pin.hidden = formOnScreen || joined(); };
    const box = document.getElementById('heroWait') || document.getElementById('heroSearch');
    if (box && 'IntersectionObserver' in window) {
      new IntersectionObserver((entries) => { formOnScreen = entries.some((e) => e.isIntersecting); draw(); }).observe(box);
      if ('MutationObserver' in window) new MutationObserver(draw).observe(box, { childList: true, subtree: true });
    } else { formOnScreen = false; draw(); }
  }

  // ---- The example chat: live texting, the timeline of docs/new-home/phone-animation.html in a smaller card ---------------------------------
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const back = (x) => { x = clamp(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  // When each letter of the question is typed: a little uneven, with short pauses after punctuation and spaces (as a person types).
  function typedTimes(chars, t0, cps) {
    let t = t0;
    return chars.map((ch, i) => { t += (1 / cps) * (0.7 + (0.6 * ((i * 37) % 10)) / 10); if (',.?!:'.includes(ch)) t += 0.25; else if (ch === ' ') t += 0.03; return t; });
  }
  // S: the moment the question is written. The answer comes 1.9 s later, its stars (a real, rated one) after it; the loop is at least 9 s.
  function timeline(qChars, stars) {
    const TT = typedTimes(qChars, 0.4, 30);
    const S = (TT.length ? TT[TT.length - 1] : 0.4) + 0.35;
    const end = S + (stars ? 5.2 : 4.0);
    return { TT, S, loop: Math.max(9, end + 2.2) };
  }
  // About n characters, cut at a word, ending with "..." (the server already cuts an answer at about 300).
  function shorten(text, n) {
    const chars = [...String(text || '')];
    if (chars.length <= n) return chars.join('');
    const cut = chars.slice(0, n).join('');
    const space = cut.lastIndexOf(' ');
    return `${(space > n * 0.6 ? cut.slice(0, space) : cut).replace(/[s,.;:–—-]+$/, '')}...`;
  }
  // (an example's picture: a person, not a letter or a face)
  const PERSON = '<span class="qa-avatar-ex"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg></span>';

  // One item in the chat. A real answer: the mentor's name, "verified", their days and, when the student rated it, the stars. An example
  // (fewer than three real ones): "Example", "Expert · <field>" with a neutral picture, no badge, no rating, and the deadline ("Answer within
  // 7 days"), never a number of days that did not happen. The student is never named.
  function fill(box, item) {
    const ex = Boolean(item.example);
    // (a phone's card is small: the question and the answer a little shorter, cut at a word with "...")
    const narrow = window.matchMedia('(max-width: 767px)').matches;
    const q = shorten(ex ? t(`home2.ex.${item.n}.q`) : item.question, narrow ? 110 : 200);
    const a = shorten(ex ? t(`home2.ex.${item.n}.a`) : item.answer, narrow ? 140 : 280);
    const field = WisecallI18n.fieldName({ niche: item.niche }) || '';
    const m = ex ? {} : (item.mentor || {});
    const days = ex ? null : (item.days || 1);
    const stars = !ex && Number.isInteger(item.stars) && item.stars > 0 ? item.stars : 0;
    const $ = (sel) => box.querySelector(sel);
    for (const sel of ['.qa-example', '.qa-example-foot']) { $(sel).hidden = !ex; $(sel).textContent = ex ? t('home2.qa.example') : ''; }
    $('.qa-avatar').innerHTML = ex ? PERSON : WisecallAPI.avatar({ name: m.name, color: m.color }, { cls: 'avatar-sm', size: 28 });
    $('.qa-name').textContent = ex ? [t('home2.qa.expert'), field].filter(Boolean).join(' · ') : (m.name || '');
    $('.qa-meta').hidden = ex;
    $('.qa-meta').textContent = ex ? '' : [`✓ ${t('home2.qa.verified')}`, m.roleTitle].filter(Boolean).join(' · ');
    $('.qa-qtext').textContent = q;
    $('.qa-sent').textContent = t('home2.qa.sent');
    // (on a phone the card has no header line: the answer's name says the field, or "verified", itself)
    $('.qa-aname').innerHTML = ex ? `${esc(t('home2.qa.expert'))}<span class="qa-afield">${field ? ` · ${esc(field)}` : ''}</span>`
      : `${esc(m.name || '')}<span class="qa-afield"> · ✓ ${esc(t('home2.qa.verified'))}</span>`;
    $('.qa-adays').textContent = ex ? t('home2.qa.exampleDays') : t(days === 1 ? 'home2.qa.days1' : 'home2.qa.days').replace('{n}', days);
    $('#qaCaption').textContent = (ex ? t('home2.qa.exampleCaption').replace('{field}', field) : t('home2.qa.caption').replace('{mentor}', m.name || ''))
      .replace('{question}', q).replace('{answer}', a);
    box.dataset.item = ex ? `example-${item.n}` : item.id;
    return { q, a, stars, ex };
  }

  // Plays the rotation: a different question and answer on each loop, fading between them; still while off screen or in a hidden tab. With
  // reduced motion: one of them, finished, and no rotation. The card keeps the height of its tallest conversation, so nothing below it moves.
  function playPhone(box, rotation) {
    const root = box.querySelector('.qa-phone');
    const $ = (sel) => root.querySelector(sel);
    const screen = $('.qa-screen');
    const dotsBox = $('.qa-dots');
    const typingDots = [...root.querySelectorAll('.qa-typing i')];
    const starEls = [...root.querySelectorAll('.qa-stars i')];
    const count = Math.min(4, Math.max(1, rotation.size));
    dotsBox.innerHTML = count > 1 ? '<i></i>'.repeat(count) : '';
    let cur; // { q, a, stars, ex, qChars, aChars, T }
    let played = 0;
    let tallest = 0;
    const show = (el, p, dy = 10) => {
      el.style.display = p <= 0 ? 'none' : '';
      el.style.opacity = String(clamp(p * 1.5));
      el.style.transform = `translateY(${(1 - back(p)) * dy}px) scale(${0.9 + 0.1 * back(p)})`;
    };
    function render(time) {
      const { qChars, aChars, T, stars } = cur;
      const S = T.S;
      // the question, letter by letter in its bubble, the cursor after it
      show($('.qa-q'), (time - 0.25) / 0.35, 12);
      const n = time < S ? T.TT.filter((x) => x <= time).length : qChars.length;
      $('.qa-qtext').innerHTML = esc(qChars.slice(0, n).join('')) + (time < S ? '<span class="qa-cur"></span>' : '');
      $('.qa-sent').style.opacity = String(clamp((time - S) / 0.3));
      // the typing dots, bouncing one after the other
      $('.qa-typing').style.display = time > S + 0.5 && time < S + 1.9 ? '' : 'none';
      typingDots.forEach((d, i) => { d.style.transform = `translateY(${-Math.max(0, Math.sin(time * 7 - i)) * 4}px)`; });
      // the answer, letter by letter
      show($('.qa-a'), (time - S - 1.9) / 0.45, 16);
      $('.qa-atext').textContent = aChars.slice(0, Math.floor(clamp((time - S - 2.0) / 1.6) * aChars.length)).join('');
      $('.qa-adays').style.opacity = String(clamp((time - S - 3.6) / 0.3));
      // the stars, one by one: only a real answer the student rated
      if (stars) {
        show($('.qa-rate'), (time - S - 3.8) / 0.3, 6);
        starEls.forEach((el, i) => {
          const p = i < stars ? clamp((time - S - 4.0 - i * 0.15) / 0.2) : 0;
          el.style.opacity = String(0.2 + 0.8 * p);
          el.style.transform = `scale(${1 + 0.4 * Math.sin(Math.PI * p)})`;
        });
        $('.qa-ratelabel').textContent = time > S + 4.9 ? t('home2.qa.thanks').replace('{n}', stars) : t('home2.qa.rate');
      } else $('.qa-rate').style.display = 'none';
      // the conversation fades out at the end of the loop and in at its start
      const L = T.loop;
      screen.style.opacity = String(time > L - 0.4 ? clamp((L - time) / 0.4) : time < 0.2 ? clamp(time / 0.2) : 1);
    }
    const set = (item) => {
      const f = fill(box, item);
      const qChars = [...f.q];
      cur = { ...f, qChars, aChars: [...f.a], T: timeline(qChars, f.stars) };
      dotsBox.querySelectorAll('i').forEach((d, i) => d.classList.toggle('is-on', i === played % count));
      played += 1;
      // (the finished conversation sets the card's height; it only grows)
      render(cur.T.loop - 1);
      tallest = Math.max(tallest, root.offsetHeight);
      root.style.minHeight = `${tallest}px`;
    };
    let elapsed = 0;
    set(rotation.next());
    const still = reduceMotion();
    phone = {
      // a field chosen above: its question and answer now, from the start (or finished, with reduced motion)
      showField(fieldId) {
        const item = rotation.jump((x) => WisecallI18n.fieldOfNiche(x.niche) === fieldId);
        if (!item) return;
        set(item);
        elapsed = 0;
        render(still ? cur.T.loop - 1 : 0);
        if (still) screen.style.opacity = '1';
      }
    };
    if (still) { render(cur.T.loop - 1); screen.style.opacity = '1'; return; }
    let visible = false;
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
    wireWayToForm();
    drawPhone();
    if (window.location.hash === '#join' && window.WisecallWaitlist) WisecallWaitlist.goToHero();
  })().catch(() => {});
  document.addEventListener('wisecall:lang-changed', () => { drawChips(); drawCount(); });
})();
