// The "tell me when Wisecall opens / when a mentor in my field joins" form, shared by the home page (Browse experts: the "Wisecall
// opens soon" card before launch, the empty list after it), a field's page and the expert profile. It has no heading of its own: the
// card or panel around it says what it is for. A sign-up turns it into a "you're on the list" note of the same height, so nothing around
// it moves.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The fields, in the order shown (the niche list from the server).
  const fields = () => WisecallI18n.niches().map((n) => n.key);
  const prelaunch = () => WisecallI18n.launchMode() === 'prelaunch';

  const CHECK = '<svg class="waitlist-check" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="22" stroke-width="2.5"/><path d="M14 25l7 7 13-15" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let counter = 0;
  function html(niche) {
    const n = ++counter;
    const options = ['any', ...fields()].map((k) => `<option value="${k}"${k === (niche || 'any') ? ' selected' : ''}>${esc(k === 'any' ? t('wait.any') : t('niche.' + k))}</option>`).join('');
    return `
      <form class="waitlist-form" novalidate>
        <div class="waitlist-row">
          <label for="wl${n}-email"><span>${t('wait.email')}</span><input id="wl${n}-email" type="email" name="email" maxlength="254" autocomplete="email" inputmode="email" required></label>
          <label for="wl${n}-niche"><span>${t('wait.niche')}</span><select id="wl${n}-niche" name="niche">${options}</select></label>
        </div>
        <button class="btn btn-primary waitlist-submit" type="submit">${t('wait.submit')}</button>
        <p class="hint waitlist-hint">${t('wait.consent')} <a href="/privacy.html">${t('footer.privacy')}</a></p>
        <p class="form-error waitlist-error" role="alert"></p>
      </form>`;
  }

  function wire(root) {
    root.querySelectorAll('.waitlist-form').forEach((form) => {
      if (form.dataset.wired) return;
      form.dataset.wired = '1';
      const human = window.WisecallTurnstile;
      if (human) human.watch(form);
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const error = form.querySelector('.waitlist-error');
        error.textContent = '';
        const email = form.email.value.trim();
        if (!form.email.checkValidity() || !email) { error.textContent = t('wait.error'); form.email.focus(); return; }
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          await WisecallAPI.apiFetch('/waitlist', { method: 'POST', body: { email, niche: form.niche.value, language: WisecallI18n.getLang(), turnstileToken: human ? await human.token(form) : undefined } });
          // (the note keeps the form's height: the card around it does not jump)
          const done = document.createElement('div');
          done.className = 'waitlist-done';
          done.setAttribute('role', 'status');
          done.innerHTML = `${CHECK}<p>${esc(t(prelaunch() ? 'wait.prelaunch.done' : 'wait.done'))}</p>`;
          done.style.minHeight = `${form.offsetHeight}px`;
          form.replaceWith(done);
        } catch (e) {
          error.textContent = (human && human.errorText(e.code)) || t(e.code === 'invalid_email' ? 'wait.error' : 'toast.error');
          if (human) human.reset(form);
          button.disabled = false;
        }
      });
    });
  }

  window.WisecallWaitlist = { fields, html, wire };
})();
