(async function () {
  await WisecallI18n.initI18n();
  const form = document.getElementById('signupForm');
  const errorEl = document.getElementById('formError');

  const params = new URLSearchParams(location.search);
  const redirect = WisecallAPI.safeRedirect(params.get('redirect'), '/dashboard.html');

  const ERROR_KEYS = {
    email_taken: 'auth.error.emailTaken',
    invalid_email: 'auth.error.invalidEmail',
    weak_password: 'auth.error.weakPassword',
    missing_fields: 'auth.error.missingFields'
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    try {
      const data = await WisecallAPI.apiFetch('/auth/signup', {
        method: 'POST',
        body: {
          name: document.getElementById('name').value.trim(),
          email: document.getElementById('email').value.trim(),
          password: document.getElementById('password').value,
          language: WisecallI18n.getLang()
        }
      });
      let verifyUrl = `/verify-email.html?redirect=${encodeURIComponent(redirect)}`;
      if (data.devMode && data.devVerifyCode) verifyUrl += `&devCode=${data.devVerifyCode}`;
      // The account exists but the email could not be sent (bank-grade rule: say so, never show the code).
      if (!data.emailSent && !data.devMode) verifyUrl += '&emailFailed=1';
      window.location.href = verifyUrl;
    } catch (e) {
      errorEl.textContent = WisecallI18n.t(ERROR_KEYS[e.code] || 'toast.error');
    }
  });
})();
