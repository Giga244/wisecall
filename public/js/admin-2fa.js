// Two-step verification for admins: the first time (a QR code for an authenticator app, a first code, recovery codes) and every sign-in after
// (a code, or a recovery code). The server sends this page instead of the admin panel until the second step has been passed.
(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;
  if (!user) { window.location.href = '/login.html?redirect=/admin.html'; return; }

  const body = document.getElementById('tfBody');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (path, method, data) => WisecallAPI.apiFetch(`/admin/2fa/${path}`, { method: method || 'GET', body: data });
  const toPanel = () => window.location.replace('/admin.html');
  const errorText = (e) => {
    if (e.code === 'invalid_code') return t('admin.tf.err.invalid');
    if (e.code === 'locked') return t('admin.tf.err.locked').replace('{minutes}', Math.max(1, Math.ceil(((e.data && e.data.retryAfter) || 300) / 60)));
    return t('admin.tf.err.generic');
  };
  const codeField = (id, label) => `
    <label for="${id}"><span>${esc(label)}</span>
      <input id="${id}" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" required autofocus>
    </label>`;
  const devBox = (code) => (code ? `<p class="tf-dev dev-code" role="status">${esc(t('admin.tf.dev').replace('{code}', code))} <button type="button" class="btn btn-outline btn-sm" id="tfDevFill" data-code="${esc(code)}">${esc(t('admin.tf.devFill'))}</button></p>` : '');
  const wireDevFill = () => {
    const b = document.getElementById('tfDevFill');
    if (b) b.addEventListener('click', () => { const f = document.getElementById('tfCode'); f.value = b.dataset.code; f.focus(); });
  };

  // ---- first time: set it up ------------------------------------------------------------------------------------------
  async function setup() {
    let s;
    try { s = await api('setup', 'POST'); } catch (e) { body.innerHTML = `<p class="form-error" role="alert">${esc(errorText(e))}</p>`; return; }
    body.innerHTML = `
      <p class="muted">${esc(t('admin.tf.setupIntro'))}</p>
      <p><strong>${esc(t('admin.tf.step1'))}</strong></p>
      <div class="tf-qr" role="img" aria-label="${esc(t('admin.tf.qrLabel'))}">${s.qr}</div>
      <p class="tf-key"><span class="muted small">${esc(t('admin.tf.keyLabel'))}</span><br><code class="mono" id="tfKey">${esc(s.key)}</code></p>
      <p><strong>${esc(t('admin.tf.step2'))}</strong></p>
      ${devBox(s.devCode)}
      <form id="tfForm" novalidate>
        ${codeField('tfCode', t('admin.tf.codeLabel'))}
        <p class="form-error" id="tfError" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block">${esc(t('admin.tf.enable'))}</button>
      </form>`;
    wireDevFill();
    const form = document.getElementById('tfForm');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const error = document.getElementById('tfError');
      error.textContent = '';
      const typed = document.getElementById('tfCode').value.replace(/\s/g, '');
      if (!/^\d{6}$/.test(typed)) { error.textContent = t('admin.tf.needCode'); return; }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const r = await api('enable', 'POST', { code: typed });
        showRecoveryCodes(r.recoveryCodes);
      } catch (e) { error.textContent = errorText(e); submit.disabled = false; }
    });
  }

  function showRecoveryCodes(codes) {
    body.innerHTML = `
      <h2 class="tf-h" tabindex="-1" id="tfRecoveryTitle">${esc(t('admin.tf.recoveryTitle'))}</h2>
      <p class="muted">${esc(t('admin.tf.recoveryBody'))}</p>
      <ol class="tf-codes">${codes.map((c) => `<li><code class="mono">${esc(c)}</code></li>`).join('')}</ol>
      <button type="button" class="btn btn-outline btn-sm" id="tfCopy">${esc(t('admin.tf.copy'))}</button>
      <label class="tf-saved"><input type="checkbox" id="tfSaved"> <span>${esc(t('admin.tf.saved'))}</span></label>
      <p class="form-error" id="tfError" role="alert"></p>
      <button type="button" class="btn btn-primary btn-block" id="tfContinue">${esc(t('admin.tf.continue'))}</button>`;
    document.getElementById('tfRecoveryTitle').focus();
    document.getElementById('tfCopy').addEventListener('click', async (ev) => {
      try { await navigator.clipboard.writeText(codes.join('\n')); ev.currentTarget.textContent = t('admin.tf.copied'); } catch (e) { /* the codes are on the screen to copy by hand */ }
    });
    document.getElementById('tfContinue').addEventListener('click', () => {
      if (!document.getElementById('tfSaved').checked) { document.getElementById('tfError').textContent = t('admin.tf.needSaved'); return; }
      toPanel();
    });
  }

  // ---- every sign-in after: a code ---------------------------------------------------------------------------------------
  function verifyView(state) {
    let recovery = false;
    const draw = () => {
      body.innerHTML = `
        <p class="muted">${esc(t('admin.tf.verifyIntro'))}</p>
        ${recovery ? '' : devBox(state.devCode)}
        <form id="tfForm" novalidate>
          ${recovery
            ? `<label for="tfCode"><span>${esc(t('admin.tf.recoveryLabel'))}</span><input id="tfCode" name="recovery" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="16" required autofocus></label>`
            : codeField('tfCode', t('admin.tf.codeLabel'))}
          <p class="form-error" id="tfError" role="alert"></p>
          <button type="submit" class="btn btn-primary btn-block">${esc(t('admin.tf.verify'))}</button>
        </form>
        <p class="tf-switch"><button type="button" class="btn btn-ghost btn-sm" id="tfSwitch">${esc(t(recovery ? 'admin.tf.useApp' : 'admin.tf.useRecovery'))}</button></p>`;
      wireDevFill();
      document.getElementById('tfSwitch').addEventListener('click', () => { recovery = !recovery; draw(); });
      const form = document.getElementById('tfForm');
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const error = document.getElementById('tfError');
        error.textContent = '';
        const typed = document.getElementById('tfCode').value.trim();
        if (recovery ? typed.length < 6 : !/^\d{6}$/.test(typed.replace(/\s/g, ''))) { error.textContent = t('admin.tf.needCode'); return; }
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          await api('verify', 'POST', recovery ? { recoveryCode: typed } : { code: typed.replace(/\s/g, '') });
          toPanel();
        } catch (e) { error.textContent = errorText(e); submit.disabled = false; document.getElementById('tfCode').select(); }
      });
    };
    draw();
  }

  try {
    const state = await api('status');
    if (state.verified) toPanel();
    else if (state.enabled) verifyView(state);
    else await setup();
  } catch (e) {
    body.innerHTML = `<p class="form-error" role="alert">${esc(t('admin.tf.err.generic'))}</p>`;
  }
})();
