// "Back to top" on long pages (home, help, FAQ, Terms, Privacy): it appears once the page has scrolled 1.5 screens, scrolls back
// smoothly (at once for people who ask for reduced motion), and moves the keyboard focus to the top of the page too.
// It never covers anything: it steps aside (fades out, cannot be clicked) while it would sit over text, a control or a card, it is hidden
// while someone types in a form, and it stays above the phone's safe area, the profile's bottom bar and the footer's last row.
(function () {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'back-to-top';
  btn.hidden = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg><span class="back-to-top-label"></span>';
  // (the text is set once the page's words have loaded, again when it appears and when the language changes)
  const label = () => {
    const text = window.WisecallI18n ? WisecallI18n.t('top.back') : '';
    btn.querySelector('.back-to-top-label').textContent = text && text !== 'top.back' ? text : 'Back to top';
  };
  document.addEventListener('wisecall:lang-changed', label);
  if (window.WisecallI18n && WisecallI18n.ready) WisecallI18n.ready.then(label);
  document.body.appendChild(btn);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  // What it must not cover (the page's sections and containers are background; these are not).
  const CONTENT = 'a, button, input, select, textarea, label, summary, p, h1, h2, h3, h4, li, dt, dd, blockquote, figure, img, video, iframe, td, th,'
    + ' .btn, .field-tile, .wl-card, .expert-card, .ask-panel, .booking-card, .stage, .bubble, .card';
  const FIELDS = 'input, select, textarea, [contenteditable="true"]';
  const covers = () => {
    const r = btn.getBoundingClientRect();
    if (!r.width) return false;
    // (a 4 x 4 grid of points over the button: anything at least about 13px wide and tall under it is found)
    const steps = [0, 1 / 3, 2 / 3, 1];
    const xs = steps.map((k) => r.left + 2 + k * (r.width - 4));
    const ys = steps.map((k) => r.top + 2 + k * (r.height - 4));
    return xs.some((x) => ys.some((y) => document.elementsFromPoint(x, y).some((el) => el !== btn && !btn.contains(el) && el.matches(CONTENT))));
  };
  let typing = false;
  let ticking = false;
  const update = () => {
    ticking = false;
    const show = window.scrollY >= window.innerHeight * 1.5 && !typing;
    if (show && btn.hidden) label();
    btn.hidden = !show;
    if (!show) return;
    // (above the footer's last row, the language switch, when that row is on screen; above the profile's bottom bar on a phone)
    let lift = 0;
    const bar = document.querySelector('.footer-bottom');
    const top = bar ? bar.getBoundingClientRect().top : Infinity;
    if (top < window.innerHeight) lift = Math.round(window.innerHeight - top) + 12;
    const askBar = document.querySelector('.ask-bar:not([hidden])');
    if (askBar) lift = Math.max(lift, Math.round(window.innerHeight - askBar.getBoundingClientRect().top) + 12);
    btn.style.bottom = lift ? `${lift}px` : '';
    btn.classList.toggle('is-aside', covers());
  };
  const later = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', later, { passive: true });
  window.addEventListener('resize', later, { passive: true });
  document.addEventListener('focusin', (ev) => { if (ev.target.closest && ev.target.closest(FIELDS)) { typing = true; later(); } });
  document.addEventListener('focusout', (ev) => { if (ev.target.closest && ev.target.closest(FIELDS)) { typing = false; later(); } });
  update();
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduce.matches ? 'auto' : 'smooth' });
    const target = document.getElementById('main') || document.querySelector('main') || document.querySelector('h1');
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  });
})();
