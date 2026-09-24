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

  // Only ever redirect to a path on this site (never to another domain), e.g. after login.
  function safeRedirect(value, fallback) {
    return typeof value === 'string' && /^\/(?![\/\\])/.test(value) ? value : fallback;
  }

  // Money is Georgian lari. The server stores amounts as whole tetri (1/100 lari).
  const LARI = '₾';
  const formatPrice = (lari) => `${Number(lari)} ${LARI}`;
  const formatAmount = (tetri) => `${(tetri / 100).toFixed(2)} ${LARI}`;

  window.WisecallAPI = { apiFetch, safeRedirect, formatPrice, formatAmount };
})();
