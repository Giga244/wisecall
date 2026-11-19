// A row of filter chips that scrolls sideways (Browse experts: the fields). Visual only: it moves the row and shows or hides two round buttons.
//   <div class="chips-scroll">
//     <div class="field-chips">...chips, drawn by another script...</div>
//     <button data-chips-prev hidden>, <button data-chips-next hidden>
//   </div>
// The right button scrolls the row by about 70% of its width, smoothly (at once for a person who asked for less motion); the left one
// appears once the row has been scrolled. Each is hidden when there is nothing more to scroll that way: updated when the row scrolls,
// when its size changes (a resize, a font that arrives) and when the chips are drawn again. On a touch screen the buttons are not shown
// (public/css/home.css): swiping does it.
(function () {
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function wire(wrap) {
    const row = wrap.querySelector('.field-chips');
    const prev = wrap.querySelector('[data-chips-prev]');
    const next = wrap.querySelector('[data-chips-next]');
    if (!row || !prev || !next) return;

    const update = () => {
      const max = row.scrollWidth - row.clientWidth;
      const canPrev = max > 2 && row.scrollLeft > 2;
      const canNext = max > 2 && row.scrollLeft < max - 2;
      prev.hidden = !canPrev;
      next.hidden = !canNext;
      // (the fade at the right edge is only there while there is more to see)
      wrap.dataset.moreRight = canNext ? 'true' : 'false';
      wrap.dataset.moreLeft = canPrev ? 'true' : 'false';
    };
    const by = (sign) => row.scrollBy({ left: sign * Math.round(row.clientWidth * 0.7), behavior: reduced() ? 'auto' : 'smooth' });
    prev.addEventListener('click', () => by(-1));
    next.addEventListener('click', () => by(1));
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    if ('ResizeObserver' in window) new ResizeObserver(update).observe(row);
    new MutationObserver(update).observe(row, { childList: true, subtree: true });
    // (a Georgian or bold font arriving changes how wide the chips are)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(update);
    update();
  }

  document.querySelectorAll('.chips-scroll').forEach(wire);
})();
