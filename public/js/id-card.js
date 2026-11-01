// "One step left: confirm your identity" (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md): the card shown when steps 1-4 of the mentor application are
// done and the ID check is not (not started, opened and left, or failed), at the top of /apply.html, on the dashboard and in Settings. One
// big button starts the check at the partner (Didit); on a computer a QR code does it on the phone; a short "why". The check itself, the 18+
// rule and the name match are unchanged: this only makes the step impossible to miss.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // The ID card, the same picture on the card and on the 5th dot of the progress bar.
  const ICON = '<svg class="id-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5 16c.6-1.6 2-2.4 3.5-2.4S11.4 14.4 12 16M14.5 10h4M14.5 13.5h3"/></svg>';
  // The QR button: for anything wider than a phone. (It used to need a mouse and 900px, so a small or zoomed-in window, or a computer with a touch screen,
  // had no button at all.)
  const showsQr = () => window.innerWidth >= 600;

  // id: 'todo' | 'started' | 'failed' (where the check stands, from the server). opts.heading: 'h1' on a page whose title it is, else 'h2'.
  // opts.failedText: the plain reason when it failed. opts.title: another title (step 5 while steps 1-4 are not all done yet: it is not
  // the one step left then). opts.returned: back from the partner's page, the result not here yet ("we're waiting for the result").
  function html(id, opts = {}) {
    const h = opts.heading || 'h2';
    const note = id === 'failed'
      ? `<p class="id-card-failed" role="alert">${esc(opts.failedText || t('apply.id.failed'))}</p>`
      : (id === 'started' ? `<p class="id-card-note" role="status">${esc(t(opts.returned ? 'vt.kyc.returned' : 'idcard.started'))}</p>` : '');
    return `
      <section class="id-card" data-id-card="${esc(id)}" aria-labelledby="idCardTitle">
        <div class="id-card-head">
          <span class="id-card-icon">${ICON}</span>
          <${h} id="idCardTitle" tabindex="-1">${esc(t(opts.title || 'idcard.title'))}</${h}>
        </div>
        <p class="id-card-line">${esc(t('idcard.line'))}</p>
        ${note}
        <div class="id-card-actions">
          <button type="button" class="btn btn-primary btn-lg btn-arrow id-card-start" data-id-start>${esc(t(id === 'failed' ? 'idcard.retry' : (id === 'started' ? 'idcard.continue' : 'idcard.start')))}</button>
          ${showsQr() ? `<button type="button" class="btn btn-ghost btn-lg" data-id-qr>${esc(t('idcard.qr'))}</button>` : ''}
        </div>
        <div class="id-card-qr" hidden></div>
        <p class="form-error id-card-error" role="alert"></p>
        <details class="id-card-why">
          <summary>${esc(t('idcard.whyTitle'))}</summary>
          <ul><li>${esc(t('idcard.why.safety'))}</li><li>${esc(t('idcard.why.adult'))}</li><li>${esc(t('idcard.why.name'))}</li><li>${esc(t('idcard.why.photos'))}</li></ul>
        </details>
      </section>`;
  }

  const ERRORS = {
    kyc_unavailable: 'vt.kyc.unavailable', already_verified: 'vt.kyc.already', age_final: 'ap.age.failed', email_not_verified: 'settings.mentor.emailNotVerified',
    kyc_error: 'idcard.err.partner', qr_failed: 'idcard.err.qr', too_many_requests: 'idcard.err.tooMany', not_a_mentor: 'idcard.err.notMentor'
  };
  // Why the check did not start, always in words.
  const errorText = (e) => t(ERRORS[e.code] || 'idcard.err.other');

  // The button with a QR code: asks the server, then shows the picture, or the reason and (when there is one) the partner's link to open on the phone.
  // Never an empty box. opts: { button, box, error, reload }
  async function openQr({ button, box, error, reload }) {
    button.disabled = true;
    error.textContent = '';
    try {
      const r = await WisecallAPI.apiFetch('/verification/kyc/start', { method: 'POST', body: { qr: true } });
      if (!r.qr) throw Object.assign(new Error('qr_failed'), { code: 'qr_failed', data: { url: r.url } });
      box.innerHTML = `${r.qr}<p class="hint">${esc(t('apply.id.qrHelp'))}</p><button type="button" class="btn btn-ghost" data-qr-reload>${esc(t('vt.kyc.refresh'))}</button>`; // (the SVG comes from our own server)
      box.hidden = false;
      box.querySelector('[data-qr-reload]').addEventListener('click', reload);
      button.hidden = true;
    } catch (e) {
      error.textContent = errorText(e);
      const url = e.data && e.data.url;
      if (url) {
        box.innerHTML = `<label class="id-card-link"><span>${esc(t('idcard.openOnPhone'))}</span><input type="text" readonly value="${esc(url)}"></label>`;
        box.hidden = false;
        box.querySelector('input').addEventListener('focus', (ev) => ev.target.select());
      }
      button.disabled = false;
    }
  }

  // Starts the check (to the partner's page) or shows the QR code for a phone. root: an element with a card in it.
  function wire(root) {
    root.querySelectorAll('.id-card').forEach((card) => {
      if (card.dataset.wired) return;
      card.dataset.wired = '1';
      const error = card.querySelector('.id-card-error');
      const fail = (e) => { error.textContent = errorText(e); };
      const start = card.querySelector('[data-id-start]');
      start.addEventListener('click', async () => {
        start.disabled = true;
        error.textContent = '';
        try { window.location.href = (await WisecallAPI.apiFetch('/verification/kyc/start', { method: 'POST' })).url; }
        catch (e) { fail(e); start.disabled = false; }
      });
      const qr = card.querySelector('[data-id-qr]');
      if (qr) qr.addEventListener('click', () => openQr({ button: qr, box: card.querySelector('.id-card-qr'), error, reload: () => window.location.reload() }));
    });
  }

  window.WisecallIdCard = { html, wire, ICON, showsQr, openQr, errorText };
})();
