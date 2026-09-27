// The FAQ and "How we verify mentors" pages: written in by the server in the page's language; this only starts the shared parts
// (texts when the visitor switches language, the header and the footer).
(async function () {
  await WisecallI18n.initI18n();
  await WisecallNav.initNav();
  // (the badge texts end with "Verified {date}.", which means nothing on this page)
  const strip = () => document.querySelectorAll('.hvp-badges span').forEach((el) => { el.textContent = el.textContent.replace(/\s*[^.]*\{date\}\.?$/, ''); });
  strip();
  document.addEventListener('wisecall:lang-changed', strip);
})();
