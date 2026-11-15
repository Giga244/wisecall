// The email code box (docs/CLAUDE-CODE-EMAIL-CODE-FIX.md): "Enter the code we sent to {email}", where nothing waits for it. It is on step 5 of
// the mentor application (before sending), on the "sent" screen and on the dashboard while the email is not confirmed. It says the code
// works for 24 hours, to look in Junk / Spam, can send the code again (once a minute) and can switch to another address (everything filled
// in stays: it belongs to the account). The server decides every rule (server/emailCodes.js); this only asks and explains.
//   WisecallEmailCode.html(user, { title, note })  -> markup (title: a heading key or null; note: a key for one more line)
//   WisecallEmailCode.wire(box, user, { onVerified(user), onSwitched(user) })
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  let seq = 0;
  const WAIT_S = 60;

  function html(user, { title = null, note = null } = {}) {
    const id = `ec${++seq}`;
    return `
      <section class="email-code" data-email-code aria-labelledby="${id}Lead">
        ${title ? `<h2 class="email-code-title">${esc(t(title))}</h2>` : ''}
        <p class="email-code-lead" id="${id}Lead" data-ec-lead>${esc(fill('email.code.lead', { email: user.email }))}</p>
        <form class="email-code-form" data-ec-form novalidate>
          <label class="sr-only" for="${id}Code">${esc(t('email.code.label'))}</label>
          <input id="${id}Code" name="code" class="email-code-input mono" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" required>
          <button type="submit" class="btn btn-primary">${esc(t('email.code.confirm'))}</button>
        </form>
        <p class="form-error" role="alert" data-ec-error></p>
        <div data-ec-dev hidden></div>
        <p class="hint email-code-hint">${esc(t('email.code.ttl'))} ${esc(t('email.code.junk'))}</p>
        ${note ? `<p class="hint email-code-note">${esc(t(note))}</p>` : ''}
        <p class="email-code-actions">
          <button type="button" class="linklike" data-ec-resend>${esc(t('email.code.resend'))}</button>
          <span aria-hidden="true">·</span>
          <button type="button" class="linklike" data-ec-switch aria-expanded="false">${esc(t('email.code.switch'))}</button>
        </p>
        <form class="email-code-switch" data-ec-switch-form hidden novalidate>
          <label for="${id}New">${esc(t('email.code.newEmail'))}</label>
          <div class="email-code-row">
            <input id="${id}New" name="email" type="email" autocomplete="email" required>
            <button type="submit" class="btn btn-outline">${esc(t('email.code.sendNew'))}</button>
          </div>
          <p class="hint">${esc(t('email.code.switchKeep'))}</p>
          <p class="form-error" role="alert" data-ec-switch-error></p>
        </form>
      </section>`;
  }

  const CODE_ERRORS = { invalid_code: 'auth.verify.invalidCode', expired: 'auth.verify.expiredCode', no_pending_code: 'auth.verify.noPendingCode', missing_fields: 'email.code.empty' };
  const SWITCH_ERRORS = { invalid_email: 'auth.error.invalidEmail', email_taken: 'auth.error.emailTaken', same_email: 'auth.verify.sameEmail', too_many_requests: 'auth.verify.tooMany' };
  // This account's email was confirmed meanwhile (another tab, or the code page left open): another address is chosen in Settings, with
  // the password, and a code to the new address (docs/CLAUDE-CODE-UNKNOWN-ERROR.md: this answer once showed only a generic error).
  const alreadyHtml = (email) => `${esc(fill('email.code.alreadyVerified', { email: email || '' }))} <a href="/settings.html?tab=account#email">${esc(t('email.code.toSettings'))}</a>`;
  const minutes = (s) => Math.max(1, Math.ceil((Number(s) || 60) / 60));

  async function showDev(box, code) {
    const dev = box.querySelector('[data-ec-dev]');
    if (!dev || !code) return;
    // (a local-development helper only: shown when the server itself says it is not production)
    let devMode = false;
    try { devMode = Boolean((await WisecallAPI.apiFetch('/config')).devMode); } catch (e) { /* production */ }
    if (!devMode) return;
    dev.hidden = false;
    dev.innerHTML = `<div class="hero-cta-banner">${esc(t('auth.verify.devModeNote'))} <strong class="mono" data-ec-dev-code>${esc(code)}</strong></div>`;
  }

  function wire(box, user, { onVerified, onSwitched } = {}) {
    if (!box) return;
    const form = box.querySelector('[data-ec-form]');
    const error = box.querySelector('[data-ec-error]');
    const resend = box.querySelector('[data-ec-resend]');
    const switchBtn = box.querySelector('[data-ec-switch]');
    const switchForm = box.querySelector('[data-ec-switch-form]');
    const switchError = box.querySelector('[data-ec-switch-error]');
    const lead = box.querySelector('[data-ec-lead]');
    let address = user.email;
    const devCode = (new URLSearchParams(window.location.search).get('devCode') || '').replace(/\D/g, '').slice(0, 6);
    if (devCode) showDev(box, devCode);

    let until = 0;
    let timer = null;
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      resend.disabled = left > 0;
      resend.textContent = left > 0 ? fill('email.code.resendIn', { s: left }) : t('email.code.resend');
      if (!left && timer) { clearInterval(timer); timer = null; }
    };
    const wait = (s) => { until = Date.now() + (s || WAIT_S) * 1000; if (!timer) timer = setInterval(tick, 1000); tick(); };

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      const code = form.code.value.replace(/\s/g, '');
      if (!/^\d{6}$/.test(code)) { error.textContent = t('email.code.empty'); form.code.focus(); return; }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const out = await WisecallAPI.apiFetch('/auth/verify-email', { method: 'POST', body: { code } });
        WisecallNav.showToast(t('email.code.done'));
        if (onVerified) onVerified(out.user);
      } catch (e) {
        error.textContent = e.code === 'too_many_attempts' ? fill('email.code.wait', { m: minutes(e.data && e.data.retryAfter) }) : t(CODE_ERRORS[e.code] || 'toast.error');
        btn.disabled = false;
        form.code.focus();
      }
    });

    resend.addEventListener('click', async () => {
      if (resend.disabled) return;
      resend.disabled = true;
      error.textContent = '';
      try {
        const out = await WisecallAPI.apiFetch('/auth/resend-verification', { method: 'POST' });
        wait(WAIT_S);
        if (out.devVerifyCode) showDev(box, out.devVerifyCode);
        if (!out.emailSent && !out.devMode) { error.textContent = t('auth.verify.sendFailed'); return; }
        WisecallNav.showToast(t('auth.verify.resent'));
      } catch (e) {
        if (e.code === 'resend_wait') { wait((e.data && e.data.retryAfter) || WAIT_S); return; }
        if (e.code === 'already_verified') { error.innerHTML = alreadyHtml(); return; }
        error.textContent = t(e.code === 'too_many_requests' ? 'auth.verify.tooMany' : 'toast.error');
        tick();
      }
    });

    switchBtn.addEventListener('click', () => {
      switchForm.hidden = !switchForm.hidden;
      switchBtn.setAttribute('aria-expanded', String(!switchForm.hidden));
      if (!switchForm.hidden) switchForm.email.focus();
    });
    switchForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      switchError.textContent = '';
      const btn = switchForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const out = await WisecallAPI.apiFetch('/auth/change-unconfirmed-email', { method: 'POST', body: { email: switchForm.email.value.trim() } });
        address = out.user.email;
        lead.textContent = fill('email.code.lead', { email: address });
        switchForm.hidden = true;
        switchForm.reset();
        switchBtn.setAttribute('aria-expanded', 'false');
        form.code.value = '';
        if (out.devVerifyCode) showDev(box, out.devVerifyCode);
        if (!out.emailSent && !out.devMode) error.textContent = t('auth.verify.sendFailed');
        else WisecallNav.showToast(fill('auth.verify.changed', { email: address }));
        wait(WAIT_S);
        if (onSwitched) onSwitched(out.user);
        form.code.focus();
      } catch (e) {
        if (e.code === 'already_verified') switchError.innerHTML = alreadyHtml(e.data && e.data.email);
        else switchError.textContent = t(SWITCH_ERRORS[e.code] || 'toast.error');
      }
      btn.disabled = false;
    });
    document.addEventListener('wisecall:lang-changed', () => { lead.textContent = fill('email.code.lead', { email: address }); tick(); });
  }

  window.WisecallEmailCode = { html, wire };
})();
