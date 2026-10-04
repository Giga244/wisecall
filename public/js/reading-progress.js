// A thin reading-progress bar at the top of a help article (and, later, a blog article): how far through the article the reader is.
// Only on an article page (nothing on the help centre's list); decorative, so screen readers ignore it; no animation for reduced motion.
(function () {
  const article = document.querySelector('article.help-article, article.blog-article');
  if (!article) return;
  const bar = document.createElement('div');
  bar.className = 'reading-progress';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<span></span>';
  document.body.appendChild(bar);
  const fill = bar.firstChild;
  let ticking = false;
  const update = () => {
    ticking = false;
    const rect = article.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    const done = total <= 0 ? (rect.top < 0 ? 1 : 0) : Math.min(1, Math.max(0, -rect.top / total));
    fill.style.transform = `scaleX(${done})`;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
})();
