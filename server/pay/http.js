// Small JSON-over-HTTPS helper shared by the bank integrations.
class ProviderError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.body = body;
  }
}

async function requestJson(url, { method = 'GET', headers = {}, json, form } = {}) {
  const init = { method, headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20000) };
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form).toString();
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new ProviderError(`network error calling ${new URL(url).host}: ${e.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  if (!res.ok) throw new ProviderError(`${method} ${new URL(url).pathname} failed with ${res.status}: ${text.slice(0, 300)}`, { status: res.status, body: data });
  return data;
}

module.exports = { requestJson, ProviderError };
