// Admin: the review queue. A new mentor's first answers (held for a check) and reports from buyers.
// Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const locale = () => (WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const fmt = (d) => WisecallI18n.formatDate(d, { dateStyle: 'medium', timeStyle: 'short' });
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
          <span class="badge badge-pending_payment">${a.minorHold ? t('admin.q.minorBadge') : t('admin.q.answerNo').replace('{n}', a.answerNumber).replace('{of}', a.of)}</span>
        </div>
        <p class="booking-question">${esc(a.question)}</p>
        <div class="booking-answer"><strong>${t('dash.answer.label')}</strong> ${esc(a.answer)}</div>
        <p class="muted small">${a.minorHold ? t('admin.q.minorHold') : a.flagged ? `<span class="form-error">${t('admin.q.flagged')}</span>` : (a.mentorFlagged ? `<span class="form-error">${t('admin.q.mentorFlagged')}</span>` : t('admin.q.heldUntil').replace('{date}', fmt(a.heldUntil)))}</p>
        <div class="mv-decide">
          <button class="btn btn-primary btn-sm q-approve">${t('admin.q.approve')}</button>
          ${a.flagged || a.minorHold ? '' : `<button class="btn btn-outline btn-sm q-hold">${t('admin.q.hold')}</button>`}
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
        ${r.askerMinor ? `<p><span class="badge badge-pending_payment">${t('admin.q.minorBadge')}</span></p>` : ''}
        ${r.details ? `<p class="booking-question">${esc(r.details)}</p>` : ''}
        ${r.answer ? `<div class="booking-answer"><strong>${t('dash.answer.label')}</strong> ${esc(r.answer)}</div>` : ''}
        <p class="muted small">${r.reporter ? t('admin.q.reporter').replace('{name}', esc(r.reporter.name) + ' (' + esc(r.reporter.email) + ')') : ''} · ${fmt(r.createdAt)}${r.bookingId ? ' · ' + t('admin.q.fromAnswer') : ''}</p>
        <p class="muted small">${t('admin.q.openForMentor').replace('{n}', r.openForMentor)}</p>
        <div class="mv-decide">
          <input type="text" class="q-note" maxlength="300" placeholder="${esc(t('admin.q.resolveNote'))}" aria-label="${esc(t('admin.q.resolveNote'))}">
          <button class="btn btn-outline btn-sm q-dismiss">${t('admin.q.dismiss')}</button>
          <button class="btn btn-primary btn-sm q-uphold">${t('admin.q.uphold')}</button>
        </div>
      </div>`;
  }

  // A mentor reported a question.
  function questionReportCard(r) {
    return `
      <div class="booking-card q-card" data-qr="${esc(r.id)}">
        <div class="booking-top">
          <div>
            <div class="card-name">${esc(r.asker.name)}</div>
            <span class="muted small">${esc(r.asker.email)}</span>
          </div>
          <span class="badge badge-rejected">${t('report.reasons.' + r.reason)}</span>
        </div>
        ${r.askerMinor ? `<p><span class="badge badge-pending_payment">${t('admin.q.minorBadge')}</span></p>` : ''}
        <p class="booking-question">${esc(r.question)}</p>
        ${r.details ? `<p class="small">${esc(r.details)}</p>` : ''}
        <p class="muted small">${r.reporter ? t('admin.q.reporter').replace('{name}', esc(r.reporter.name) + ' (' + esc(r.reporter.email) + ')') : ''} · ${fmt(r.createdAt)}</p>
        <div class="mv-decide">
          <input type="text" class="q-note" maxlength="300" placeholder="${esc(t('admin.q.resolveNote'))}" aria-label="${esc(t('admin.q.resolveNote'))}">
          <button class="btn btn-outline btn-sm q-dismiss">${t('admin.q.dismiss')}</button>
          <button class="btn btn-primary btn-sm q-uphold">${t('admin.q.uphold')}</button>
        </div>
      </div>`;
  }

  // "Changes to review" (docs/CLAUDE-CODE-MENTOR-EDIT.md): an approved mentor's new field or chips (old against new), or new proof. One tap either way.
  let cats = { fields: [] };
  const nameIn = (x) => (x ? WisecallI18n.nameIn(x) : '');
  const fieldName = (id) => nameIn(cats.fields.find((f) => f.id === id)) || id;
  const chipName = (id) => { for (const f of cats.fields) { const c = f.chips.find((x) => x.id === id); if (c) return nameIn(c); } return id; };
  const fieldsText = (p) => p ? [p.fieldId, ...(p.extraFields || [])].filter(Boolean).map(fieldName).join(', ') + ((p.directions || []).length ? ' · ' + p.directions.map(chipName).join(', ') : '') : '—';
  function changeCard(c) {
    const body = c.kind === 'fields'
      ? `<p class="small"><strong>${t('admin.ch.old')}</strong> ${esc(fieldsText(c.current))}</p>
         <p class="small"><strong>${t('admin.ch.new')}</strong> ${esc(fieldsText(c.proposed))}</p>
         ${c.missing.length ? `<p class="form-error small">${esc(t('admin.ch.licenceMissing'))}</p>` : (c.regulated ? `<p class="small">${esc(t('admin.ch.licensed'))}</p>` : '')}`
      : `<p class="small"><strong>${t('admin.ch.proof')}</strong> ${c.evidence && c.evidence.url ? `<a href="${esc(c.evidence.url)}" target="_blank" rel="noopener noreferrer">${esc(c.evidence.url)}</a>` : esc(t('admin.ch.diploma'))}</p>`;
    return `
      <div class="booking-card q-card" data-change="${esc(c.id)}">
        <div class="booking-top">
          <div>
            <div class="card-name">${esc(c.mentor.name)}</div>
            <span class="muted small">${esc(c.mentor.email)} · ${fmt(c.createdAt)}</span>
          </div>
          <span class="badge badge-pending_payment">${t(c.kind === 'fields' ? 'admin.ch.kindFields' : 'admin.ch.kindProof')}</span>
        </div>
        ${body}
        <div class="mv-decide">
          <input type="text" class="ch-reason" maxlength="300" placeholder="${esc(t('admin.ch.reason'))}" aria-label="${esc(t('admin.ch.reason'))}">
          <button class="btn btn-primary btn-sm ch-approve"${c.missing && c.missing.length ? ' disabled' : ''}>${t('admin.ch.approve')}</button>
          <button class="btn btn-ghost btn-sm ch-reject">${t('admin.ch.reject')}</button>
        </div>
      </div>`;
  }

  async function render(container) {
    container.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    let held, reports, questionReports, changes;
    try {
      [held, reports, questionReports, changes, cats] = await Promise.all([WisecallAPI.apiFetch('/admin/answers'), WisecallAPI.apiFetch('/admin/reports'), WisecallAPI.apiFetch('/admin/question-reports'),
        WisecallAPI.apiFetch('/admin/changes'), WisecallAPI.apiFetch('/categories').catch(() => ({ fields: [] }))]);
    } catch (e) { container.innerHTML = `<p class="muted">${t('toast.error')}</p>`; return; }
    const reload = () => render(container);

    container.innerHTML = `
      <h2 class="reviews-title" id="changesTitle">${t('admin.ch.title')} (${changes.changes.length})</h2>
      ${changes.changes.length ? changes.changes.map(changeCard).join('') : `<p class="muted">${t('admin.ch.none')}</p>`}
      <h2 class="reviews-title" style="margin-top:32px">${t('admin.q.answers')} (${held.answers.length})</h2>
      <p class="muted small">${t('admin.q.answersHelp').replace('{hours}', held.holdHours)}</p>
      ${held.answers.length ? held.answers.map(answerCard).join('') : `<p class="muted">${t('admin.q.noAnswers')}</p>`}
      <h2 class="reviews-title" style="margin-top:32px">${t('admin.q.reports')} (${reports.reports.length})</h2>
      ${reports.reports.length ? reports.reports.map(reportCard).join('') : `<p class="muted">${t('admin.q.noReports')}</p>`}
      <h2 class="reviews-title" style="margin-top:32px">${t('admin.q.questionReports')} (${questionReports.reports.length})</h2>
      ${questionReports.reports.length ? questionReports.reports.map(questionReportCard).join('') : `<p class="muted">${t('admin.q.noReports')}</p>`}`;

    container.querySelectorAll('[data-change]').forEach((card) => {
      const decide = (decision) => async () => {
        const reason = card.querySelector('.ch-reason').value.trim();
        try { await WisecallAPI.apiFetch(`/admin/changes/${card.dataset.change}/${decision}`, { method: 'POST', body: reason ? { reason } : {} }); WisecallNav.showToast(t('toast.saved')); reload(); }
        catch (e) { WisecallNav.showToast(t(e.code === 'licence_missing' ? 'admin.ch.licenceMissing' : 'toast.error')); }
      };
      card.querySelector('.ch-approve').addEventListener('click', decide('approve'));
      card.querySelector('.ch-reject').addEventListener('click', decide('reject'));
    });
    container.querySelectorAll('.q-card:not([data-change])').forEach((card) => {
      const id = card.dataset.id || card.dataset.qr;
      const post = async (path, body, okKey) => {
        try { await WisecallAPI.apiFetch(path, { method: 'POST', body }); WisecallNav.showToast(t(okKey || 'toast.saved')); reload(); } catch (e) { fail(e); }
      };
      const on = (sel, fn) => { const el = card.querySelector(sel); if (el) el.addEventListener('click', fn); };
      on('.q-approve', () => post(`/admin/answers/${id}/approve`));
      on('.q-hold', () => post(`/admin/answers/${id}/flag`));
      on('.q-reject', async () => {
        const reason = card.querySelector('.q-reason').value.trim();
        if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
        if (!(await WisecallDialog.confirm({ message: t('admin.q.rejectConfirm'), confirmText: t('admin.q.rejectButton'), danger: true }))) return;
        post(`/admin/answers/${id}/reject`, { reason });
      });
      const resolve = (resolution) => () => {
        const note = card.querySelector('.q-note').value.trim();
        if (note.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
        post(`/admin/${card.dataset.qr ? 'question-reports' : 'reports'}/${id}/resolve`, { resolution, note });
      };
      on('.q-dismiss', resolve('dismissed'));
      on('.q-uphold', resolve('upheld'));
    });
  }

  window.AdminQueue = { render };
})();
