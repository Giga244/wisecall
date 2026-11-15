// Settings → Account: the account's email (docs/CLAUDE-CODE-EMAIL-CODE-FIX.md 3). A confirmed address can be changed: the password (or, for
// an account made with Google, a recent sign-in), then a code to the new address; the address changes only when that code is entered, and
// the old address gets a short notice. An address that is not confirmed yet has the code box instead ("Use another email" there).
window.SettingsEmail = (function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const ERR = {
    invalid_email: 'auth.error.invalidEmail', email_taken: 'auth.error.emailTaken', same_email: 'auth.verify.sameEmail', wrong_password: 'settings.email.err.password',
    missing_fields: 'auth.error.missingFields', reauth_required: 'settings.email.err.reauth', resend_wait: 'settings.email.err.wait', too_many_requests: 'auth.verify.tooMany',
    invalid_code: 'auth.verify.invalidCode', expired: 'auth.verify.expiredCode', no_pending_code: 'auth.verify.noPendingCode', too_many_attempts: 'settings.email.err.tries'
  };
  let user = null;
  let hasPassword = true;
  let devCode = null;

  function draw() {
    const card = document.getElementById('emailCard');
    if (!card || !user) return;
    card.hidden = false;
    if (!user.emailVerified) {
      card.innerHTML = `<h2>${esc(t('settings.email.title'))}</h2>${WisecallEmailCode.html(user, { title: null })}`;
      WisecallEmailCode.wire(card, user, { onVerified: (u) => { user = u; draw(); }, onSwitched: (u) => { user = u; } });
      return;
    }
    const pending = user.pendingEmail;
    card.innerHTML = `
      <h2>${esc(t('settings.email.title'))}</h2>
      <p><span class="settings-email-now">${esc(user.email)}</span> <span class="badge badge-answered">${esc(t('settings.email.confirmed'))}</span></p>
      ${pending ? `
        <form class="settings-email-confirm" data-se-confirm novalidate>
          <p>${esc(fill('email.code.lead', { email: pending }))}</p>
          <label class="sr-only" for="seCode">${esc(t('email.code.label'))}</label>
          <div class="email-code-row">
            <input id="seCode" name="code" class="email-code-input mono" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required>
            <button type="submit" class="btn btn-primary">${esc(t('email.code.confirm'))}</button>
          </div>
          ${devCode ? `<div class="hero-cta-banner">${esc(t('auth.verify.devModeNote'))} <strong class="mono">${esc(devCode)}</strong></div>` : ''}
          <p class="hint">${esc(t('email.code.ttl'))} ${esc(t('email.code.junk'))} ${esc(t('settings.email.oldStays'))}</p>
          <p><button type="button" class="linklike" data-se-cancel>${esc(t('settings.email.cancel'))}</button></p>
        </form>` : `
        <button type="button" class="btn btn-outline btn-sm" data-se-open aria-expanded="false">${esc(t('settings.email.change'))}</button>
        <form class="settings-email-change" data-se-change hidden novalidate>
          <label for="seNew">${esc(t('settings.email.new'))}</label>
          <input id="seNew" name="email" type="email" autocomplete="email" required>
          ${hasPassword ? `<label for="sePassword">${esc(t('settings.password.current'))}</label>
          <input id="sePassword" name="password" type="password" autocomplete="current-password" required>` : ''}
          <p class="hint">${esc(t('settings.email.how'))}</p>
          <button type="submit" class="btn btn-primary">${esc(t('email.code.sendNew'))}</button>
        </form>`}
      <p class="form-error" role="alert" data-se-error></p>`;
    wire(card);
  }

  function wire(card) {
    const error = card.querySelector('[data-se-error]');
    const fail = (e) => { error.textContent = e.code === 'resend_wait' ? fill('settings.email.err.wait', { s: (e.data && e.data.retryAfter) || 60 }) : t(ERR[e.code] || 'toast.error'); };
    const open = card.querySelector('[data-se-open]');
    const change = card.querySelector('[data-se-change]');
    if (open) open.addEventListener('click', () => { change.hidden = !change.hidden; open.setAttribute('aria-expanded', String(!change.hidden)); if (!change.hidden) change.email.focus(); });
    if (change) change.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      try {
        const out = await WisecallAPI.apiFetch('/me/email', { method: 'POST', body: { email: change.email.value.trim(), ...(change.password ? { password: change.password.value } : {}) } });
        user = { ...user, pendingEmail: out.pendingEmail };
        devCode = out.devVerifyCode || null;
        draw();
        if (!out.emailSent && !out.devMode) document.querySelector('#emailCard [data-se-error]').textContent = t('auth.verify.sendFailed');
        const code = document.getElementById('seCode');
        if (code) code.focus();
      } catch (e) { fail(e); }
    });
    const confirm = card.querySelector('[data-se-confirm]');
    if (confirm) confirm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      try {
        const out = await WisecallAPI.apiFetch('/me/email/confirm', { method: 'POST', body: { code: confirm.code.value.trim() } });
        user = out.user;
        devCode = null;
        draw();
        WisecallNav.showToast(fill('settings.email.done', { email: user.email }));
      } catch (e) { fail(e); }
    });
    const cancel = card.querySelector('[data-se-cancel]');
    if (cancel) cancel.addEventListener('click', async () => {
      try { user = (await WisecallAPI.apiFetch('/me/email/pending', { method: 'DELETE' })).user; devCode = null; draw(); } catch (e) { fail(e); }
    });
  }

  async function init(me) {
    user = me;
    try { hasPassword = Boolean((await WisecallAPI.apiFetch('/me/identities')).hasPassword); } catch (e) { hasPassword = true; }
    draw();
    document.addEventListener('wisecall:lang-changed', draw);
    // (from "Use another email" on a code box, when the account was confirmed meanwhile: the change form opens at once)
    if (window.location.hash === '#email') {
      const open = document.querySelector('#emailCard [data-se-open]');
      if (open) { open.click(); document.getElementById('emailCard').scrollIntoView({ block: 'start' }); }
    }
  }
  return { init };
})();
