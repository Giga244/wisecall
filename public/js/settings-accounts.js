// Settings → Account: connected accounts (Google) and the password card for people who have no password yet.
window.SettingsAccounts = (function () {
  const $ = (id) => document.getElementById(id);
  const t = (k) => WisecallI18n.t(k);
  let data = null;

  const RESULT_TEXT = {
    linked: 'settings.connected.done',
    cancelled: 'auth.google.err.cancelled',
    already_linked: 'settings.connected.err.alreadyLinked',
    has_other: 'settings.connected.err.hasOther',
    bad_state: 'auth.google.err.bad_state',
    error: 'auth.google.err.error',
    unavailable: 'auth.google.err.unavailable'
  };

  function draw() {
    if (!data) return;
    const card = $('connectedCard');
    // Shown when Google can be connected, or when it already is (so it can be disconnected).
    card.hidden = !(data.google || data.googleEnabled);
    $('googleStatus').textContent = data.google ? t('settings.connected.as').replace('{email}', data.google.email || '') : t('settings.connected.not');
    $('googleToggle').textContent = t(data.google ? 'settings.connected.disconnect' : 'settings.connected.connect');
    $('googleToggle').setAttribute('aria-label', `${t(data.google ? 'settings.connected.disconnect' : 'settings.connected.connect')} — Google`);

    // Someone who signed in with Google has no password to type in: they can set one (and need one to disconnect Google).
    $('currentPasswordField').hidden = !data.hasPassword;
    $('currentPassword').required = data.hasPassword;
    $('passwordTitle').textContent = t(data.hasPassword ? 'settings.password.title' : 'settings.password.setTitle');
  }

  async function load() {
    try { data = await WisecallAPI.apiFetch('/me/identities'); draw(); } catch (e) { /* the rest of the page still works */ }
  }

  async function toggle() {
    const error = $('googleAccountError');
    error.textContent = '';
    const button = $('googleToggle');
    button.disabled = true;
    try {
      if (data.google) {
        data = await WisecallAPI.apiFetch('/me/identities/google', { method: 'DELETE' });
        WisecallNav.showToast(t('settings.connected.removed'));
        draw();
      } else {
        const r = await WisecallAPI.apiFetch('/auth/google/link/start', { method: 'POST' });
        window.location.href = r.url; // to Google; it comes back to Settings → Account
        return;
      }
    } catch (e) {
      if (e.code === 'set_password_first') {
        error.textContent = t('settings.connected.err.setPassword');
        $('newPassword').focus();
      } else error.textContent = t(e.code === 'already_connected' ? 'settings.connected.err.hasOther' : 'toast.error');
    }
    button.disabled = false;
  }

  function init() {
    $('googleToggle').addEventListener('click', toggle);
    document.addEventListener('wisecall:lang-changed', draw);
    document.addEventListener('wisecall:password-set', () => { if (data) data.hasPassword = true; draw(); });
    load();
    // Coming back from Google after "Connect".
    const params = new URLSearchParams(window.location.search);
    const result = params.get('google');
    if (result) {
      const key = RESULT_TEXT[result] || 'auth.google.err.error';
      if (result === 'linked') WisecallNav.showToast(t(key)); else $('googleAccountError').textContent = t(key);
      params.delete('google');
      const url = new URL(window.location.href);
      url.searchParams.delete('google');
      window.history.replaceState(null, '', url);
    }
  }

  return { init };
})();
