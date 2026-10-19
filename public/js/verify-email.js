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

  document.getElementById('resendLink').addEventListener('click', async (ev) => {
    ev.preventDefault();
    try {
      const data = await WisecallAPI.apiFetch('/auth/resend-verification', { method: 'POST' });
      if (data.devMode && data.devVerifyCode) {
        devCodeBox.style.display = 'block';
        devCodeBox.innerHTML = `<div class="hero-cta-banner">${WisecallI18n.t('auth.verify.devModeNote')} <strong class="mono">${data.devVerifyCode}</strong></div>`;
      }
      if (!data.emailSent && !data.devMode) {
        errorEl.textContent = WisecallI18n.t('auth.verify.sendFailed');
        return;
      }
      errorEl.textContent = '';
      WisecallNav.showToast(WisecallI18n.t('auth.verify.resent'));
    } catch (e) {
      WisecallNav.showToast(WisecallI18n.t('toast.error'));
    }
  });
})();
