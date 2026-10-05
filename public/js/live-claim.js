// The link in a gift email opens this page: the person signs in (or creates an account) and the seat becomes theirs. The link works
// once; the server checks it (only its hash is kept).
(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;
  const body = document.getElementById('claimBody');
  const actions = document.getElementById('claimActions');
  const token = new URLSearchParams(window.location.search).get('token');
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let state = null;
  let result = null;

  function draw() {
    if (state === 'bad') { body.textContent = t('live.claim.bad'); actions.innerHTML = `<a class="btn btn-primary" href="/live">${esc(t('live.dash.browse'))}</a>`; return; }
    if (state === 'login') {
      const back = encodeURIComponent(location.pathname + location.search);
      body.textContent = t('live.claim.signIn');
      actions.innerHTML = `<a class="btn btn-primary" href="/login.html?redirect=${back}">${esc(t('live.claim.login'))}</a>
        <a class="btn btn-outline" href="/signup.html?redirect=${back}">${esc(t('live.claim.signup'))}</a>`;
      return;
    }
    if (state === 'error') { body.textContent = t(result && t('live.err.' + result) !== 'live.err.' + result ? 'live.err.' + result : 'toast.error'); return; }
    if (state === 'done') {
      body.textContent = t('live.claim.done').replace('{title}', result.session.title);
      actions.innerHTML = `<a class="btn btn-primary" href="/live/${encodeURIComponent(result.session.slug)}">${esc(t('live.claim.open'))}</a>`;
    }
  }

  if (!token) state = 'bad';
  else if (!user) state = 'login';
  else {
    try { result = await WisecallAPI.apiFetch('/live/gifts/claim', { method: 'POST', body: { token } }); state = 'done'; history.replaceState(null, '', location.pathname); }
    catch (e) { state = e.code === 'not_found' ? 'bad' : 'error'; result = e.code; }
  }
  draw();
  document.addEventListener('wisecall:lang-changed', draw);
})();
