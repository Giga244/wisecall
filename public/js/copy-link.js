// "Copy link": copies an address with the Clipboard API (or, where that is not allowed, the older way) and says "Copied!" on the button
// for two seconds (read out by screen readers too).
//   WisecallCopy.button(url)   the button's HTML        WisecallCopy.wire(root)   makes the buttons in root work
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* not allowed: the older way below */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
  const button = (url) => `<button type="button" class="btn btn-outline btn-sm copy-link" data-url="${esc(url)}">${ICON}<span class="copy-label" aria-live="polite">${esc(t('copy.link'))}</span></button>`;

  function wire(root) {
    (root || document).querySelectorAll('.copy-link:not([data-wired])').forEach((b) => {
      b.dataset.wired = '1';
      let timer = null;
      b.addEventListener('click', async () => {
        const ok = await copy(b.dataset.url || location.href);
        const label = b.querySelector('.copy-label') || b;
        label.textContent = t(ok ? 'copy.done' : 'copy.failed');
        b.classList.toggle('copied', ok);
        clearTimeout(timer);
        timer = setTimeout(() => { label.textContent = t('copy.link'); b.classList.remove('copied'); }, 2000);
      });
    });
  }

  window.WisecallCopy = { copy, button, wire };
})();
