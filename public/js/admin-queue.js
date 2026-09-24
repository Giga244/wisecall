// Admin: the review queue. A new mentor's first answers (held for a check) and reports from buyers.
// Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const locale = () => (WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const fmt = (d) => new Date(d).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  const errKey = { reason_required: 'admin.mv.reasonRequired', invalid_resolution: 'toast.error', refund_failed: 'admin.bk.refundFailed' };
  const fail = (e) => WisecallNav.showToast(t(errKey[e.code] || 'toast.error'));

  function answerCard(a) {
    return `
      <div class="booking-card q-card" data-id="${esc(a.id)}">
        <div class="booking-top">
          <div>
            <div class="card-name">${esc(a.mentor.name)}</div>
            <span class="muted small">${esc(a.mentor.email)}${a.mentor.niche ? ' · ' + esc(t('niche.' + a.mentor.niche)) : ''}</span>
          </div>
          <span class="badge badge-pending_payment">${t('admin.q.answerNo').replace('{n}', a.answerNumber).replace('{of}', a.of)}</span>
        </div>
        <p class="booking-question">${esc(a.question)}</p>
        <div class="booking-answer"><strong>${t('dash.answer.label')}</strong> ${esc(a.answer)}</div>
        <p class="muted small">${a.flagged ? `<span class="form-error">${t('admin.q.flagged')}</span>` : (a.mentorFlagged ? `<span class="form-error">${t('admin.q.mentorFlagged')}</span>` : t('admin.q.heldUntil').replace('{date}', fmt(a.heldUntil)))}</p>
        <div class="mv-decide">
          <button class="btn btn-primary btn-sm q-approve">${t('admin.q.approve')}</button>
          ${a.flagged ? '' : `<button class="btn btn-outline btn-sm q-hold">${t('admin.q.hold')}</button>`}
        </div>
        <div class="mv-decide">
          <input type="text" class="q-reason" maxlength="300" placeholder="${esc(t('admin.q.rejectReason'))}" aria-label="${esc(t('admin.q.rejectReason'))}">
          <button class="btn btn-ghost btn-sm q-reject">${t('admin.q.reject')}</button>
        </div>
      </div>`;
  }

  function reportCard(r) {
    return `
      <div class="booking-card q-card" data-id="${esc(r.id)}">
        <div class="booking-top">
          <div>
            <div class="card-name">${esc(r.mentor.name)}</div>
            <span class="muted small">${esc(r.mentor.email)} · ${t('settings.verify.' + (r.mentor.status || 'none'))}</span>
          </div>
          <span class="badge badge-rejected">${t('report.reasons.' + r.reason)}</span>
        </div>
        ${r.details ? `<p class="booking-question">${esc(r.details)}</p>` : ''}
        <p class="muted small">${r.reporter ? t('admin.q.reporter').replace('{name}', esc(r.reporter.name) + ' (' + esc(r.reporter.email) + ')') : ''} · ${fmt(r.createdAt)}${r.bookingId ? ' · ' + t('admin.q.fromAnswer') : ''}</p>
        <p class="muted small">${t('admin.q.openForMentor').replace('{n}', r.openForMentor)}</p>
        <div class="mv-decide">
          <input type="text" class="q-note" maxlength="300" placeholder="${esc(t('admin.q.resolveNote'))}" aria-label="${esc(t('admin.q.resolveNote'))}">
          <button class="btn btn-outline btn-sm q-dismiss">${t('admin.q.dismiss')}</button>
          <button class="btn btn-primary btn-sm q-uphold">${t('admin.q.uphold')}</button>
        </div>
      </div>`;
  }

  async function render(container) {
    container.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    let held, reports;
    try {
      [held, reports] = await Promise.all([WisecallAPI.apiFetch('/admin/answers'), WisecallAPI.apiFetch('/admin/reports')]);
    } catch (e) { container.innerHTML = `<p class="muted">${t('toast.error')}</p>`; return; }
    const reload = () => render(container);

    container.innerHTML = `
      <h2 class="reviews-title">${t('admin.q.answers')} (${held.answers.length})</h2>
      <p class="muted small">${t('admin.q.answersHelp').replace('{hours}', held.holdHours)}</p>
      ${held.answers.length ? held.answers.map(answerCard).join('') : `<p class="muted">${t('admin.q.noAnswers')}</p>`}
      <h2 class="reviews-title" style="margin-top:32px">${t('admin.q.reports')} (${reports.reports.length})</h2>
      ${reports.reports.length ? reports.reports.map(reportCard).join('') : `<p class="muted">${t('admin.q.noReports')}</p>`}`;

    container.querySelectorAll('.q-card').forEach((card) => {
      const id = card.dataset.id;
      const post = async (path, body, okKey) => {
        try { await WisecallAPI.apiFetch(path, { method: 'POST', body }); WisecallNav.showToast(t(okKey || 'toast.saved')); reload(); } catch (e) { fail(e); }
      };
      const on = (sel, fn) => { const el = card.querySelector(sel); if (el) el.addEventListener('click', fn); };
      on('.q-approve', () => post(`/admin/answers/${id}/approve`));
      on('.q-hold', () => post(`/admin/answers/${id}/flag`));
      on('.q-reject', () => {
        const reason = card.querySelector('.q-reason').value.trim();
        if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
        if (!window.confirm(t('admin.q.rejectConfirm'))) return;
        post(`/admin/answers/${id}/reject`, { reason });
      });
      const resolve = (resolution) => () => {
        const note = card.querySelector('.q-note').value.trim();
        if (note.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
        post(`/admin/reports/${id}/resolve`, { resolution, note });
      };
      on('.q-dismiss', resolve('dismissed'));
      on('.q-uphold', resolve('upheld'));
    });
  }

  window.AdminQueue = { render };
})();
