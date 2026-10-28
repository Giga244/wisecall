// The dashboard's "Sample answers" (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 4): an approved mentor answers a question from
// the team before launch; after the team's check it shows on /answers and on their profile, marked "Sample". Hidden for everyone else.
(function () {
  const box = document.getElementById('sampleAnswers');
  if (!box) return;
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MIN = 150;
  const status = (mine) => {
    if (!mine) return '';
    const text = mine.status === 'rejected' ? t('dash.samples.rejected').replace('{reason}', mine.rejectReason || '') : t('dash.samples.' + mine.status);
    return `<p class="small sample-status"><span class="badge badge-${mine.status === 'published' ? 'answered' : (mine.status === 'rejected' ? 'rejected' : 'pending_payment')}">${esc(text)}</span></p>`;
  };
  async function load() {
    let d;
    try { d = await WisecallAPI.apiFetch('/answers/samples'); } catch (e) { return; }
    const list = d.questions || [];
    if (!list.length) { box.hidden = true; return; }
    box.innerHTML = `<h2 id="sampleAnswersTitle">${esc(t('dash.samples.title'))}</h2>
      <p class="muted small">${esc(t('dash.samples.lead'))}</p>
      <p class="hint answer-tips">${esc(t('dash.answer.tips'))}</p>
      ${list.map((q) => `<form class="sample-form" data-q="${esc(q.id)}" novalidate>
        <label class="field-label" for="sample-${esc(q.id)}">${esc(q.question)}</label>
        ${status(q.mine)}
        ${q.mine && q.mine.status === 'published' ? `<p class="small">${esc(q.mine.answer)}</p>` : `
        <textarea id="sample-${esc(q.id)}" rows="6" maxlength="8000">${esc(q.mine ? q.mine.answer : '')}</textarea>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-sm">${esc(t('dash.samples.save'))}</button>`}
      </form>`).join('')}`;
    box.hidden = false;
    box.querySelectorAll('.sample-form').forEach((f) => f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const area = f.querySelector('textarea');
      const err = f.querySelector('.form-error');
      if (!area) return;
      if ([...area.value.trim()].length < MIN) { err.textContent = t('dash.samples.short').replace('{min}', MIN); area.focus(); return; }
      const btn = f.querySelector('button');
      btn.disabled = true;
      try { await WisecallAPI.apiFetch(`/answers/samples/${f.dataset.q}`, { method: 'PUT', body: { answer: area.value } }); WisecallNav.showToast(t('toast.saved')); load(); }
      catch (e) { err.textContent = t(e.code === 'invalid_answer' ? 'dash.samples.short' : 'toast.error').replace('{min}', MIN); btn.disabled = false; }
    }));
  }
  load();
})();
