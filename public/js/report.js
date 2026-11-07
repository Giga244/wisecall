// "Report this mentor": a small form that opens under a link on a mentor's profile or on an answer.
// Reports go to the Wisecall team; the mentor never sees who reported.
(function () {
  const REASONS = ['misleading', 'fake_credentials', 'inappropriate', 'spam', 'other'];
  // (the report button on an answer, and on a question for its mentor: docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 6)
  const ANSWER_REASONS = ['contact_request', 'misleading', 'inappropriate', 'unsafe', 'spam', 'other'];
  const QUESTION_REASONS = ['contact_request', 'inappropriate', 'unsafe', 'spam', 'other'];
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // bookingId is set when the report is about a specific answer. Signed-out visitors get a link to log in.
  function html(mentorId, bookingId, loggedIn) {
    if (!loggedIn) {
      const back = encodeURIComponent(window.location.pathname + window.location.search);
      return `<p class="report-login"><a href="/login.html?redirect=${back}">${t('report.loginRequired')}</a></p>`;
    }
    return `
      <details class="report-box" data-mentor="${esc(mentorId)}"${bookingId ? ` data-booking="${esc(bookingId)}"` : ''}>
        <summary>${t('report.link')}</summary>
        <form class="report-form" novalidate>
          <p class="muted small">${t('report.intro')}</p>
          <label for="rp-reason-${esc(bookingId || mentorId)}"><span>${t('report.reason')}</span>
            <select id="rp-reason-${esc(bookingId || mentorId)}" name="reason" required>${REASONS.map((r) => `<option value="${r}">${t('report.reasons.' + r)}</option>`).join('')}</select>
          </label>
          <label for="rp-details-${esc(bookingId || mentorId)}"><span>${t('report.details')}</span><textarea id="rp-details-${esc(bookingId || mentorId)}" name="details" rows="3" maxlength="1000"></textarea></label>
          <p class="form-error report-error" role="alert"></p>
          <button class="btn btn-outline btn-sm" type="submit">${t('report.send')}</button>
        </form>
      </details>`;
  }

  // The "report" button on one answer or question.
  function buttonHtml({ mentorId, bookingId, question }) {
    const id = `${question ? 'q' : 'a'}-${esc(bookingId || mentorId)}`;
    const reasons = question ? QUESTION_REASONS : ANSWER_REASONS;
    return `
      <details class="report-box report-button"${question ? ` data-question="${esc(bookingId)}"` : ` data-mentor="${esc(mentorId)}"${bookingId ? ` data-booking="${esc(bookingId)}"` : ''}`}>
        <summary>${t('report.button')}</summary>
        <form class="report-form" novalidate>
          <p class="muted small">${t(question ? 'report.question.intro' : 'report.answer.intro')}</p>
          <fieldset class="report-reasons"><legend>${t('report.reason')}</legend>
            ${reasons.map((r, i) => `<label class="radio-row"><input type="radio" name="reason" value="${r}"${i === 0 ? ' checked' : ''}> <span>${t('report.reasons.' + r)}</span></label>`).join('')}
          </fieldset>
          <label for="rp-details-${id}"><span>${t('report.details')}</span><textarea id="rp-details-${id}" name="details" rows="3" maxlength="1000"></textarea></label>
          <p class="form-error report-error" role="alert"></p>
          <button class="btn btn-outline btn-sm" type="submit">${t('report.send')}</button>
        </form>
      </details>`;
  }

  function wire(root) {
    root.querySelectorAll('.report-box').forEach((box) => {
      const form = box.querySelector('form');
      if (form.dataset.wired) return;
      form.dataset.wired = '1';
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const error = form.querySelector('.report-error');
        const button = form.querySelector('button');
        error.textContent = '';
        button.disabled = true;
        try {
          const details = form.details.value.trim();
          if (box.dataset.question) await WisecallAPI.apiFetch(`/bookings/${box.dataset.question}/report-question`, { method: 'POST', body: { reason: form.reason.value, details } });
          else await WisecallAPI.apiFetch(`/experts/${box.dataset.mentor}/report`, { method: 'POST', body: { reason: form.reason.value, details, bookingId: box.dataset.booking || undefined } });
          box.innerHTML = `<p class="muted small" role="status">${t('report.sent')}</p>`;
        } catch (e) {
          error.textContent = t(e.code === 'already_reported' ? (box.classList.contains('report-button') ? 'report.alreadyHere' : 'report.already') : 'report.error');
          button.disabled = false;
        }
      });
    });
  }

  window.WisecallReport = { html, buttonHtml, wire };
})();
