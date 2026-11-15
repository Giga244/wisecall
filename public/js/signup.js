(async function () {
  await WisecallI18n.initI18n();
  AuthUI.init();
  const form = document.getElementById('signupForm');
  const errorEl = document.getElementById('formError');
  const t = WisecallI18n.t;

  const params = new URLSearchParams(location.search);
  // (?as=mentor: the mentor's sign-up, with no username to choose (one is made from the name) and the application next)
  const asMentor = WisecallAPI.asMentor();
  const ageSlot = document.getElementById('ageFieldsSlot');
  if (!asMentor) { ageSlot.innerHTML = WisecallAgeFields.html(); WisecallAgeFields.wire(ageSlot); }
  const redirect = WisecallAPI.safeRedirect(params.get('redirect'), asMentor ? '/apply.html' : '/dashboard.html');
  WisecallAPI.keepMentorPath();

  // The username is the address of their profile (/u/<username>). It is suggested from the name until they type their own.
  const nameInput = document.getElementById('name');
  const usernameInput = document.getElementById('username');
  const usernameStatus = document.getElementById('usernameStatus');
  let usernameEdited = false, suggestTimer = null, checkTimer = null, checkSeq = 0;
  const USERNAME_TEXT = { username_taken: 'profile.username.taken', reserved_username: 'profile.username.reserved', invalid_username: 'profile.username.invalid' };
  let minorChosen = false;
  function drawUsernameHint() {
    document.getElementById('usernameHint').textContent = minorChosen ? t('auth.field.username.hintMinor')
      : `${location.origin}/u/${usernameInput.value.trim().toLowerCase() || '…'} — ${t('auth.field.username.hint')}`;
  }
  document.getElementById('signupForm').addEventListener('wisecall:age', (ev) => { minorChosen = ev.detail.minor; drawUsernameHint(); });
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
    missing_fields: 'auth.error.missingFields',
    adult_required: 'auth.mentor18',
    mentor_18: 'auth.mentor18',
    birth_required: 'age.required',
    parent_permission_required: 'age.parent.required',
    password_breached: 'auth.error.breached'
  };
  // Which field an error belongs to, so it can be marked and focused.
  const FIELD_FOR = { invalid_username: 'username', reserved_username: 'username', username_taken: 'username', email_taken: 'email', invalid_email: 'email', weak_password: 'password', missing_fields: 'name', adult_required: 'adult', birth_required: 'birthYear', parent_permission_required: 'parentPermission', password_breached: 'password' };

  const existing = document.getElementById('existingAccount');
  // (while the way into an existing account is offered, it is the page's main button; creating an account is the other one)
  const offerLogin = (on) => {
    existing.hidden = !on;
    const submit = form.querySelector('button[type="submit"]');
    submit.classList.toggle('btn-primary', !on);
    submit.classList.toggle('btn-outline', on);
  };
  function fail(message, fieldId) {
    errorEl.textContent = message;
    offerLogin(false);
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    const field = fieldId && document.getElementById(fieldId);
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  }
  // A box marked red is right again as soon as it is changed: the mark and its line go (they used to stay until the next try, so a box
  // that had just been filled in still looked wrong).
  const unmark = (ev) => {
    const el = ev.target;
    if (!el || !el.getAttribute || el.getAttribute('aria-invalid') !== 'true') return;
    el.removeAttribute('aria-invalid');
    errorEl.textContent = '';
    offerLogin(false);
  };
  form.addEventListener('input', unmark);
  form.addEventListener('change', unmark);
  // The email already has an account (a mentor who came back for their application, signed out, lands on this page): the way into it,
  // with the email carried to the log-in page (kept in this tab only, never in the address).
  document.getElementById('existingLogin').addEventListener('click', () => {
    try { sessionStorage.setItem('wisecall_login_email', document.getElementById('email').value.trim()); } catch (e) { /* typed again there */ }
  });

  WisecallTurnstile.watch(form);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    // (each box says what it needs, in words: not one "fill in every field" for whichever is empty)
    if (!name) { fail(t('auth.error.nameMissing'), 'name'); return; }
    if (!email) { fail(t('auth.error.emailMissing'), 'email'); return; }
    if (!password) { fail(t('auth.error.passwordMissing'), 'password'); return; }
    if (password.length < 8) { fail(t('auth.error.weakPassword'), 'password'); return; }
    if (asMentor && !document.getElementById('adult').checked) { fail(t('auth.mentor18'), 'adult'); return; }
    const birthYm = asMentor ? undefined : WisecallAgeFields.value(form);
    if (!asMentor && !birthYm) { fail(t('age.required'), 'birthYear'); return; }
    if (!asMentor && WisecallAgeFields.needsPermission(form)) { fail(t('age.parent.required'), 'parentPermission'); return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = await WisecallAPI.apiFetch('/auth/signup', {
        method: 'POST',
        body: { name, email, password, ...(asMentor ? { adult: true } : WisecallAgeFields.answer(form)), language: WisecallI18n.getLang(), as: asMentor ? 'mentor' : undefined, username: (!asMentor && usernameInput.value.trim().toLowerCase()) || undefined,
          turnstileToken: await WisecallTurnstile.token(form) }
      });
      // A mentor starts the application at once; the code was sent in the meantime and its box waits on step 5 and on the dashboard
      // (docs/CLAUDE-CODE-EMAIL-CODE-FIX.md: a company mail server can hold it for hours, and nothing may wait for it).
      if (asMentor) {
        const next = new URL(redirect, location.origin);
        if (data.devMode && data.devVerifyCode) next.searchParams.set('devCode', data.devVerifyCode);
        window.location.href = next.pathname + next.search;
        return;
      }
      let verifyUrl = `/verify-email.html?redirect=${encodeURIComponent(redirect)}${asMentor ? '&as=mentor' : ''}`;
      if (data.devMode && data.devVerifyCode) verifyUrl += `&devCode=${data.devVerifyCode}`;
      // The account exists but the email could not be sent (bank-grade rule: say so, never show the code).
      if (!data.emailSent && !data.devMode) verifyUrl += '&emailFailed=1';
      window.location.href = verifyUrl;
    } catch (e) {
      // (under 16: nothing was created and nothing was kept; a kind message takes the form's place)
      if (e.code === 'under_16') { WisecallAgeFields.under16(document.querySelector('.auth-card') || form); return; }
      fail(WisecallTurnstile.errorText(e.code) || t(ERROR_KEYS[e.code] || 'toast.error'), FIELD_FOR[e.code]);
      if (e.code === 'email_taken') offerLogin(true);
      WisecallTurnstile.reset(form);
      button.disabled = false;
    }
  });
})();
