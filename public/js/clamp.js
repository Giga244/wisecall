// A short bio on a card (docs/CLAUDE-CODE-FINISH.md, the mentor bio decision): the text is clamped by CSS (3 lines, 2 on a small phone,
// ending in "…"); its "Read more →" shows only when the text really is cut. The stored bio is never shortened: only what a card shows.
// WisecallClamp.watch(root): every [data-clamp] text in root, with its [data-clamp-more] next to it, checked now, when the card changes
// size and when the fonts arrive.
(function () {
  const cut = (el) => el.scrollHeight > el.clientHeight + 1;
  const check = (el) => {
    const more = el.parentElement && el.parentElement.querySelector('[data-clamp-more]');
    if (more) more.hidden = !cut(el);
  };
  const seen = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => entries.forEach((e) => check(e.target))) : null;
  function watch(root) {
    const all = [...(root || document).querySelectorAll('[data-clamp]')];
    all.forEach((el) => { check(el); if (seen) seen.observe(el); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => all.forEach(check));
  }
  window.WisecallClamp = { watch, cut };
})();
