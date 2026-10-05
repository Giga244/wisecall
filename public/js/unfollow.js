// The "stop following" link in an email about a mentor's new live session opens this page, which stops following them. The token in
// the link is signed by the server and names the person and the mentor; no sign-in is needed.
(async function () {
  await WisecallI18n.initI18n();
  const body = document.getElementById('unfollowBody');
  const token = new URLSearchParams(window.location.search).get('t');
  let ok = false;
  if (token) {
    try { await WisecallAPI.apiFetch('/live/follows/unfollow', { method: 'POST', body: { token } }); ok = true; } catch (e) { ok = false; }
  }
  const draw = () => { body.textContent = WisecallI18n.t(ok ? 'follow.unfollowed' : 'unsub.bad'); };
  draw();
  document.addEventListener('wisecall:lang-changed', draw);
})();
