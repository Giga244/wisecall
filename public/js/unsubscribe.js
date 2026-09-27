// The unsubscribe link in an optional email (a rating reminder, tips) opens this page, which turns that kind of email off. The token in
// the link is signed by the server and names the person and the kind of email; no sign-in is needed.
(async function () {
  await WisecallI18n.initI18n();
  const body = document.getElementById('unsubBody');
  const token = new URLSearchParams(window.location.search).get('t');
  let result = null;
  function draw() {
    const t = WisecallI18n.t;
    if (result === 'bad') body.textContent = t('unsub.bad');
    else if (result) body.textContent = t('unsub.done.' + result);
  }
  if (!token) result = 'bad';
  else {
    try { result = (await WisecallAPI.apiFetch('/inbox/unsubscribe', { method: 'POST', body: { token } })).category; }
    catch (e) { result = 'bad'; }
  }
  draw();
  document.addEventListener('wisecall:lang-changed', draw);
})();
