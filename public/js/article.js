// "რჩევები": the list of articles, and one article (docs/CLAUDE-CODE-SEO.md 5). The server writes the whole page in its language; this
// only starts the shared parts (the header, the footer) and, before launch, puts the waiting-list form where the plain link to it is
// (with the article's field already chosen).
(async function () {
  await WisecallI18n.initI18n();
  await WisecallNav.initNav();
  const box = document.getElementById('articleWait');
  if (!box || !window.WisecallWaitlist || WisecallI18n.launchMode() !== 'prelaunch') return;
  box.innerHTML = WisecallWaitlist.html(box.dataset.field || undefined);
  WisecallWaitlist.wire(box);
})();
