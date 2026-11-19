// Settings > Account: where this account is signed in (sign out one device, or every other device). Loaded by settings.html before
// settings.js; it draws itself once the page's language is ready.
(function () {
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (k) => WisecallI18n.t(k);
  const when = (d) => WisecallI18n.formatDate(d, { dateStyle: 'medium', timeStyle: 'short' });

  let sessions = null;
  function drawSessions() {
    const box = document.getElementById('sessionsCard');
    if (!box || !sessions) return;
    const others = sessions.filter((s) => !s.current);
    box.innerHTML = `
      <h2>${esc(t('settings.sessions.title'))}</h2>
      <p class="muted">${esc(t('settings.sessions.body'))}</p>
      <ul class="earn-list sessions-list">${sessions.map((s) => `
        <li>
          <span><strong>${esc(s.device || t('settings.sessions.unknown'))}</strong>${s.current ? ` <span class="badge badge-answered">${esc(t('settings.sessions.this'))}</span>` : ''}
            <span class="muted small block">${esc(t('settings.sessions.lastSeen').replace('{date}', when(s.lastSeenAt)))}</span></span>
          ${s.current ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-revoke="${esc(s.id)}">${esc(t('settings.sessions.signOut'))}</button>`}
        </li>`).join('')}</ul>
      ${others.length || !sessions.some((s) => s.current) ? `<button type="button" class="btn btn-outline btn-sm" id="logoutOthers">${esc(t('settings.sessions.others'))}</button>` : ''}`;
    box.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { sessions = (await WisecallAPI.apiFetch(`/me/sessions/${b.dataset.revoke}/revoke`, { method: 'POST' })).sessions; drawSessions(); WisecallNav.showToast(t('settings.sessions.done')); }
      catch (e) { b.disabled = false; WisecallNav.showToast(t('toast.error')); }
    }));
    const all = box.querySelector('#logoutOthers');
    if (all) all.addEventListener('click', async () => {
      if (!(await WisecallDialog.confirm({ message: t('settings.sessions.confirm'), confirmText: t('settings.sessions.button') }))) return;
      all.disabled = true;
      try { sessions = (await WisecallAPI.apiFetch('/me/sessions/logout-others', { method: 'POST' })).sessions; drawSessions(); WisecallNav.showToast(t('settings.sessions.doneAll')); }
      catch (e) { all.disabled = false; WisecallNav.showToast(t('toast.error')); }
    });
  }

  async function loadSessions() {
    try { sessions = (await WisecallAPI.apiFetch('/me/sessions')).sessions; drawSessions(); } catch (e) { /* signed out */ }
  }

  // ---- Two-step verification (optional; recommended for mentors; admins manage theirs on the admin page) ----------------------------
  let tf = null;
  let setup = null;
  let codes = null;
  function drawTwoStep() {
    const box = document.getElementById('twoStepCard');
    if (!box || !tf) return;
    let body;
    if (codes) {
      body = `<p>${esc(t('settings.twoStep.codes'))}</p><pre class="recovery-codes">${codes.map(esc).join('\n')}</pre>
        <button type="button" class="btn btn-primary btn-sm" id="tfCodesDone">${esc(t('settings.twoStep.codesDone'))}</button>`;
    } else if (tf.enabled) {
      body = `<p><span class="badge badge-answered">${esc(t('settings.twoStep.on'))}</span> ${esc(t('settings.twoStep.recoveryLeft').replace('{n}', tf.recoveryLeft))}</p>
        ${tf.admin ? `<p class="muted small">${esc(t('settings.twoStep.admin'))}</p>` : `
        <form id="tfOff" novalidate>
          <label class="field-label" for="tfOffPassword">${esc(t(me && me.hasPassword ? 'settings.data.password' : 'settings.twoStep.codeLabel'))}</label>
          <input type="${me && me.hasPassword ? 'password' : 'text'}" id="tfOffPassword" autocomplete="${me && me.hasPassword ? 'current-password' : 'one-time-code'}">
          <p class="form-error" id="tfError" role="alert"></p>
          <button type="submit" class="btn btn-outline btn-sm">${esc(t('settings.twoStep.turnOff'))}</button>
        </form>`}`;
    } else if (setup) {
      body = `<p>${esc(t('settings.twoStep.scan'))}</p><div class="tf-qr" aria-hidden="true">${setup.qr}</div>
        <p class="small">${esc(t('settings.twoStep.key'))} <code>${esc(setup.key)}</code></p>
        <form id="tfOn" novalidate>
          <label class="field-label" for="tfCode">${esc(t('settings.twoStep.codeLabel'))}</label>
          <input type="text" id="tfCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
          ${setup.devCode ? `<p class="small muted">Development only: the app would show ${esc(setup.devCode)}</p>` : ''}
          <p class="form-error" id="tfError" role="alert"></p>
          <button type="submit" class="btn btn-primary btn-sm">${esc(t('settings.twoStep.confirm'))}</button>
        </form>`;
    } else {
      body = `<p class="muted">${esc(t(tf.recommended ? 'settings.twoStep.bodyMentor' : 'settings.twoStep.body'))}</p>
        <button type="button" class="btn btn-outline btn-sm" id="tfStart">${esc(t('settings.twoStep.start'))}</button>`;
    }
    box.innerHTML = `<h2>${esc(t('settings.twoStep.title'))}</h2>${body}`;
    const q = (id) => box.querySelector(id);
    if (q('#tfStart')) q('#tfStart').addEventListener('click', async () => {
      try { setup = await WisecallAPI.apiFetch('/me/2fa/setup', { method: 'POST' }); drawTwoStep(); } catch (e) { WisecallNav.showToast(t(e.code === 'email_not_verified' ? 'settings.twoStep.verifyEmail' : 'toast.error')); }
    });
    if (q('#tfOn')) q('#tfOn').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { codes = (await WisecallAPI.apiFetch('/me/2fa/enable', { method: 'POST', body: { code: q('#tfCode').value.trim() } })).recoveryCodes; setup = null; tf.enabled = true; tf.recoveryLeft = codes.length; drawTwoStep(); }
      catch (e) { q('#tfError').textContent = t({ invalid_code: 'auth.twoStep.wrong', email_not_verified: 'settings.twoStep.verifyEmail' }[e.code] || 'toast.error'); }
    });
    if (q('#tfCodesDone')) q('#tfCodesDone').addEventListener('click', () => { codes = null; drawTwoStep(); });
    if (q('#tfOff')) q('#tfOff').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = q('#tfOffPassword').value;
      try {
        await WisecallAPI.apiFetch('/me/2fa/disable', { method: 'POST', body: me && me.hasPassword ? { password: v } : { code: v } });
        tf.enabled = false; drawTwoStep(); WisecallNav.showToast(t('settings.twoStep.off'));
      } catch (e) { q('#tfError').textContent = t({ wrong_password: 'settings.data.wrongPassword', invalid_code: 'auth.twoStep.wrong' }[e.code] || 'toast.error'); }
    });
  }
  async function loadTwoStep() {
    try { tf = await WisecallAPI.apiFetch('/me/2fa'); drawTwoStep(); } catch (e) { /* signed out */ }
  }

  // ---- Your data: download it, or delete the account (re-authentication, then a grace period) -------------------------------------
  let me = null;
  let graceDays = 14;
  const fmtDay = (d) => WisecallI18n.formatDate(d, { dateStyle: 'long' });
  function drawData() {
    const box = document.getElementById('dataCard');
    if (!box || !me) return;
    const pending = me.deletionRequestedAt;
    const until = pending ? new Date(new Date(pending).getTime() + graceDays * 86400000) : null;
    box.innerHTML = `
      <h2>${esc(t('settings.data.title'))}</h2>
      <p class="muted">${esc(t('settings.data.exportBody'))}</p>
      <p><a class="btn btn-outline btn-sm" href="/api/me/export" download>${esc(t('settings.data.export'))}</a></p>
      <h3 class="data-delete-title">${esc(t('settings.data.deleteTitle'))}</h3>
      ${pending ? `
        <p class="form-error">${esc(t('settings.data.pending').replace('{date}', fmtDay(until)))}</p>
        <button type="button" class="btn btn-primary btn-sm" id="keepAccount">${esc(t('settings.data.keep'))}</button>` : `
        <p class="muted">${esc(t('settings.data.deleteBody').replace('{days}', graceDays))}</p>
        <form id="deleteForm" novalidate>
          ${me.hasPassword ? `
            <label class="field-label" for="deletePassword">${esc(t('settings.data.password'))}</label>
            <input type="password" id="deletePassword" autocomplete="current-password" required>` : `<p class="small muted">${esc(t('settings.data.googleReauth'))}</p>`}
          <p class="form-error" id="deleteError" role="alert"></p>
          <button type="submit" class="btn btn-danger btn-sm">${esc(t('settings.data.delete'))}</button>
        </form>`}`;
    const keep = box.querySelector('#keepAccount');
    if (keep) keep.addEventListener('click', async () => {
      keep.disabled = true;
      try { me = (await WisecallAPI.apiFetch('/me/delete/cancel', { method: 'POST' })).user; drawData(); WisecallNav.showToast(t('settings.data.kept')); }
      catch (e) { keep.disabled = false; WisecallNav.showToast(t('toast.error')); }
    });
    const form = box.querySelector('#deleteForm');
    if (form) form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = box.querySelector('#deleteError');
      err.textContent = '';
      if (!(await WisecallDialog.confirm({ message: t('settings.data.confirm').replace('{days}', graceDays), confirmText: t('settings.data.button'), danger: true }))) return;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const pw = box.querySelector('#deletePassword');
        await WisecallAPI.apiFetch('/me', { method: 'DELETE', body: { password: pw ? pw.value : undefined } });
        window.location.href = '/?account=closed';
      } catch (e) {
        btn.disabled = false;
        if (e.code === 'open_items') {
          const items = (e.data && e.data.items) || [];
          err.textContent = `${t('settings.data.open')} ${items.map((i) => t('settings.data.open.' + i)).join(' ')}`;
        } else {
          err.textContent = t({ wrong_password: 'settings.data.wrongPassword', reauth_required: 'settings.data.googleReauth', already_requested: 'settings.data.already' }[e.code] || 'toast.error');
        }
      }
    });
  }
  async function loadData() {
    try {
      const [u, check] = await Promise.all([WisecallAPI.apiFetch('/me'), WisecallAPI.apiFetch('/me/delete/check')]);
      me = u.user;
      graceDays = check.graceDays || graceDays;
      drawData();
    } catch (e) { /* signed out */ }
  }

  document.addEventListener('DOMContentLoaded', () => {
    WisecallI18n.ready.then(() => { loadSessions(); loadData().then(loadTwoStep); });
    document.addEventListener('wisecall:lang-changed', () => { drawSessions(); drawData(); drawTwoStep(); });
  });
})();
