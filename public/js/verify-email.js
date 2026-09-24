(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  if (!user) { window.location.href = '/login.html?redirect=/verify-email.html'; return; }

  const params = new URLSearchParams(location.search);
  const redirect = WisecallAPI.safeRedirect(params.get('redirect'), '/dashboard.html');
  const form = document.getElementById('verifyForm');
  const errorEl = document.getElementById('formError');
  const devCodeBox = document.getElementById('devCodeBox');

  if (user.emailVerified) {
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
      window.location.href = redirect;
    } catch (e) {
      const map = { invalid_code: 'auth.verify.invalidCode', expired: 'auth.verify.expiredCode', no_pending_code: 'auth.verify.noPendingCode' };
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
