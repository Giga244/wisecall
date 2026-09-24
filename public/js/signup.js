(async function () {
  await WisecallI18n.initI18n();
  AuthUI.init();
  const form = document.getElementById('signupForm');
  const errorEl = document.getElementById('formError');
  const t = WisecallI18n.t;

  const params = new URLSearchParams(location.search);
  const redirect = WisecallAPI.safeRedirect(params.get('redirect'), '/dashboard.html');

  const ERROR_KEYS = {
    email_taken: 'auth.error.emailTaken',
    invalid_email: 'auth.error.invalidEmail',
    weak_password: 'auth.error.weakPassword',
    missing_fields: 'auth.error.missingFields'
  };
  // Which field an error belongs to, so it can be marked and focused.
  const FIELD_FOR = { email_taken: 'email', invalid_email: 'email', weak_password: 'password', missing_fields: 'name' };

  function fail(message, fieldId) {
    errorEl.textContent = message;
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    const field = fieldId && document.getElementById(fieldId);
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!name || !email || !password) { fail(t('auth.error.missingFields'), !name ? 'name' : (!email ? 'email' : 'password')); return; }
    if (password.length < 8) { fail(t('auth.error.weakPassword'), 'password'); return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = await WisecallAPI.apiFetch('/auth/signup', {
        method: 'POST',
        body: { name, email, password, language: WisecallI18n.getLang() }
      });
      let verifyUrl = `/verify-email.html?redirect=${encodeURIComponent(redirect)}`;
      if (data.devMode && data.devVerifyCode) verifyUrl += `&devCode=${data.devVerifyCode}`;
      // The account exists but the email could not be sent (bank-grade rule: say so, never show the code).
      if (!data.emailSent && !data.devMode) verifyUrl += '&emailFailed=1';
      window.location.href = verifyUrl;
    } catch (e) {
      fail(t(ERROR_KEYS[e.code] || 'toast.error'), FIELD_FOR[e.code]);
      button.disabled = false;
    }
  });
})();
