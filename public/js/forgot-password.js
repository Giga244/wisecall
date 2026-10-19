(async function () {
  const dict = await WisecallI18n.initI18n();
  const form = document.getElementById('forgotForm');
  const errorEl = document.getElementById('formError');
  const resultEl = document.getElementById('result');

  WisecallTurnstile.watch(form);
  WisecallAPI.keepMentorPath();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const data = await WisecallAPI.apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: { email: document.getElementById('email').value.trim(), as: WisecallAPI.asMentor() ? 'mentor' : undefined, turnstileToken: await WisecallTurnstile.token(form) }
      });
      form.style.display = 'none';
      resultEl.style.display = 'block';
      if (data.devMode) {
        if (data.resetUrl) {
          resultEl.innerHTML = `
            <p class="muted small" style="margin-bottom:10px">${WisecallI18n.t('auth.forgot.devModeNote')}</p>
            <a class="btn btn-outline btn-block" href="${data.resetUrl}">${WisecallI18n.t('auth.forgot.devModeLink')}</a>
          `;
        } else {
          resultEl.innerHTML = `<p class="muted">${WisecallI18n.t('auth.forgot.devModeNoAccount')}</p>`;
        }
      } else {
        resultEl.innerHTML = `<p class="muted">${WisecallI18n.t('auth.forgot.sent')}</p>`;
      }
    } catch (e) {
      errorEl.textContent = WisecallTurnstile.errorText(e.code) || WisecallI18n.t('toast.error');
      WisecallTurnstile.reset(form);
      submitBtn.disabled = false;
    }
  });
})();
