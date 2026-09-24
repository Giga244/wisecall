// The link in a "a mentor joined" email opens this page, which removes the address from the waiting list.
(async function () {
  await WisecallI18n.initI18n();
  const title = document.getElementById('unsubTitle');
  const body = document.getElementById('unsubBody');
  const token = new URLSearchParams(window.location.search).get('token');
  let state = 'working';

  function draw() {
    const t = WisecallI18n.t;
    if (state === 'done') { title.textContent = t('wait.unsub.doneTitle'); body.textContent = t('wait.unsub.done'); }
    else if (state === 'invalid') { title.textContent = t('wait.unsub.invalidTitle'); body.textContent = t('wait.unsub.invalid'); }
  }

  if (!token) state = 'invalid';
  else {
    try { await WisecallAPI.apiFetch('/waitlist/unsubscribe', { method: 'POST', body: { token } }); state = 'done'; }
    catch (e) { state = 'invalid'; } // a link works once, so opening it twice ends up here
  }
  draw();
  document.addEventListener('wisecall:lang-changed', draw);
})();
