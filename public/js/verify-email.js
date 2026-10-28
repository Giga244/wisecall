(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const asMentor = WisecallAPI.asMentor();
  if (!user) { window.location.href = asMentor ? '/login.html?redirect=' + encodeURIComponent('/verify-email.html?as=mentor') + '&as=mentor' : '/login.html?redirect=/verify-email.html'; return; }

  const params = new URLSearchParams(location.search);
  const redirect = WisecallAPI.safeRedirect(params.get('redirect'), asMentor ? '/apply.html' : '/dashboard.html');
  // (the mentor's sign-up: "Skip for now" leads to the application too, which says the email is still to be confirmed)
  const skip = document.querySelector('.auth-switch a[href="/dashboard.html"]');
  if (skip && asMentor) skip.setAttribute('href', redirect);
  // The mentor's sign-up makes the account a mentor applicant once the email is confirmed (the same as "Become a mentor" in Settings).
  const becomeMentor = async () => {
    if (!asMentor || user.role === 'mentor' || user.role === 'both') return;
    try { await WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { becomeMentor: true } }); } catch (e) { /* the application page does it again */ }
  };
  const form = document.getElementById('verifyForm');
  const errorEl = document.getElementById('formError');
  const devCodeBox = document.getElementById('devCodeBox');

  if (user.emailVerified) {
    await becomeMentor();
    window.location.href = redirect;
    return;
  }

  // The on-screen code is a local-development helper only. It is shown only if the server itself
  // says it is not in production, so a crafted ?devCode= link can never show anything to a real user.
  let devMode = false;
  try { devMode = Boolean((await WisecallAPI.apiFetch('/config')).devMode); } catch (e) { /* treat as production */ }
  const devCode = (params.get('devCode') || '').replace(/\D/g, '').slice(0, 6);
  if (devMode && devCode) {
    devCodeBox.style.display = 'block';
    devCodeBox.innerHTML = `<div class="hero-cta-banner">${WisecallI18n.t('auth.verify.devModeNote')} <strong class="mono">${devCode}</strong></div>`;
  }
  if (params.get('emailFailed') === '1') errorEl.textContent = WisecallI18n.t('auth.verify.sendFailed');

  // Where the code went (a typo shows at once), and "Change email" to correct it: a new code goes to the new address.
  const t = WisecallI18n.t;
  let address = user.email;
  const toText = document.getElementById('verifyToText');
  const showAddress = () => { toText.textContent = t('auth.verify.sentTo').replace('{email}', address); document.getElementById('verifyTo').hidden = false; };
  showAddress();
  document.addEventListener('wisecall:lang-changed', () => { showAddress(); tick(); });
  const changeBtn = document.getElementById('changeEmailBtn');
  const changeForm = document.getElementById('changeEmailForm');
  const changeError = document.getElementById('changeError');
  changeBtn.addEventListener('click', () => {
    changeForm.hidden = !changeForm.hidden;
    changeBtn.setAttribute('aria-expanded', String(!changeForm.hidden));
    if (!changeForm.hidden) document.getElementById('newEmail').focus();
  });
  const showDevCode = (data) => {
    if (data.devMode && data.devVerifyCode) {
      devCodeBox.style.display = 'block';
      devCodeBox.innerHTML = `<div class="hero-cta-banner">${t('auth.verify.devModeNote')} <strong class="mono">${data.devVerifyCode}</strong></div>`;
    }
  };
  changeForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    changeError.textContent = '';
    const email = document.getElementById('newEmail').value.trim();
    try {
      const data = await WisecallAPI.apiFetch('/auth/change-unconfirmed-email', { method: 'POST', body: { email } });
      address = data.user.email;
      showAddress();
      changeForm.hidden = true;
      changeBtn.setAttribute('aria-expanded', 'false');
      showDevCode(data);
      if (!data.emailSent && !data.devMode) { errorEl.textContent = t('auth.verify.sendFailed'); return; }
      WisecallNav.showToast(t('auth.verify.changed').replace('{email}', address));
      startCountdown();
    } catch (e) {
      const map = { invalid_email: 'auth.error.invalidEmail', email_taken: 'auth.error.emailTaken', same_email: 'auth.verify.sameEmail', too_many_requests: 'auth.verify.tooMany' };
      changeError.textContent = t(map[e.code] || 'toast.error');
    }
  });

  // "Resend code": then a countdown before it can be asked again (the server keeps its own limit too).
  const WAIT_S = 60;
  const resendBtn = document.getElementById('resendBtn');
  let until = 0;
  let timer = null;
  function tick() {
    const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    resendBtn.disabled = left > 0;
    resendBtn.textContent = left > 0 ? t('auth.verify.resendIn').replace('{s}', left) : t('auth.verify.resendBtn');
    if (!left && timer) { clearInterval(timer); timer = null; }
  }
  function startCountdown() {
    until = Date.now() + WAIT_S * 1000;
    if (!timer) timer = setInterval(tick, 1000);
    tick();
  }
  // (the code was sent a moment ago, at sign-up: the first resend waits a minute too)
  if (params.get('emailFailed') !== '1') startCountdown();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await WisecallAPI.apiFetch('/auth/verify-email', { method: 'POST', body: { code: document.getElementById('code').value.trim() } });
      WisecallNav.showToast(WisecallI18n.t('auth.verify.success'));
      await becomeMentor();
      window.location.href = redirect;
    } catch (e) {
      const map = { invalid_code: 'auth.verify.invalidCode', expired: 'auth.verify.expiredCode', no_pending_code: 'auth.verify.noPendingCode', too_many_attempts: 'auth.verify.tooManyAttempts' };
      errorEl.textContent = WisecallI18n.t(map[e.code] || 'toast.error');
      submitBtn.disabled = false;
    }
  });

  resendBtn.addEventListener('click', async () => {
    if (resendBtn.disabled) return;
    resendBtn.disabled = true;
    try {
      const data = await WisecallAPI.apiFetch('/auth/resend-verification', { method: 'POST' });
      showDevCode(data);
      startCountdown();
      if (!data.emailSent && !data.devMode) {
        errorEl.textContent = t('auth.verify.sendFailed');
        return;
      }
      errorEl.textContent = '';
      WisecallNav.showToast(t('auth.verify.resent'));
    } catch (e) {
      WisecallNav.showToast(t(e.code === 'too_many_requests' ? 'auth.verify.tooMany' : 'toast.error'));
      tick();
    }
  });
})();
