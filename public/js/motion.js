// Motion on every page (styles in style.css, "Motion"). No library, nothing that blocks input or moves the layout:
//   - [data-reveal]: a section or card fades and rises in once, when a fifth of it (or of the screen) is in view
//   - [data-reveal-stagger]: its children follow one another when it is revealed (also children drawn later by a script)
//   - WisecallMotion.bump(el, text): a small "+1" that pops from a number (the live question panel's upvotes)
// With prefers-reduced-motion none of it runs: theme-init.js does not set "motion" on <html>, so nothing waits to be revealed.
(function () {
  var root = document.documentElement;
  var calm = !root.classList.contains('motion');
  var io = null;

  function reveal(el) { el.classList.add('is-in'); }

  if (!calm && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        // (a fifth of the element, or for a tall one a fifth of the screen)
        if (e.intersectionRatio >= 0.2 || e.intersectionRect.height >= window.innerHeight * 0.2) { reveal(e.target); io.unobserve(e.target); }
      });
    }, { threshold: [0, 0.1, 0.2, 0.4] });
  }

  function observe(scope) {
    var els = (scope || document).querySelectorAll('[data-reveal]:not(.is-in)');
    for (var i = 0; i < els.length; i++) { if (io) io.observe(els[i]); else reveal(els[i]); }
  }

  function bump(el, text) {
    if (!el) return;
    el.classList.remove('is-bumped');
    void el.offsetWidth; // (restart the animation)
    el.classList.add('is-bumped');
    if (calm || !text) return;
    var plus = document.createElement('span');
    plus.className = 'bump-plus';
    plus.setAttribute('aria-hidden', 'true');
    plus.textContent = text;
    el.appendChild(plus);
    setTimeout(function () { if (plus.parentNode) plus.parentNode.removeChild(plus); }, 900);
  }

  // Pages fetched or prepared ahead (the speculation rules: on hover, or for the most common next pages) are not counted by the
  // server when they are fetched (server/analytics.js); the page says so itself once somebody really opens it.
  function countIfAhead() {
    var nav = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    var ahead = nav && (nav.deliveryType === 'navigational-prefetch' || nav.activationStart > 0);
    if (!ahead || !window.fetch) return;
    fetch('/api/stats/pageview', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: JSON.stringify({ path: location.pathname }) }).catch(function () { /* not counted, then */ });
  }
  if (document.prerendering) document.addEventListener('prerenderingchange', countIfAhead, { once: true });
  else countIfAhead();

  window.WisecallMotion = { observe: observe, reveal: reveal, bump: bump, calm: function () { return calm; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { observe(); });
  else observe();
})();
