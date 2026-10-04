(async function () {
  await WisecallI18n.initI18n();
  AuthUI.init();
  const form = document.getElementById('loginForm');
  const errorEl = document.getElementById('formError');
  const t = WisecallI18n.t;

  window.WisecallTurnstile.watch(form);
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
      const r = await WisecallAPI.apiFetch('/auth/login', { method: 'POST', body: { email, password, turnstileToken: await WisecallTurnstile.token(form) } });
      if (r.twoFactorRequired) { showCodeStep(); return; }
      window.location.href = redirect;
    } catch (e) {
      errorEl.textContent = WisecallTurnstile.errorText(e.code) || t(e.code === 'invalid_credentials' ? 'auth.error.invalidCredentials' : 'toast.error');
      WisecallTurnstile.reset(form);
      button.disabled = false;
    }
  });

  // The second step, for an account with two-step verification on (after the password, or after Google: ?step=code).
  const codeForm = document.getElementById('codeForm');
  const codeInput = document.getElementById('loginCode');
  let recovery = false;
  function showCodeStep() {
    form.hidden = true;
    document.querySelectorAll('.google-block, .auth-switch').forEach((el) => { el.hidden = true; });
    codeForm.hidden = false;
    codeInput.focus();
  }
  document.getElementById('useRecovery').addEventListener('click', () => {
    recovery = !recovery;
    document.getElementById('codeLabel').textContent = t(recovery ? 'auth.twoStep.recovery' : 'auth.twoStep.code');
    document.getElementById('useRecovery').textContent = t(recovery ? 'auth.twoStep.useCode' : 'auth.twoStep.useRecovery');
    codeInput.value = '';
    codeInput.focus();
  });
  codeForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = document.getElementById('codeError');
    err.textContent = '';
    const value = codeInput.value.trim();
    if (!value) { err.textContent = t('auth.twoStep.empty'); return; }
    const button = codeForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await WisecallAPI.apiFetch('/auth/login/second-step', { method: 'POST', body: recovery ? { recoveryCode: value } : { code: value } });
      window.location.href = redirect;
    } catch (e) {
      err.textContent = t({ invalid_code: 'auth.twoStep.wrong', locked: 'auth.twoStep.locked', sign_in_again: 'auth.twoStep.again' }[e.code] || 'toast.error');
      if (e.code === 'sign_in_again') { codeForm.hidden = true; form.hidden = false; }
      button.disabled = false;
    }
  });
  if (params.get('step') === 'code') showCodeStep();
})();
