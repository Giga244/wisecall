// Settings > Verification: a mentor's progress tracker, and the forms for each step.
// Loaded by settings.html before settings.js. The server decides every result; this page only submits.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const locale = () => (WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const fmtDay = (d) => new Date(d).toLocaleDateString(locale(), { dateStyle: 'medium' });
  const fmtSlot = (d) => new Date(d).toLocaleString(locale(), { dateStyle: 'full', timeStyle: 'short' });

  const ICON = { passed: '✓', pending: '…', failed: '!', todo: '○' };
  const BADGE = { passed: 'answered', pending: 'pending_payment', failed: 'rejected', todo: 'badge-muted' };
  // Steps whose result comes from the server or the ID provider, so their stored reason is not shown to the mentor as-is.
  const SYSTEM_STEPS = ['email', 'id_kyc', 'work_email'];
  const DOCUMENT_STEPS = ['license_document', 'role_proof', 'diploma'];
  const MAX_BYTES = 10 * 1024 * 1024;

  let root = null;
  let devWorkEmailCode = null; // development only: the server sends the code back when no email is sent
  let data = null; // { v: /verification, iv: /verification/interview, user }
  let options = {};

  const errText = (map, e, fallback) => t(map[e.code] || fallback || 'toast.error');

  // ---- One step's form ------------------------------------------------------------------------------
  function licenseForm(req, user) {
    const l = data.v.inputs.license;
    const expired = req.status === 'failed' && req.expiresAt && new Date(req.expiresAt) < new Date();
    return `
      ${l ? `<p class="muted small">${t('vt.lic.submitted').replace('{last4}', esc(l.numberEnding)).replace('{body}', esc(l.issuingBody)).replace('{date}', esc(l.validUntil))}</p>` : ''}
      ${expired ? `<p class="form-error">${t('vt.lic.expired')}</p>` : ''}
      <form class="vt-form" data-form="license" novalidate>
        <label><span>${t('vt.lic.number')}</span><input type="text" name="number" maxlength="40" autocomplete="off" required></label>
        <label><span>${t('vt.lic.body')}</span><input type="text" name="issuingBody" maxlength="120" placeholder="${esc(t('vt.lic.bodyHint'))}" required></label>
        <label><span>${t('vt.lic.holder')}</span><input type="text" name="holderName" maxlength="100" value="${esc(l ? l.holderName : user.name)}" required></label>
        <label><span>${t('vt.lic.until')}</span><input type="date" name="validUntil" value="${esc(l ? l.validUntil : '')}" required></label>
        <p class="form-error vt-error" role="alert"></p>
        <button class="btn btn-primary btn-sm" type="submit">${t('vt.lic.save')}</button>
      </form>`;
  }

  function documentForm(req) {
    const files = data.v.inputs.documents.filter((d) => d.step === req.step);
    return `
      <p class="muted small">${t('vt.doc.private')}</p>
      ${files.length ? `<ul class="vt-files">${files.map((f) => `
        <li><span>${esc(f.filename)} · ${Math.max(1, Math.round(f.size / 1024))} KB</span>
          <button type="button" class="btn btn-ghost btn-sm" data-remove="${esc(f.id)}">${t('vt.doc.remove')}</button></li>`).join('')}</ul>` : `<p class="muted small">${t('vt.doc.none')}</p>`}
      <form class="vt-form" data-form="document" data-step="${req.step}" novalidate>
        <label><span>${t('vt.doc.choose')}</span><input type="file" name="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg" required></label>
        <p class="form-error vt-error" role="alert"></p>
        <button class="btn btn-primary btn-sm" type="submit">${t('vt.doc.upload')}</button>
      </form>`;
  }

  function interviewForm() {
    const iv = data.iv;
    if (!iv.required) return '';
    if (iv.booking) {
      return `
        <p><strong>${t('vt.iv.booked').replace('{date}', esc(fmtSlot(iv.booking.startsAt)))}</strong></p>
        ${iv.booking.meetingLink
          ? `<p><a class="btn btn-primary btn-sm" href="${esc(iv.booking.meetingLink)}" target="_blank" rel="noopener noreferrer">${t('vt.iv.link')}</a></p>`
          : `<p class="muted small">${t('vt.iv.linkPending')}</p>`}
        <button type="button" class="btn btn-outline btn-sm" data-iv-cancel>${t('vt.iv.cancel')}</button>
        <p class="form-error vt-error" role="alert"></p>`;
    }
    if (iv.blocked) return `<p class="muted small">${t('vt.iv.blocked')}</p>`;
    const failed = iv.result && iv.result.result === 'failed';
    return `
      ${failed ? `<p class="form-error">${t('vt.iv.failed')}${iv.result.reason ? ' ' + esc(iv.result.reason) : ''}</p>` : ''}
      ${iv.slots.length ? `
        <p class="muted small">${t('vt.iv.pick').replace('{minutes}', iv.slots[0].minutes)}</p>
        <ul class="vt-slots">${iv.slots.map((s) => `<li><span>${esc(fmtSlot(s.startsAt))}</span><button type="button" class="btn btn-outline btn-sm" data-book="${esc(s.id)}">${t('vt.iv.book')}</button></li>`).join('')}</ul>
        <p class="form-error vt-error" role="alert"></p>` : `<p class="muted small">${t('vt.iv.none')}</p>`}`;
  }

  function workEmailForm(req) {
    const domain = data.v.inputs.workEmailDomain;
    const waiting = req.status === 'pending' && domain;
    return `
      <form class="vt-form" data-form="workEmailSend" novalidate>
        <label><span>${t('vt.we.label')}</span><input type="email" name="email" maxlength="254" autocomplete="email" placeholder="you@company.com" required></label>
        <p class="form-error vt-error" role="alert"></p>
        <button class="btn btn-outline btn-sm" type="submit">${t('vt.we.send')}</button>
      </form>
      ${waiting ? `
        <form class="vt-form" data-form="workEmailConfirm" novalidate>
          <p class="muted small">${t('vt.we.sent').replace('{domain}', esc(domain))}</p>
          ${devWorkEmailCode ? `<div class="hero-cta-banner dev-code" role="status">${esc(t('vt.we.devCode').replace('{code}', devWorkEmailCode))}</div>` : ''}
          <label><span>${t('vt.we.code')}</span><input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
          <p class="form-error vt-error" role="alert"></p>
          <button class="btn btn-primary btn-sm" type="submit">${t('vt.we.confirm')}</button>
        </form>` : ''}`;
  }

  const singleField = (form, label, name, extra, save, hint) => `
    <form class="vt-form" data-form="${form}" novalidate>
      <label><span>${t(label)}</span><input name="${name}" ${extra} required>${hint ? `<span class="hint">${t(hint)}</span>` : ''}</label>
      <p class="form-error vt-error" role="alert"></p>
      <button class="btn btn-primary btn-sm" type="submit">${t(save)}</button>
    </form>`;

  function kycBlock(req) {
    const state = data.v.kycState;
    const returned = new URLSearchParams(window.location.search).get('kyc') === 'returned';
    if (req.status === 'passed') return '';
    // Before launch the site can run without the ID-check provider: nothing to start yet, and the rest of the application can be filled in.
    if (!WisecallI18n.idChecksOpen()) return `<p class="vt-soon" role="status"><strong>${t('vt.kyc.soon')}</strong> ${t('vt.kyc.soonBody')}</p>`;
    let note = '';
    let label = 'vt.kyc.start';
    if (req.status === 'failed') { note = `<p class="form-error">${t(state === 'expired' ? 'vt.kyc.expired' : 'vt.kyc.failed')}</p>`; label = 'vt.kyc.retry'; }
    else if (state === 'in_review') note = `<p class="muted small">${t('vt.kyc.inReview')}</p>`;
    else if (state === 'started') { note = `<p class="muted small">${t(returned ? 'vt.kyc.returned' : 'vt.kyc.started')}</p>`; label = 'vt.kyc.continue'; }
    return `
      ${note}
      <div class="vt-buttons">
        ${state === 'in_review' ? '' : `<button type="button" class="btn btn-primary btn-sm" data-kyc-start>${t(label)}</button>`}
        ${req.status === 'pending' ? `<button type="button" class="btn btn-outline btn-sm" data-reload>${t('vt.kyc.refresh')}</button>` : ''}
      </div>
      <p class="form-error vt-error" role="alert"></p>`;
  }

  // The action area of one step (or '' when there is nothing for the mentor to do).
  function actionFor(req, user) {
    switch (req.step) {
      case 'id_kyc': return kycBlock(req);
      case 'name_match': return req.status === 'pending' ? `<p class="muted small">${t('vt.name.waiting')}</p>` : '';
      case 'sample_answer':
      case 'proof_link': return `<button type="button" class="btn btn-outline btn-sm" data-goto="mentor">${t('vt.edit.mentorTab')}</button>`;
      case 'license': return licenseForm(req, user);
      case 'license_document':
      case 'role_proof':
      case 'diploma': return documentForm(req);
      case 'video_interview': return interviewForm();
      case 'company_id': return singleField('companyId', 'vt.co.label', 'companyId', 'type="text" inputmode="numeric" maxlength="13" autocomplete="off"', 'vt.co.save', 'vt.co.hint');
      case 'work_email': return workEmailForm(req);
      case 'portfolio': return singleField('portfolio', 'vt.pf.label', 'url', 'type="url" maxlength="500" placeholder="https://"', 'vt.pf.save');
      default: return '';
    }
  }

  function stepHtml(req, user) {
    const status = req.status || 'todo';
    const showReason = status === 'failed' && req.reason && !SYSTEM_STEPS.includes(req.step) && !(req.step === 'license' && req.expiresAt && new Date(req.expiresAt) < new Date());
    const action = status === 'passed' && !['license', 'work_email', 'portfolio'].includes(req.step) ? '' : actionFor(req, user);
    const open = (status === 'todo' || status === 'failed') && action;
    // (while ID checks are closed there is nothing to do yet: the note stands on its own, not under "Do this step")
    const waitingForIdChecks = req.step === 'id_kyc' && status !== 'passed' && !WisecallI18n.idChecksOpen();
    if (waitingForIdChecks) return `
      <li class="vt-step vt-${status}" data-step="${req.step}">
        <span class="vt-icon" aria-hidden="true">${ICON[status]}</span>
        <div class="vt-main">
          <div class="vt-head">
            <h3>${t('verify.step.' + req.step)}</h3>
            <span class="badge badge-${BADGE[status]}">${t('verify.status.' + status)}</span>
          </div>
          <p class="muted small">${t('vt.help.' + req.step)}</p>
          ${action}
        </div>
      </li>`;
    return `
      <li class="vt-step vt-${status}" data-step="${req.step}">
        <span class="vt-icon" aria-hidden="true">${ICON[status]}</span>
        <div class="vt-main">
          <div class="vt-head">
            <h3>${t('verify.step.' + req.step)}</h3>
            <span class="badge badge-${BADGE[status]}">${t('verify.status.' + status)}</span>
          </div>
          <p class="muted small">${t('vt.help.' + req.step)}</p>
          ${showReason ? `<p class="form-error vt-reason"><strong>${t('vt.reason')}</strong> ${esc(req.reason)}</p>` : ''}
          ${action ? `
            <details class="vt-action"${open ? ' open' : ''}>
              <summary>${t(status === 'todo' || status === 'failed' ? 'vt.do' : 'vt.update')}</summary>
              <div class="vt-action-body">${action}</div>
            </details>` : ''}
        </div>
      </li>`;
  }

  // ---- Whole tab ----------------------------------------------------------------------------------------
  function render() {
    const v = data.v;
    const user = data.user;
    const reqs = v.requirements;
    const total = reqs.length;
    const done = reqs.filter((r) => (r.type === 'step' ? r.status === 'passed' : r.satisfied)).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    let headline;
    if (v.status === 'verified') headline = user.hasPayoutDetails ? (WisecallI18n.launchMode() === 'prelaunch' ? 'vt.status.verifiedPrelaunch' : 'vt.status.verifiedListed') : 'vt.status.verifiedNoPayout';
    else if (v.status === 'suspended') headline = 'vt.status.suspended';
    else if (v.status === 'rejected') headline = 'vt.status.rejected';
    else if (v.ready) headline = 'vt.status.pendingReady';
    else headline = 'vt.status.pending';
    const tone = v.status === 'verified' ? 'answered' : (v.status === 'rejected' || v.status === 'suspended' ? 'rejected' : 'pending_payment');

    const list = reqs.map((r) => {
      if (r.type === 'step') return stepHtml(r, user);
      return `
        <li class="vt-group ${r.satisfied ? 'vt-passed' : ''}">
          <p class="vt-group-title"><strong>${t('vt.anyOf')}</strong></p>
          <ul class="vt-steps">${r.options.map((o) => stepHtml(o, user)).join('')}</ul>
        </li>`;
    }).join('');

    root.innerHTML = `
      <div class="settings-card vt-summary">
        <div class="vt-summary-head">
          <h2>${t('vt.title')}</h2>
          <span class="badge badge-${tone}">${t(headline)}</span>
        </div>
        <p class="muted">${t('vt.intro')}</p>
        <p class="muted small">${t('vt.level.' + v.level)}</p>
        ${(v.status === 'rejected' || v.status === 'suspended') && v.note ?`<p class="form-error">${t('vt.reason')} ${esc(v.note)}</p>` : ''}
        <div class="vt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="${esc(t('vt.progress').replace('{done}', done).replace('{total}', total))}"><span style="width:${pct}%"></span></div>
        <p class="small"><strong>${t('vt.progress').replace('{done}', done).replace('{total}', total)}</strong></p>
        ${v.status === 'verified' && !user.hasPayoutDetails ? `<p><button type="button" class="btn btn-primary btn-sm" data-goto="payouts">${t('vt.addPayout')}</button></p>` : ''}
        ${v.status !== 'verified' ? `<p class="muted small">${t('vt.gate')}</p>` : ''}
      </div>
      <ol class="vt-steps vt-main-list">${list}</ol>
      <details class="settings-card vt-why">
        <summary><strong>${t('vt.why.title')}</strong></summary>
        <ul>
          <li>${t('vt.why.1')}</li>
          <li>${t('vt.why.2')}</li>
          <li>${t('vt.why.3')}</li>
          <li>${t('vt.why.4')}</li>
        </ul>
        <p class="small"><a href="/privacy.html">${t('vt.why.privacy')}</a></p>
      </details>`;
    wire();
  }

  // ---- Actions --------------------------------------------------------------------------------------------
  const formError = (form, text) => { const el = form.querySelector('.vt-error'); if (el) el.textContent = text || ''; };

  const LICENSE_ERR = { invalid_license_number: 'vt.lic.err.number', invalid_issuing_body: 'vt.lic.err.body', invalid_holder_name: 'vt.lic.err.holder', invalid_valid_until: 'vt.lic.err.until' };
  const DOC_ERR = { unsupported_file_type: 'vt.doc.err.type', file_too_large: 'vt.doc.err.size', too_many_files: 'vt.doc.err.many', empty_file: 'vt.doc.err.empty' };
  const EMAIL_ERR = { free_email_domain: 'vt.we.free', invalid_email: 'vt.we.invalid', invalid_code: 'vt.we.wrongCode', expired: 'vt.we.expired', no_pending_code: 'vt.we.expired' };

  const HANDLERS = {
    license: (f) => WisecallAPI.apiFetch('/verification/license', { method: 'POST', body: { number: f.number.value, issuingBody: f.issuingBody.value, holderName: f.holderName.value, validUntil: f.validUntil.value } }),
    portfolio: (f) => WisecallAPI.apiFetch('/verification/portfolio', { method: 'POST', body: { url: f.url.value.trim() } }),
    companyId: (f) => WisecallAPI.apiFetch('/verification/company-id', { method: 'POST', body: { companyId: f.companyId.value } }),
    workEmailSend: async (f) => {
      const r = await WisecallAPI.apiFetch('/verification/work-email', { method: 'POST', body: { email: f.email.value.trim() } });
      devWorkEmailCode = r.devCode || null; // shown under the code box (never sent in production)
      return r;
    },
    workEmailConfirm: async (f) => { const r = await WisecallAPI.apiFetch('/verification/work-email/verify', { method: 'POST', body: { code: f.code.value.trim() } }); devWorkEmailCode = null; return r; },
    document: (f) => {
      const file = f.file.files[0];
      if (!file) throw Object.assign(new Error('empty_file'), { code: 'empty_file' });
      if (file.size > MAX_BYTES) throw Object.assign(new Error('file_too_large'), { code: 'file_too_large' });
      if (!/\.(pdf|jpe?g)$/i.test(file.name)) throw Object.assign(new Error('unsupported_file_type'), { code: 'unsupported_file_type' });
      return WisecallAPI.uploadFile(`/verification/documents/${f.dataset.step}`, file);
    }
  };
  const ERRORS = {
    license: LICENSE_ERR, document: DOC_ERR, workEmailSend: EMAIL_ERR, workEmailConfirm: EMAIL_ERR,
    portfolio: { invalid_url: 'vt.pf.err' }, companyId: { invalid_company_id: 'vt.co.err' }
  };

  function wire() {
    root.querySelectorAll('form.vt-form').forEach((form) => {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const kind = form.dataset.form;
        const button = form.querySelector('button[type="submit"]');
        formError(form, '');
        if (!form.checkValidity()) { formError(form, t('vt.fillIn')); return; }
        button.disabled = true;
        try {
          await HANDLERS[kind](form);
          WisecallNav.showToast(t('toast.saved'));
          await reload();
        } catch (e) {
          formError(form, errText(ERRORS[kind] || {}, e));
          button.disabled = false;
        }
      });
    });

    root.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await WisecallAPI.apiFetch(`/verification/documents/${btn.dataset.remove}`, { method: 'DELETE' }); await reload(); }
      catch (e) { WisecallNav.showToast(t('toast.error')); btn.disabled = false; }
    }));

    root.querySelectorAll('[data-book]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await WisecallAPI.apiFetch('/verification/interview/book', { method: 'POST', body: { slotId: btn.dataset.book } }); WisecallNav.showToast(t('toast.saved')); await reload(); }
      catch (e) {
        const el = btn.closest('.vt-action-body').querySelector('.vt-error');
        if (el) el.textContent = errText({ slot_unavailable: 'vt.iv.taken', id_check_first: 'vt.iv.blocked', already_booked: 'vt.iv.err.already' }, e);
        if (e.code === 'slot_unavailable') await reload(); else btn.disabled = false;
      }
    }));

    const cancel = root.querySelector('[data-iv-cancel]');
    if (cancel) cancel.addEventListener('click', async () => {
      cancel.disabled = true;
      try { await WisecallAPI.apiFetch('/verification/interview/cancel', { method: 'POST' }); await reload(); }
      catch (e) {
        const el = cancel.parentElement.querySelector('.vt-error');
        if (el) el.textContent = errText({ too_late: 'vt.iv.tooLate' }, e);
        cancel.disabled = false;
      }
    });

    const start = root.querySelector('[data-kyc-start]');
    if (start) start.addEventListener('click', async () => {
      start.disabled = true;
      try {
        const r = await WisecallAPI.apiFetch('/verification/kyc/start', { method: 'POST' });
        window.location.href = r.url; // the identity partner's own page
      } catch (e) {
        const el = start.closest('.vt-action-body').querySelector('.vt-error');
        if (el) el.textContent = errText({ kyc_unavailable: 'vt.kyc.unavailable', already_verified: 'vt.kyc.already' }, e);
        start.disabled = false;
      }
    });

    root.querySelectorAll('[data-reload]').forEach((btn) => btn.addEventListener('click', () => reload()));
    root.querySelectorAll('[data-goto]').forEach((btn) => btn.addEventListener('click', () => options.goto && options.goto(btn.dataset.goto)));
  }

  // ---- Loading ----------------------------------------------------------------------------------------------
  async function reload() {
    const open = Array.from(root.querySelectorAll('.vt-step')).filter((el) => el.querySelector('details.vt-action[open]')).map((el) => el.dataset.step);
    try {
      const [v, iv] = await Promise.all([WisecallAPI.apiFetch('/verification'), WisecallAPI.apiFetch('/verification/interview')]);
      data = { v, iv, user: data ? data.user : options.user };
    } catch (e) {
      root.innerHTML = `<p class="muted">${t('toast.error')}</p>`;
      return;
    }
    render();
    document.dispatchEvent(new CustomEvent('wisecall:verification-changed', { detail: data.v }));
    // Keep the sections the mentor had open, open.
    open.forEach((s) => { const d = root.querySelector(`.vt-step[data-step="${s}"] details.vt-action`); if (d) d.open = true; });
  }

  // container: where to draw. opts: { user, goto(tabName) }
  async function init(container, opts) {
    root = container;
    options = opts || {};
    data = { v: null, iv: null, user: options.user };
    root.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    await reload();
  }

  window.SettingsVerification = { init, reload: () => (root ? reload() : null) };
})();
