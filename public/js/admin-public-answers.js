// Admin: public answers waiting for review. Nothing is published without this: approve (the question and answer can be edited first; a
// regulated field needs "allow it" ticked), or reject with a reason. Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function card(a) {
    return `
      <div class="booking-card pa-review" data-id="${esc(a.id)}">
        <div class="booking-top"><div>
          <div class="card-name">${esc(a.mentorName)}${a.sample ? ` <span class="badge badge-paid">${esc(t('pa.sample'))}</span>` : ''}</div>
          <span class="muted small">${esc(a.niche ? t('niche.' + a.niche) : '—')}${a.regulated ? ` · <span class="badge badge-rejected">${esc(t('admin.pa.regulated'))}</span>` : ''}</span>
        </div></div>
        <label class="field-label small" for="pa-q-${esc(a.id)}">${esc(t('admin.pa.question'))}</label>
        <textarea id="pa-q-${esc(a.id)}" class="pa-q" rows="4" maxlength="1000">${esc(a.question)}</textarea>
        <label class="field-label small" for="pa-a-${esc(a.id)}">${esc(t('admin.pa.answer'))}</label>
        <textarea id="pa-a-${esc(a.id)}" class="pa-a" rows="7" maxlength="8000">${esc(a.answer)}</textarea>
        ${a.regulated ? `<label class="checkbox-row"><input type="checkbox" class="pa-allow"> <span>${esc(t('admin.pa.allowRegulated'))}</span></label>` : ''}
        <div class="payout-pay">
          <button type="button" class="btn btn-primary btn-sm pa-approve">${esc(t('admin.pa.approve'))}</button>
        </div>
        <div class="payout-pay">
          <input type="text" class="pa-reason" maxlength="500" placeholder="${esc(t('admin.pa.reasonPlaceholder'))}" aria-label="${esc(t('admin.pa.reasonPlaceholder'))}">
          <button type="button" class="btn btn-outline btn-sm pa-reject">${esc(t('admin.pa.reject'))}</button>
        </div>
      </div>`;
  }

  // Questions from the team for approved mentors to answer before launch (their answers come into the queue below, marked "Sample").
  async function samples(box) {
    let d;
    try { d = await WisecallAPI.apiFetch('/admin/sample-questions'); } catch (e) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div class="settings-card pa-samples">
        <h3>${esc(t('admin.samples.title'))}</h3>
        <p class="muted small">${esc(t('admin.samples.help'))}</p>
        <form class="pa-sample-form">
          <label class="field-label small" for="paSampleQ">${esc(t('admin.samples.question'))}</label>
          <textarea id="paSampleQ" rows="2" maxlength="1000" required></textarea>
          <button type="submit" class="btn btn-primary btn-sm">${esc(t('admin.samples.add'))}</button>
        </form>
        <ul class="earn-list">${d.questions.map((q) => `<li data-q="${esc(q.id)}"><span>${esc(q.question)}</span>
          <span class="muted small">${esc(t('admin.samples.published').replace('{n}', q.published))}${q.active ? '' : ' · ' + esc(t('admin.samples.closed'))}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-toggle="${q.active ? 'close' : 'open'}">${esc(t(q.active ? 'admin.samples.close' : 'admin.samples.open'))}</button></li>`).join('')}</ul>
      </div>`;
    box.querySelector('.pa-sample-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { await WisecallAPI.apiFetch('/admin/sample-questions', { method: 'POST', body: { question: box.querySelector('#paSampleQ').value } }); WisecallNav.showToast(t('toast.saved')); samples(box); }
      catch (e) { WisecallNav.showToast(t(e.code === 'invalid_question' ? 'pa.err.question' : 'toast.error')); }
    });
    box.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      try { await WisecallAPI.apiFetch(`/admin/sample-questions/${b.closest('[data-q]').dataset.q}`, { method: 'POST', body: { active: b.dataset.toggle === 'open' } }); samples(box); }
      catch (e) { WisecallNav.showToast(t('toast.error')); }
    }));
  }

  async function render(container) {
    container.innerHTML = `<p class="muted">${esc(t('admin.loading'))}</p>`;
    let d;
    try { d = await WisecallAPI.apiFetch('/admin/public-answers'); } catch (e) { container.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    container.innerHTML = `<div class="pa-samples-box"></div><p class="muted small">${esc(t('admin.pa.help'))}</p>${d.queue.length ? d.queue.map(card).join('') : `<p class="muted">${esc(t('admin.pa.empty'))}</p>`}`;
    samples(container.querySelector('.pa-samples-box'));
    container.querySelectorAll('.pa-review').forEach((el) => {
      const id = el.dataset.id;
      el.querySelector('.pa-approve').addEventListener('click', async (ev) => {
        const allow = el.querySelector('.pa-allow');
        ev.target.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/admin/public-answers/${id}/approve`, { method: 'POST', body: { question: el.querySelector('.pa-q').value, answer: el.querySelector('.pa-a').value, allowRegulated: Boolean(allow && allow.checked) } });
          WisecallNav.showToast(t('admin.pa.published'));
          render(container);
        } catch (e) {
          WisecallNav.showToast(t(e.code === 'regulated_needs_permission' ? 'admin.pa.needAllow' : (e.code === 'invalid_question' ? 'pa.err.question' : 'toast.error')));
          ev.target.disabled = false;
        }
      });
      el.querySelector('.pa-reject').addEventListener('click', async (ev) => {
        const reason = el.querySelector('.pa-reason').value.trim();
        if (reason.length < 5) { WisecallNav.showToast(t('admin.reasonRequired')); return; }
        ev.target.disabled = true;
        try { await WisecallAPI.apiFetch(`/admin/public-answers/${id}/reject`, { method: 'POST', body: { reason } }); WisecallNav.showToast(t('toast.saved')); render(container); }
        catch (e) { WisecallNav.showToast(t('toast.error')); ev.target.disabled = false; }
      });
    });
  }

  window.AdminPublicAnswers = { render };
})();
