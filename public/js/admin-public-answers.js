// Admin: public answers waiting for review. Nothing is published without this: approve (the question and answer can be edited first; a
// regulated field needs "allow it" ticked), or reject with a reason. Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function card(a) {
    return `
      <div class="booking-card pa-review" data-id="${esc(a.id)}">
        <div class="booking-top"><div>
          <div class="card-name">${esc(a.mentorName)}</div>
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

  async function render(container) {
    container.innerHTML = `<p class="muted">${esc(t('admin.loading'))}</p>`;
    let d;
    try { d = await WisecallAPI.apiFetch('/admin/public-answers'); } catch (e) { container.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    container.innerHTML = `<p class="muted small">${esc(t('admin.pa.help'))}</p>${d.queue.length ? d.queue.map(card).join('') : `<p class="muted">${esc(t('admin.pa.empty'))}</p>`}`;
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
