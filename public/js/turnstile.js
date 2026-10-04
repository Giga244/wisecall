// The "are you a person?" check (Cloudflare Turnstile) on the forms bots like. Only when the server has the keys (/api/config
// turnstileSiteKey): otherwise nothing is loaded and token() gives nothing. Cloudflare's script is loaded only once somebody starts
// filling in a form (watch), so a visitor who only reads the page never loads it. A token works once: reset() after every answer.
(function () {
  const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  let loader = null;
  const state = new WeakMap(); // form -> { id, token, waiters }
  const siteKey = async () => ((await WisecallI18n.getConfig()) || {}).turnstileSiteKey || null;

  function load() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!loader) {
      loader = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SRC;
        s.async = true;
        s.onload = () => resolve(window.turnstile);
        s.onerror = () => { loader = null; reject(new Error('turnstile_unavailable')); };
        document.head.appendChild(s);
      });
    }
    return loader;
  }

  async function render(form) {
    const key = await siteKey();
    if (!key) return null;
    if (state.has(form)) return state.get(form);
    const st = { id: null, token: '', waiters: [] };
    state.set(form, st);
    const box = document.createElement('div');
    box.className = 'turnstile-box';
    const button = form.querySelector('button[type="submit"]');
    const row = button && button.closest('.waitlist-row');
    if (row) row.after(box); else if (button) button.before(box); else form.append(box);
    const done = (t) => { st.token = t || ''; st.waiters.splice(0).forEach((w) => w(st.token)); };
    try {
      const ts = await load();
      const pref = document.documentElement.getAttribute('data-theme');
      st.id = ts.render(box, {
        sitekey: key, language: WisecallI18n.getLang(), theme: pref === 'dark' || pref === 'light' ? pref : 'auto', size: 'flexible',
        callback: done, 'expired-callback': () => { st.token = ''; }, 'error-callback': () => { done(''); return true; }
      });
    } catch (e) { done(''); }
    return st;
  }

  // Starts the check as soon as somebody uses the form.
  function watch(form) {
    if (!form || form.dataset.turnstileWatch) return;
    form.dataset.turnstileWatch = '1';
    form.addEventListener('focusin', () => { render(form).catch(() => {}); }, { once: true });
  }

  // The token for this form (waits for the check, at most 30 seconds); undefined when the check is off.
  async function token(form) {
    const key = await siteKey();
    if (!key) return undefined;
    const st = await render(form).catch(() => null);
    if (!st) return '';
    if (st.token) return st.token;
    return new Promise((resolve) => { st.waiters.push(resolve); setTimeout(() => resolve(st.token || ''), 30000); });
  }

  function reset(form) {
    const st = state.get(form);
    if (!st || st.id === null || !window.turnstile) return;
    st.token = '';
    try { window.turnstile.reset(st.id); } catch (e) { /* the widget is gone */ }
  }

  // The text for a refused check, or null for any other error.
  function errorText(code) {
    if (code === 'human_check_failed') return WisecallI18n.t('human.failed');
    if (code === 'human_check_unavailable') return WisecallI18n.t('human.unavailable');
    return null;
  }

  window.WisecallTurnstile = { watch, token, reset, errorText };
})();
