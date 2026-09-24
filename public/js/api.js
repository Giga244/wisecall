(function () {
  async function apiFetch(path, opts = {}) {
    const res = await fetch('/api' + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
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

  window.SagelyAPI = { apiFetch };
})();
