(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;

  const form = document.getElementById('contactForm');
  const errorEl = document.getElementById('formError');
  const doneEl = document.getElementById('contactDone');
  const submitBtn = form.querySelector('button[type="submit"]');
  const submitKey = 'contact.send';

  if (user) {
    document.getElementById('name').value = user.name || '';
    document.getElementById('email').value = user.email || '';
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = t('contact.sending');
    try {
      const data = await WisecallAPI.apiFetch('/contact', {
        method: 'POST',
        body: {
          name: document.getElementById('name').value.trim(),
          email: document.getElementById('email').value.trim(),
          message: document.getElementById('message').value.trim(),
          website: document.getElementById('website').value
        }
      });
      form.style.display = 'none';
      doneEl.style.display = 'block';
      doneEl.textContent = data.devMode ? t('contact.sentDev') : t('contact.sent');
    } catch (e) {
      const map = { missing_fields: 'contact.err.missing', invalid_email: 'contact.err.email', too_many_requests: 'contact.err.rate' };
      errorEl.textContent = t(map[e.code] || 'contact.err.send');
      submitBtn.disabled = false;
      submitBtn.textContent = t(submitKey);
    }
  });
})();
