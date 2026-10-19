// The FAQ, "How we verify mentors" and "Become a mentor" pages: written in by the server in the page's language; this only starts the
// shared parts (texts when the visitor switches language, the header and the footer).
(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  // "Start my application": a mentor account first (the mentor sign-up), or straight to the application for someone signed in
  document.querySelectorAll('.become-link').forEach((a) => { a.href = user ? '/apply.html' : '/signup.html?as=mentor'; });
  // (the badge texts end with "Verified {date}.", which means nothing on this page)
  const strip = () => document.querySelectorAll('.hvp-badges span').forEach((el) => { el.textContent = el.textContent.replace(/\s*[^.]*\{date\}\.?$/, ''); });
  strip();
  document.addEventListener('wisecall:lang-changed', strip);
})();
