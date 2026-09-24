(async function () {
  await WisecallI18n.initI18n();
  const form = document.getElementById('resetForm');
  const errorEl = document.getElementById('formError');
  const resultEl = document.getElementById('result');
  const params = new URLSearchParams(location.search);
  const token = params.get('token');

  if (!token) {
    form.style.display = 'none';
    resultEl.style.display = 'block';
    resultEl.innerHTML = `<p class="muted">${WisecallI18n.t('auth.reset.noToken')}</p>`;
    return;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await WisecallAPI.apiFetch('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword: document.getElementById('newPassword').value }
      });
      form.style.display = 'none';
      resultEl.style.display = 'block';
      resultEl.innerHTML = `<p class="muted">${WisecallI18n.t('auth.reset.success')}</p><a class="btn btn-primary btn-block" href="/login.html" style="margin-top:14px">${WisecallI18n.t('auth.login.cta')}</a>`;
    } catch (e) {
      errorEl.textContent = e.code === 'invalid_or_expired' ? WisecallI18n.t('auth.reset.expired') : WisecallI18n.t('toast.error');
      submitBtn.disabled = false;
    }
  });
})();
