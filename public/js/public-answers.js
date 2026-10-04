// Public answers on the dashboard: after a 4–5★ rating the asker is asked "Let others learn from this answer? Your name is never shown",
// sees the question as it would be published (and can edit it), and agrees or says no; the mentor then agrees (and may edit the public
// version of the answer) or declines; either can withdraw it at any time. An admin approves every one before it is public.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX = 1000;

  function statusLine(p) {
    const key = { pending_mentor: 'pa.status.pending_mentor', pending_review: 'pa.status.pending_review', published: 'pa.status.published',
      rejected: 'pa.status.rejected', withdrawn: 'pa.status.withdrawn', declined: 'pa.status.declined' }[p.status];
    if (!key) return '';
    const link = p.status === 'published' && p.slug ? ` <a class="plain-link" href="/answers/${encodeURIComponent(p.slug)}">${esc(t('pa.view'))}</a>` : '';
    const reason = p.status === 'rejected' && p.rejectReason ? `<span class="small muted block">${esc(p.rejectReason)}</span>` : '';
    const withdraw = ['pending_mentor', 'pending_review', 'published'].includes(p.status)
      ? ` <button type="button" class="linklike pa-withdraw" data-pa="${esc(p.id)}">${esc(t('pa.withdraw'))}</button>` : '';
    return `<p class="pa-status small">${esc(t(key))}${link}${withdraw}${reason}</p>`;
  }

  // b: a booking from /api/bookings/mine (with b.publicAnswer); role: 'asker' or 'mentor'.
  function html(b, role) {
    const p = b.publicAnswer;
    if (!p) return '';
    if (role === 'asker' && p.canOffer) {
      return `
        <details class="decline-box pa-box" open>
          <summary>${esc(t('pa.offer.title'))}</summary>
          <form class="pa-offer" data-booking="${esc(b.id)}" novalidate>
            <p class="small">${esc(t('pa.offer.body'))}</p>
            <label class="field-label small" for="pa-q-${esc(b.id)}">${esc(t('pa.offer.question'))}</label>
            <textarea id="pa-q-${esc(b.id)}" rows="5" maxlength="${MAX}">${esc(p.draft)}</textarea>
            <p class="small muted">${esc(t('pa.offer.redacted'))}</p>
            <p class="form-error" role="alert"></p>
            <div class="answer-actions">
              <button type="button" class="btn btn-outline btn-sm pa-no">${esc(t('pa.offer.no'))}</button>
              <button type="submit" class="btn btn-primary btn-sm">${esc(t('pa.offer.yes'))}</button>
            </div>
          </form>
        </details>`;
    }
    if (role === 'mentor' && p.status === 'pending_mentor') {
      return `
        <details class="decline-box pa-box" open>
          <summary>${esc(t('pa.mentor.title'))}</summary>
          <form class="pa-mentor" data-pa="${esc(p.id)}" novalidate>
            <p class="small">${esc(t('pa.mentor.body'))}</p>
            <p class="small"><strong>${esc(t('pa.mentor.question'))}</strong> ${esc(p.question)}</p>
            <label class="field-label small" for="pa-a-${esc(p.id)}">${esc(t('pa.mentor.answer'))}</label>
            <textarea id="pa-a-${esc(p.id)}" rows="7" maxlength="8000">${esc(p.answer)}</textarea>
            <p class="form-error" role="alert"></p>
            <div class="answer-actions">
              <button type="button" class="btn btn-outline btn-sm pa-decline">${esc(t('pa.mentor.no'))}</button>
              <button type="submit" class="btn btn-primary btn-sm">${esc(t('pa.mentor.yes'))}</button>
            </div>
          </form>
        </details>`;
    }
    return statusLine(p);
  }

  const ERR = { invalid_question: 'pa.err.question', invalid_answer: 'pa.err.answer', offensive: 'pa.err.offensive', rating_needed: 'pa.err.rating',
    mentor_declines: 'pa.err.mentor', already_decided: 'pa.err.decided' };

  function wire(container, { reload }) {
    const fail = (form, e) => { form.querySelector('.form-error').textContent = t(ERR[e.code] || 'toast.error'); };
    container.querySelectorAll('.pa-offer').forEach((form) => {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          await WisecallAPI.apiFetch('/answers/offer', { method: 'POST', body: { bookingId: form.dataset.booking, question: form.querySelector('textarea').value } });
          WisecallNav.showToast(t('pa.offer.sent'));
          reload();
        } catch (e) { fail(form, e); }
      });
      form.querySelector('.pa-no').addEventListener('click', async () => {
        try { await WisecallAPI.apiFetch('/answers/decline', { method: 'POST', body: { bookingId: form.dataset.booking } }); reload(); } catch (e) { fail(form, e); }
      });
    });
    container.querySelectorAll('.pa-mentor').forEach((form) => {
      const decide = async (agree) => {
        try {
          await WisecallAPI.apiFetch(`/answers/${form.dataset.pa}/mentor`, { method: 'POST', body: { agree, answer: agree ? form.querySelector('textarea').value : undefined } });
          WisecallNav.showToast(t(agree ? 'pa.mentor.sent' : 'pa.mentor.declined'));
          reload();
        } catch (e) { fail(form, e); }
      };
      form.addEventListener('submit', (ev) => { ev.preventDefault(); decide(true); });
      form.querySelector('.pa-decline').addEventListener('click', () => decide(false));
    });
    container.querySelectorAll('.pa-withdraw').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await WisecallDialog.confirm({ message: t('pa.withdrawConfirm'), confirmText: t('pa.withdrawButton'), danger: true }))) return;
      btn.disabled = true;
      try { await WisecallAPI.apiFetch(`/answers/${btn.dataset.pa}/withdraw`, { method: 'POST' }); WisecallNav.showToast(t('pa.withdrawn')); reload(); }
      catch (e) { WisecallNav.showToast(t('toast.error')); btn.disabled = false; }
    }));
  }

  window.WisecallPublicAnswers = { html, wire };
})();
