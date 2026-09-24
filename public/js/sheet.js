// A bottom sheet for phones: a panel that slides up over the page, used for Browse's filters and the expert page's
// question form. While it is open the page behind it cannot scroll or be reached with the keyboard, Esc, the close
// button and the backdrop close it, focus stays inside, and focus returns to the button that opened it.
//
//   markup:  <div class="sheet" id="x" hidden>
//              <div class="sheet-backdrop" data-sheet-close></div>
//              <div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="xTitle"> ... [data-sheet-close] ... </div>
//            </div>
//   script:  const sheet = WisecallSheet.create(document.getElementById('x'));  sheet.open(button);  sheet.close();
(function () {
  function create(el, hooks) {
    const panel = el.querySelector('.sheet-panel');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let trigger = null, closing = null;
    const behind = () => Array.from(document.body.children).filter((n) => n !== el && !n.matches('script, .toast, .sheet'));
    const focusable = () => Array.from(panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((n) => n.offsetParent !== null);

    function open(from) {
      clearTimeout(closing);
      trigger = from || document.activeElement;
      el.hidden = false;
      document.documentElement.classList.add('sheet-open');
      if (trigger && trigger.setAttribute) trigger.setAttribute('aria-expanded', 'true');
      behind().forEach((n) => { n.inert = true; });
      requestAnimationFrame(() => {
        el.classList.add('is-open');
        const first = panel.querySelector('[data-sheet-focus]') || focusable()[0] || panel;
        first.focus({ preventScroll: true });
      });
      if (hooks && hooks.onOpen) hooks.onOpen();
    }
    function close(returnFocus) {
      if (el.hidden) return;
      el.classList.remove('is-open');
      document.documentElement.classList.remove('sheet-open');
      if (trigger && trigger.setAttribute) trigger.setAttribute('aria-expanded', 'false');
      behind().forEach((n) => { n.inert = false; });
      closing = setTimeout(() => { el.hidden = true; }, reduce.matches ? 0 : 260);
      if (returnFocus !== false && trigger && trigger.focus) trigger.focus();
      if (hooks && hooks.onClose) hooks.onClose();
    }

    el.addEventListener('click', (ev) => { if (ev.target.closest('[data-sheet-close]')) close(); });
    document.addEventListener('keydown', (ev) => {
      if (el.hidden) return;
      if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
      if (ev.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { ev.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (ev.shiftKey && (document.activeElement === first || document.activeElement === panel)) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
    return { open, close, isOpen: () => !el.hidden };
  }
  window.WisecallSheet = { create };
})();
