// /answers and /answers/<slug> (written by the server): the page's own texts are already in the page's language; this adds the header
// and footer, the list's skeleton while a new search loads, and the "Helpful" button (once per visitor: a random id kept in this
// browser, which the server only stores as a hash).
(async function () {
  await WisecallI18n.initI18n();
  const viewer = await WisecallNav.initNav();
  // (one published answer: the report button, docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 6)
  const reportBox = document.getElementById('answerReport');
  if (reportBox && reportBox.dataset.mentor) {
    reportBox.innerHTML = viewer ? WisecallReport.buttonHtml({ mentorId: reportBox.dataset.mentor }) : WisecallReport.html(reportBox.dataset.mentor, null, false);
    WisecallReport.wire(reportBox);
  }
  const t = WisecallI18n.t;

  // A new search or field: while the next page is on its way, the list shows three answers as skeletons (and "Loading…" for screen
  // readers). Coming back to this page from the browser's memory shows the list it had again.
  const search = document.querySelector('.answers-search');
  const list = document.querySelector('.answers-list');
  if (search && list) {
    const shown = list.innerHTML;
    const line = (w) => `<span class="skeleton skeleton-line${w ? ' ' + w : ''}"></span>`;
    const card = `<article class="answer-card skeleton-answer" aria-hidden="true"><span class="skeleton skeleton-name w80"></span>${line()}${line('w90')}${line('w60')}${line('w40')}</article>`;
    search.addEventListener('submit', () => {
      list.setAttribute('aria-busy', 'true');
      list.innerHTML = `<p class="sr-only" role="status">${t('experts.loading')}</p>${card.repeat(3)}`;
    });
    window.addEventListener('pageshow', (ev) => {
      if (!ev.persisted) return;
      list.innerHTML = shown;
      list.removeAttribute('aria-busy');
    });
  }

  const btn = document.getElementById('helpfulBtn');
  if (!btn) return;
  btn.insertAdjacentHTML('afterend', ' ' + WisecallCopy.button(location.origin + location.pathname));
  WisecallCopy.wire(btn.parentNode);
  const KEY = 'wisecall_visitor';
  let visitor = null;
  try { visitor = localStorage.getItem(KEY); } catch (e) { /* storage unavailable */ }
  if (!visitor) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    visitor = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(KEY, visitor); } catch (e) { /* the vote still counts once per page load */ }
  }
  const doneKey = `wisecall_helpful_${btn.dataset.slug}`;
  const done = () => { try { return localStorage.getItem(doneKey) === '1'; } catch (e) { return false; } };
  if (done()) { btn.disabled = true; btn.textContent = t('answers.helpfulThanks'); }
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const r = await WisecallAPI.apiFetch(`/answers/${encodeURIComponent(btn.dataset.slug)}/helpful`, { method: 'POST', body: { visitor } });
      document.getElementById('helpfulCount').textContent = t('answers.helpfulCount').replace('{n}', r.helpful);
      btn.textContent = t('answers.helpfulThanks');
      try { localStorage.setItem(doneKey, '1'); } catch (e) { /* fine */ }
    } catch (e) {
      WisecallNav.showToast(t('toast.error'));
      btn.disabled = false;
    }
  });
})();
