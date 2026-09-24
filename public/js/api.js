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

  // Only ever redirect to a path on this site (never to another domain), e.g. after login.
  function safeRedirect(value, fallback) {
    return typeof value === 'string' && /^\/(?![\/\\])/.test(value) ? value : fallback;
  }

  // Money is Georgian lari. The server stores amounts as whole tetri (1/100 lari).
  const LARI = '₾';
  const formatPrice = (lari) => `${Number(lari)} ${LARI}`;
  const formatAmount = (tetri) => `${(tetri / 100).toFixed(2)} ${LARI}`;

  // The style attribute for a round initials badge: the person's colour, with white or dark text, whichever is
  // easier to read on it (WCAG AA, 4.5:1). Only #rrggbb colours are used, so the value is safe to put in HTML.
  function avatarStyle(color) {
    let hex = /^#[0-9a-f]{6}$/i.test(color || '') ? color.toLowerCase() : '#6d4de0';
    const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
    const ink = '#2b2440';
    const onWhite = (h) => 1.05 / (lum(h) + 0.05), onInk = (h) => (lum(h) + 0.05) / (lum(ink) + 0.05);
    // A colour that neither white nor dark text can read on (middle brightness) is darkened a little until white can.
    for (let i = 0; i < 12 && Math.max(onWhite(hex), onInk(hex)) < 4.5; i++) {
      hex = '#' + [1, 3, 5].map((k) => Math.round(parseInt(hex.slice(k, k + 2), 16) * 0.93).toString(16).padStart(2, '0')).join('');
    }
    return `background:${hex};color:${onWhite(hex) >= onInk(hex) ? '#fff' : ink}`;
  }

  window.WisecallAPI = { apiFetch, uploadFile, safeRedirect, formatPrice, formatAmount, avatarStyle };
})();
