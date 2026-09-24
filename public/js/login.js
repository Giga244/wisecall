(async function () {
  await WisecallI18n.initI18n();
  const form = document.getElementById('loginForm');
  const errorEl = document.getElementById('formError');

  const params = new URLSearchParams(location.search);
  const redirect = WisecallAPI.safeRedirect(params.get('redirect'), '/dashboard.html');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    try {
      await WisecallAPI.apiFetch('/auth/login', {
        method: 'POST',
        body: {
          email: document.getElementById('email').value.trim(),
          password: document.getElementById('password').value
        }
      });
      window.location.href = redirect;
    } catch (e) {
      errorEl.textContent = WisecallI18n.t(e.code === 'invalid_credentials' ? 'auth.error.invalidCredentials' : 'toast.error');
    }
  });
})();
