(async function () {
  await WisecallI18n.initI18n();
  AuthUI.init();
  const form = document.getElementById('loginForm');
  const errorEl = document.getElementById('formError');
  const t = WisecallI18n.t;

  const params = new URLSearchParams(location.search);
  const redirect = WisecallAPI.safeRedirect(params.get('redirect'), '/dashboard.html');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!email || !password) { errorEl.textContent = t('auth.error.missingFields'); (email ? document.getElementById('password') : document.getElementById('email')).focus(); return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await WisecallAPI.apiFetch('/auth/login', { method: 'POST', body: { email, password } });
      window.location.href = redirect;
    } catch (e) {
      errorEl.textContent = t(e.code === 'invalid_credentials' ? 'auth.error.invalidCredentials' : 'toast.error');
      button.disabled = false;
    }
  });
})();
