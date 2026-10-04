(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;

  const form = document.getElementById('contactForm');
  const errorEl = document.getElementById('formError');
  const doneEl = document.getElementById('contactDone');
  const submitBtn = form.querySelector('button[type="submit"]');
  const submitKey = 'contact.send';

  // The public support address, shown only when one is configured. Messages from this
  // form go to the private admin addresses instead.
  const direct = document.getElementById('contactDirect');
  function drawDirect(cfg) {
    if (!cfg.contactEmail) { direct.hidden = true; return; }
    const [before, after] = t('contact.emailLine').split('{email}');
    direct.textContent = '';
    direct.append(before || '');
    const a = document.createElement('a');
    a.href = 'mailto:' + cfg.contactEmail;
    a.textContent = cfg.contactEmail;
    direct.append(a, after || '');
    direct.hidden = false;
  }
  WisecallI18n.getConfig().then((cfg) => { drawDirect(cfg); document.addEventListener('wisecall:lang-changed', () => drawDirect(cfg)); });

  if (user) {
    document.getElementById('name').value = user.name || '';
    document.getElementById('email').value = user.email || '';
  }

  WisecallTurnstile.watch(form);
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
          website: document.getElementById('website').value,
          turnstileToken: await WisecallTurnstile.token(form)
        }
      });
      form.style.display = 'none';
      doneEl.style.display = 'block';
      doneEl.textContent = data.devMode ? t('contact.sentDev') : t(data.threadId ? 'contact.sentInbox' : 'contact.sent');
      if (data.threadId) {
        const a = document.createElement('a');
        a.href = '/inbox.html?thread=' + encodeURIComponent(data.threadId);
        a.className = 'btn btn-outline btn-sm';
        a.textContent = t('contact.openInbox');
        doneEl.append(' ', a);
      }
    } catch (e) {
      const map = { missing_fields: 'contact.err.missing', invalid_email: 'contact.err.email', too_many_requests: 'contact.err.rate' };
      errorEl.textContent = WisecallTurnstile.errorText(e.code) || t(map[e.code] || 'contact.err.send');
      WisecallTurnstile.reset(form);
      submitBtn.disabled = false;
      submitBtn.textContent = t(submitKey);
    }
  });
})();
