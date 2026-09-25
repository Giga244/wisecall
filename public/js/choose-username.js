// The page a new person from Google passes through once: keep the username we suggested, or type another one.
(async function () {
  await WisecallI18n.initI18n();
  const t = WisecallI18n.t;
  const user = await WisecallNav.initNav();
  const params = new URLSearchParams(location.search);
  const next = WisecallAPI.safeRedirect(params.get('redirect'), '/dashboard.html');
  if (!user) { location.href = '/login.html'; return; }
  if (user.usernameConfirmed) { location.href = next; return; } // nothing to choose: they already did

  const input = document.getElementById('username');
  const status = document.getElementById('usernameStatus');
  const errorEl = document.getElementById('formError');
  let checkTimer = null, seq = 0;

  document.getElementById('chooseWho').innerHTML = `${WisecallAPI.avatar(user, { cls: 'avatar-lg', size: 76 })}<strong>${String(user.name).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</strong>`;
  input.value = user.username || '';

  const TEXT = { username_taken: 'profile.username.taken', reserved_username: 'profile.username.reserved', invalid_username: 'profile.username.invalid' };
  function say(key, tone) { status.textContent = key ? t(key) : ''; status.className = 'hint username-status' + (tone ? ' is-' + tone : ''); }
  function hint() { document.getElementById('usernameHint').textContent = `${location.origin}/u/${input.value.trim().toLowerCase() || '…'}`; }

  function check() {
    clearTimeout(checkTimer);
    hint();
    const value = input.value.trim().toLowerCase();
    if (!value || value === user.username) { say(null); return; }
    const mine = ++seq;
    checkTimer = setTimeout(async () => {
      try {
        const r = await WisecallAPI.apiFetch('/username/check?u=' + encodeURIComponent(value));
        if (mine !== seq) return;
        if (r.available) say('profile.username.free', 'ok'); else say(TEXT[r.reason] || 'profile.username.invalid', 'bad');
      } catch (e) { if (mine === seq) say(null); }
    }, 300);
  }
  input.addEventListener('input', check);
  document.addEventListener('wisecall:lang-changed', () => { hint(); check(); });
  hint();

  document.getElementById('chooseForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    const button = ev.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      // (Saving the very same name is how "keep this one" is recorded.)
      await WisecallAPI.apiFetch('/me/username', { method: 'PUT', body: { username: input.value.trim().toLowerCase() } });
      location.href = next;
    } catch (e) {
      errorEl.textContent = t(TEXT[e.code] || 'toast.error');
      input.setAttribute('aria-invalid', 'true');
      button.disabled = false;
    }
  });
})();
