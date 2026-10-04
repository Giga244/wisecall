// "Back to top" on long pages (home, help, FAQ, Terms, Privacy): it appears once the page has scrolled 1.5 screens, scrolls back
// smoothly (at once for people who ask for reduced motion), and moves the keyboard focus to the top of the page too.
(function () {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'back-to-top';
  btn.hidden = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg><span class="back-to-top-label"></span>';
  // (the text is set when the button appears: by then the page's words have loaded)
  const label = () => { btn.querySelector('.back-to-top-label').textContent = window.WisecallI18n ? WisecallI18n.t('top.back') : 'Back to top'; };
  document.addEventListener('wisecall:lang-changed', label);
  document.body.appendChild(btn);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let ticking = false;
  const update = () => {
    ticking = false;
    const show = window.scrollY >= window.innerHeight * 1.5;
    if (show && btn.hidden) label();
    btn.hidden = !show;
    // (it rises above the footer's last row, the language switch, when that row is on screen)
    const bar = document.querySelector('.footer-bottom');
    const top = bar ? bar.getBoundingClientRect().top : Infinity;
    btn.style.bottom = top < window.innerHeight ? `${Math.round(window.innerHeight - top) + 12}px` : '';
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update, { passive: true });
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
