// /answers and /answers/<slug> (written by the server): the page's own texts are already in the page's language; this adds the header
// and footer, and the "Helpful" button (once per visitor: a random id kept in this browser, which the server only stores as a hash).
(async function () {
  await WisecallI18n.initI18n();
  await WisecallNav.initNav();
  const t = WisecallI18n.t;
  const btn = document.getElementById('helpfulBtn');
  if (!btn) return;
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
