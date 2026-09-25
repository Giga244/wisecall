// The "Continue with Google" button on the login and sign-up pages: keeps ?redirect= (same-site only) and the language,
// and says in words what happened when Google sent the person back with ?google=<what>.
(async function () {
  await WisecallI18n.ready;
  const t = WisecallI18n.t;
  const button = document.getElementById('googleBtn');
  const errorEl = document.getElementById('googleError');
  const params = new URLSearchParams(location.search);
  const result = params.get('google');

  function point() {
    if (!button) return;
    const url = new URL(button.getAttribute('href'), location.origin);
    const redirect = WisecallAPI.safeRedirect(params.get('redirect'), null);
    if (redirect) url.searchParams.set('redirect', redirect); else url.searchParams.delete('redirect');
    url.searchParams.set('lang', WisecallI18n.getLang());
    button.setAttribute('href', url.pathname + url.search);
  }
  const say = () => { errorEl.textContent = result ? t('auth.google.err.' + (['cancelled', 'error', 'bad_state', 'link_needed', 'no_email', 'unavailable'].includes(result) ? result : 'error')) : ''; };

  point();
  say();
  document.addEventListener('wisecall:lang-changed', () => { point(); say(); });
  if (result) { // (the words stay on the page; the address is tidied so a reload does not repeat them)
    const url = new URL(location.href);
    url.searchParams.delete('google');
    history.replaceState(null, '', url);
  }
})();
