// "Report this mentor": a small form that opens under a link on a mentor's profile or on an answer.
// Reports go to the Wisecall team; the mentor never sees who reported.
(function () {
  const REASONS = ['misleading', 'fake_credentials', 'inappropriate', 'spam', 'other'];
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
          <label><span>${t('report.reason')}</span>
            <select name="reason" required>${REASONS.map((r) => `<option value="${r}">${t('report.reasons.' + r)}</option>`).join('')}</select>
          </label>
          <label><span>${t('report.details')}</span><textarea name="details" rows="3" maxlength="1000"></textarea></label>
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
          await WisecallAPI.apiFetch(`/experts/${box.dataset.mentor}/report`, {
            method: 'POST',
            body: { reason: form.reason.value, details: form.details.value.trim(), bookingId: box.dataset.booking || undefined }
          });
          box.innerHTML = `<p class="muted small" role="status">${t('report.sent')}</p>`;
        } catch (e) {
          error.textContent = t(e.code === 'already_reported' ? 'report.already' : 'report.error');
          button.disabled = false;
        }
      });
    });
  }

  window.WisecallReport = { html, wire };
})();
