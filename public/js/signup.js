(async function () {
  await WisecallI18n.initI18n();
  AuthUI.init();
  const form = document.getElementById('signupForm');
  const errorEl = document.getElementById('formError');
  const t = WisecallI18n.t;

  const params = new URLSearchParams(location.search);
  const redirect = WisecallAPI.safeRedirect(params.get('redirect'), '/dashboard.html');

  // The username is the address of their profile (/u/<username>). It is suggested from the name until they type their own.
  const nameInput = document.getElementById('name');
  const usernameInput = document.getElementById('username');
  const usernameStatus = document.getElementById('usernameStatus');
  let usernameEdited = false, suggestTimer = null, checkTimer = null, checkSeq = 0;
  const USERNAME_TEXT = { username_taken: 'profile.username.taken', reserved_username: 'profile.username.reserved', invalid_username: 'profile.username.invalid' };
  function drawUsernameHint() {
    document.getElementById('usernameHint').textContent = `${location.origin}/u/${usernameInput.value.trim().toLowerCase() || '…'} — ${t('auth.field.username.hint')}`;
  }
  function setUsernameStatus(key, tone) {
    usernameStatus.textContent = key ? t(key) : '';
    usernameStatus.className = 'hint username-status' + (tone ? ' is-' + tone : '');
  }
  function checkUsername() {
    clearTimeout(checkTimer);
    drawUsernameHint();
    const value = usernameInput.value.trim().toLowerCase();
    if (!value) { setUsernameStatus(null); return; }
    const seq = ++checkSeq;
    checkTimer = setTimeout(async () => {
      try {
        const r = await WisecallAPI.apiFetch('/username/check?u=' + encodeURIComponent(value));
        if (seq !== checkSeq) return;
        if (r.available) setUsernameStatus('profile.username.free', 'ok');
        else setUsernameStatus(USERNAME_TEXT[r.reason] || 'profile.username.invalid', 'bad');
      } catch (e) { if (seq === checkSeq) setUsernameStatus(null); }
    }, 300);
  }
  nameInput.addEventListener('input', () => {
    if (usernameEdited) return;
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      if (usernameEdited || !nameInput.value.trim()) return;
      try {
        const r = await WisecallAPI.apiFetch('/username/suggest?name=' + encodeURIComponent(nameInput.value.trim()));
        if (!usernameEdited && r.username) { usernameInput.value = r.username; checkUsername(); }
      } catch (e) { /* the field can be filled in by hand */ }
    }, 400);
  });
  usernameInput.addEventListener('input', () => { usernameEdited = true; checkUsername(); });
  document.addEventListener('wisecall:lang-changed', () => { drawUsernameHint(); checkUsername(); });
  drawUsernameHint();

  const ERROR_KEYS = {
    invalid_username: 'profile.username.invalid',
    reserved_username: 'profile.username.reserved',
    username_taken: 'profile.username.taken',
    email_taken: 'auth.error.emailTaken',
    invalid_email: 'auth.error.invalidEmail',
    weak_password: 'auth.error.weakPassword',
    missing_fields: 'auth.error.missingFields'
  };
  // Which field an error belongs to, so it can be marked and focused.
  const FIELD_FOR = { invalid_username: 'username', reserved_username: 'username', username_taken: 'username', email_taken: 'email', invalid_email: 'email', weak_password: 'password', missing_fields: 'name' };

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
        body: { name, email, password, language: WisecallI18n.getLang(), username: usernameInput.value.trim().toLowerCase() || undefined }
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
