(function () {
  async function apiFetch(path, opts = {}) {
    const res = await fetch('/api' + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' },
      method: opts.method || 'GET',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || 'request_failed');
      err.code = data.error;
      err.message2 = data.message;
      err.data = data; // the rest of the answer (for example how long to wait)
      // An admin whose second step (an authenticator code) has run out: the page is loaded again, and the server then asks for the code.
      if ((err.code === 'two_factor_required' || err.code === 'two_factor_setup_required') && window.location.pathname === '/admin.html') {
        if (window.WisecallNav && window.WisecallI18n) window.WisecallNav.showToast(window.WisecallI18n.t('admin.tf.expired'));
        setTimeout(() => window.location.reload(), 1500);
      }
      throw err;
    }
    return data;
  }

  // Sends one file as the raw request body (used for private verification documents).
  async function uploadFile(path, file) {
    const res = await fetch('/api' + path, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Requested-With': 'wisecall', 'X-Filename': encodeURIComponent(file.name) },
      body: file
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || 'request_failed');
      err.code = data.error;
      throw err;
    }
    return data;
  }

  // Only ever redirect to a path on this site (never to another domain), e.g. after login: one "/" first (never "//" or "/\", which
  // browsers read as another site), no control character or blank anywhere (browsers drop a tab or a new line, so "/\t/evil.com" would
  // become "//evil.com"), and, read the way the browser will read it, still this site (docs/security-audit C7).
  function safeRedirect(value, fallback) {
    if (typeof value !== 'string' || !/^\/(?![\/\\])/.test(value) || /[\u0000- \u007f-\u009f\s]/.test(value)) return fallback;
    try {
      const u = new URL(value, window.location.origin);
      return u.origin === window.location.origin ? u.pathname + u.search + u.hash : fallback;
    } catch (e) { return fallback; }
  }

  // Money is Georgian lari. The server stores amounts as whole tetri (1/100 lari).
  const LARI = '₾';
  const formatPrice = (lari) => `${Number(lari)} ${LARI}`;
  const formatAmount = (tetri) => `${(tetri / 100).toFixed(2)} ${LARI}`;
  // The length the server counts for a question or an answer: blanks at both ends removed, a run of blanks counted once.
  const textLength = (s) => [...String(s).replace(/\r\n?/g, '\n').trim().replace(/\s+/g, ' ')].length;

  // The style attribute for a round initials badge: the person's colour, with white or dark text, whichever is
  // easier to read on it (WCAG AA, 4.5:1). Only #rrggbb colours are used, so the value is safe to put in HTML.
  function avatarStyle(color) {
    let hex = /^#[0-9a-f]{6}$/i.test(color || '') ? color.toLowerCase() : '#6d4de0';
    const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
    const ink = '#25213b';
    const onWhite = (h) => 1.05 / (lum(h) + 0.05), onInk = (h) => (lum(h) + 0.05) / (lum(ink) + 0.05);
    // A colour that neither white nor dark text can read on (middle brightness) is darkened a little until white can.
    for (let i = 0; i < 12 && Math.max(onWhite(hex), onInk(hex)) < 4.5; i++) {
      hex = '#' + [1, 3, 5].map((k) => Math.round(parseInt(hex.slice(k, k + 2), 16) * 0.93).toString(16).padStart(2, '0')).join('');
    }
    return `background:${hex};color:${onWhite(hex) >= onInk(hex) ? '#fff' : ink}`;
  }

  // The round picture of a person: their photo when they have one, otherwise their initials on their colour.
  // p: { name, color, photoUrl }. size is the width in pixels (48 by default; the page's CSS class may change it).
  const escapeAttr = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initialsOf = (name) => String(name || '?').split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  function avatar(p, { cls = '', size = 48 } = {}) {
    if (p && p.photoUrl) return `<img class="avatar avatar-photo ${cls}" src="${escapeAttr(p.photoUrl)}" alt="" width="${size}" height="${size}" decoding="async">`;
    return `<div class="avatar ${cls}" style="${avatarStyle(p && p.color)}" aria-hidden="true">${escapeAttr(initialsOf(p && p.name))}</div>`;
  }

  // Every form control has a real <label for="id">: a label that wraps a control (in a page or in a template a script draws
  // later) is tied to it by id, so a screen reader reads the label text and not the placeholder or a bare "on".
  let controlCount = 0;
  function linkLabels(root) {
    root.querySelectorAll('label:not([for])').forEach((label) => {
      const control = label.querySelector('input, select, textarea');
      if (!control) return;
      if (!control.id) control.id = 'control-' + (++controlCount);
      label.htmlFor = control.id;
    });
  }
  let linkQueued = false;
  const scheduleLinking = () => {
    if (linkQueued) return;
    linkQueued = true;
    requestAnimationFrame(() => { linkQueued = false; linkLabels(document); });
  };
  scheduleLinking();
  new MutationObserver(scheduleLinking).observe(document.documentElement, { childList: true, subtree: true });

  window.WisecallAPI = { apiFetch, uploadFile, safeRedirect, formatPrice, formatAmount, textLength, avatarStyle, avatar, initialsOf, linkLabels };
})();
