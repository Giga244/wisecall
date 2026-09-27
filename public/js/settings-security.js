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

  document.addEventListener('DOMContentLoaded', () => {
    WisecallI18n.ready.then(loadSessions);
    document.addEventListener('wisecall:lang-changed', drawSessions);
  });
})();
