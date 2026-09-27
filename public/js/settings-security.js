// Settings > Account: where this account is signed in (sign out one device, or every other device). Loaded by settings.html before
// settings.js; it draws itself once the page's language is ready.
(function () {
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (k) => WisecallI18n.t(k);
  const when = (d) => new Date(d).toLocaleString(WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

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
      if (!window.confirm(t('settings.sessions.confirm'))) return;
      all.disabled = true;
      try { sessions = (await WisecallAPI.apiFetch('/me/sessions/logout-others', { method: 'POST' })).sessions; drawSessions(); WisecallNav.showToast(t('settings.sessions.doneAll')); }
      catch (e) { all.disabled = false; WisecallNav.showToast(t('toast.error')); }
    });
  }

  async function loadSessions() {
    try { sessions = (await WisecallAPI.apiFetch('/me/sessions')).sessions; drawSessions(); } catch (e) { /* signed out */ }
  }

  // ---- Your data: download it, or delete the account (re-authentication, then a grace period) -------------------------------------
  let me = null;
  let graceDays = 14;
  const fmtDay = (d) => new Date(d).toLocaleDateString(WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB', { dateStyle: 'long' });
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
      if (!window.confirm(t('settings.data.confirm').replace('{days}', graceDays))) return;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const pw = box.querySelector('#deletePassword');
        await WisecallAPI.apiFetch('/me', { method: 'DELETE', body: { password: pw ? pw.value : undefined } });
        window.location.href = '/index.html?account=closed';
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
    WisecallI18n.ready.then(() => { loadSessions(); loadData(); });
    document.addEventListener('wisecall:lang-changed', () => { drawSessions(); drawData(); });
  });
})();
