// Development only: loaded by i18n.js when the server says it is not in production. Logs (in the browser console)
// every element that sticks out past the edge of the screen and whether the page scrolls sideways, so a layout
// that is too wide for a phone is noticed while building, at any width you resize the window to.
(function () {
  function check() {
    const vw = document.documentElement.clientWidth;
    const wide = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (el.closest('[hidden]')) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return;
      const r = el.getBoundingClientRect();
      if (!r.width || (r.right <= vw + 1 && r.left >= -1)) return;
      // inside something that scrolls sideways or clips on purpose (a swipe row, the hero's blobs): fine
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return;
      }
      wide.push({ el, right: Math.round(r.right), left: Math.round(r.left) });
    });
    const page = document.documentElement.scrollWidth;
    if (page > vw + 1) console.warn(`[layout] the page scrolls sideways: it is ${page}px wide in a ${vw}px window`);
    wide.slice(0, 20).forEach((w) => console.warn(`[layout] wider than the ${vw}px screen (right edge at ${w.right}px, left at ${w.left}px):`, w.el));
    if (wide.length > 20) console.warn(`[layout] ...and ${wide.length - 20} more`);
  }
  let timer;
  const later = () => { clearTimeout(timer); timer = setTimeout(check, 400); };
  window.addEventListener('load', later);
  window.addEventListener('resize', later);
  document.addEventListener('wisecall:lang-changed', later);
})();
