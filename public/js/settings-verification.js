// Settings > Verification, for an APPROVED mentor (docs/CLAUDE-CODE-ONE-APPLY-PATH.md): what stays a setting once the application is
// approved. Where they stand, the ID check (and taking it again if a step failed), the licence in a regulated field (a new one when it
// expires), the optional work-email badge, and "Edit my application", which opens /apply.html. The application itself lives only at
// /apply.html: someone applying never sees this tab (Settings shows them a card with one button to it).
// Loaded by settings.html before settings.js. The server decides every result; this page only submits and explains.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));

  const BADGE = { done: 'answered', waiting: 'pending_payment', attention: 'rejected', todo: 'badge-muted' };
  const MAX_BYTES = 10 * 1024 * 1024;

  let root = null;
  let devWorkEmailCode = null; // development only: the server sends the code back when no email is sent
  let data = null; // { v: /verification, user }
  let options = {};

  const errText = (map, e, fallback) => t(map[e.code] || fallback || 'toast.error');
  // Right after an ID check the age and the names are compared a moment later: the page looks again until they are (at most a minute).
  let recheckTimer = null;
  let rechecks = 0;
  const statusOf = (step) => { const r = data.v.requirements.find((x) => x.step === step); return r ? r.status : 'todo'; };
  const req = (step) => data.v.requirements.find((x) => x.step === step) || { step, status: 'todo' };

  // ---- The ID check ------------------------------------------------------------------------------------------------------
  function identityState() {
    const s = ['email', 'id_kyc', 'age', 'name_match'].map(statusOf);
    if (s.every((x) => x === 'passed')) return 'done';
    if (s.includes('failed')) return 'attention';
    return 'waiting';
  }

  function kycBlock() {
    const r = req('id_kyc');
    const state = data.v.kycState;
    const returned = new URLSearchParams(window.location.search).get('kyc') === 'returned';
    if (r.status === 'passed') return `<p class="ap-line ap-ok">✓ ${t('ap.id.passed')}</p>`;
    // Before launch the site can run without the ID-check provider: nothing to start yet.
    if (!WisecallI18n.idChecksOpen()) return `<p class="vt-soon" role="status"><strong>${t('vt.kyc.soon')}</strong> ${t('vt.kyc.soonBody')}</p>`;
    let note = '';
    let label = 'vt.kyc.start';
    if (r.status === 'failed') { note = `<p class="form-error">${t(state === 'expired' ? 'vt.kyc.expired' : 'vt.kyc.failed')}</p>`; label = 'vt.kyc.retry'; }
    else if (state === 'in_review') note = `<p class="muted small">${t('vt.kyc.inReview')}</p>`;
    else if (state === 'started') { note = `<p class="muted small">${t(returned ? 'vt.kyc.returned' : 'vt.kyc.started')}</p>`; label = 'vt.kyc.continue'; }
    return `
      ${note}
      <div class="vt-buttons">
        ${state === 'in_review' ? '' : `<button type="button" class="btn btn-primary btn-sm" data-kyc-start>${t(label)}</button>`}
        ${r.status === 'pending' ? `<button type="button" class="btn btn-outline btn-sm" data-reload>${t('vt.kyc.refresh')}</button>` : ''}
      </div>
      <p class="form-error vt-error" role="alert"></p>`;
  }

  function identitySection() {
    const age = statusOf('age');
    const names = statusOf('name_match');
    const lines = [];
    if (statusOf('id_kyc') === 'passed') {
      if (age === 'passed') lines.push(`<p class="ap-line ap-ok">✓ ${t('ap.age.passed')}</p>`);
      else if (age === 'failed') lines.push(`<p class="form-error">${t('ap.age.failed')}</p>`);
      else lines.push(`<p class="muted small"${age === 'todo' ? ' data-still-checking' : ''}>${t('ap.age.pending')}</p>`);
      if (names === 'passed') lines.push(`<p class="ap-line ap-ok">✓ ${t('ap.name.passed')}</p>`);
      // (not compared yet: never say "doesn't match" before it was checked)
      else if (names === 'todo') lines.push(`<p class="muted small" data-still-checking>${t('ap.name.checking')}</p>`);
      else lines.push(`<div class="ap-note"><p>${t('ap.name.pending')}</p><button type="button" class="btn btn-outline btn-sm" data-goto="profile">${t('ap.name.fix')}</button></div>`);
    }
    const state = identityState();
    return `
      <section class="settings-card ap-section" id="ap-identity" aria-labelledby="ap-identity-h">
        <div class="vt-summary-head">
          <h3 id="ap-identity-h">${t('ap.id.title')}</h3>
          <span class="badge badge-${BADGE[state]}">${t(state === 'attention' ? 'ap.next.identity.attention' : 'ap.state.' + state)}</span>
        </div>
        <p class="muted small">${t('ap.id.help')}</p>
        ${kycBlock()}
        ${lines.join('')}
      </section>`;
  }

  // ---- The licence (regulated fields): a new one when it expires or was not accepted -----------------------------------------
  function licenceSection() {
    if (!data.v.regulated) return '';
    const l = data.v.inputs.license;
    const r = req('license');
    const needsDoc = data.v.requirements.some((x) => x.step === 'license_document');
    const expired = r.status === 'failed' && r.expiresAt && new Date(r.expiresAt) < new Date();
    const docs = data.v.inputs.documents.filter((d) => d.step === 'license_document');
    return `
      <section class="settings-card ap-section" id="ap-licence" aria-labelledby="ap-licence-h">
        <h3 id="ap-licence-h">${t('ap.lic.title')}</h3>
        <p class="muted small">${fill('ap.lic.help', { niche: t('niche.' + data.v.niche) })}</p>
        ${l ? `<p class="muted small">${fill('vt.lic.submitted', { last4: esc(l.numberEnding), body: esc(l.issuingBody), date: esc(l.validUntil) })} <span class="badge badge-${BADGE[r.status === 'passed' ? 'done' : (r.status === 'failed' ? 'attention' : 'waiting')]}">${t('verify.status.' + r.status)}</span></p>` : ''}
        ${expired ? `<p class="form-error">${t('vt.lic.expired')}</p>` : ''}
        ${r.status === 'failed' && r.reason && !expired ? `<p class="form-error vt-reason"><strong>${t('vt.reason')}</strong> ${esc(r.reason)}</p>` : ''}
        ${!l || r.status === 'failed' || expired ? `
        <form class="vt-form" data-form="license" novalidate>
          <label><span>${t('vt.lic.number')}</span><input type="text" name="number" maxlength="40" autocomplete="off" required></label>
          <label><span>${t('vt.lic.body')}</span><input type="text" name="issuingBody" maxlength="120" placeholder="${esc(t('vt.lic.bodyHint'))}" required></label>
          <label><span>${t('vt.lic.holder')}</span><input type="text" name="holderName" maxlength="100" value="${esc(l ? l.holderName : data.user.name)}" required></label>
          <label><span>${t('vt.lic.until')}</span><input type="date" name="validUntil" value="${esc(l ? l.validUntil : '')}" required></label>
          <p class="form-error vt-error" role="alert"></p>
          <button class="btn btn-primary btn-sm" type="submit">${t('vt.lic.save')}</button>
        </form>` : ''}
        ${needsDoc ? `
          <p class="muted small">${t('ap.lic.docHelp')} ${t('vt.doc.private')}</p>
          ${docs.length ? `<ul class="vt-files">${docs.map((f) => `
            <li><span>${esc(f.filename)} · ${Math.max(1, Math.round(f.size / 1024))} KB</span>
              <button type="button" class="btn btn-ghost btn-sm" data-remove="${esc(f.id)}">${t('vt.doc.remove')}</button></li>`).join('')}</ul>` : ''}
          <form class="vt-form" data-form="document" data-step="license_document" novalidate>
            <label><span>${t('vt.doc.choose')}</span><input type="file" name="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg" required></label>
            <p class="form-error vt-error" role="alert"></p>
            <button class="btn btn-primary btn-sm" type="submit">${t('vt.doc.upload')}</button>
          </form>` : ''}
      </section>`;
  }

  // ---- The optional work-email badge -----------------------------------------------------------------------------------------
  function workEmailSection() {
    const r = (data.v.optional || []).find((o) => o.step === 'work_email') || { status: 'todo' };
    const domain = data.v.inputs.workEmailDomain;
    if (r.status === 'passed') return `<section class="settings-card ap-section"><h3>${t('ap.opt.title')}</h3><p class="ap-line ap-ok">✓ ${fill('ap.opt.done', { domain: esc(domain || '') })}</p></section>`;
    const waiting = r.status === 'pending' && domain;
    return `
      <section class="settings-card ap-section" id="ap-work-email" aria-labelledby="ap-work-email-h">
        <h3 id="ap-work-email-h">${t('ap.opt.title')}</h3>
        <p class="muted small">${t('ap.opt.help')}</p>
        <form class="vt-form" data-form="workEmailSend" novalidate>
          <label><span>${t('vt.we.label')}</span><input type="email" name="email" maxlength="254" autocomplete="email" placeholder="you@company.com" required></label>
          <p class="form-error vt-error" role="alert"></p>
          <button class="btn btn-outline btn-sm" type="submit">${t('vt.we.send')}</button>
        </form>
        ${waiting ? `
          <form class="vt-form" data-form="workEmailConfirm" novalidate>
            <p class="muted small">${fill('vt.we.sent', { domain: esc(domain) })}</p>
            ${devWorkEmailCode ? `<div class="hero-cta-banner dev-code" role="status">${esc(fill('vt.we.devCode', { code: devWorkEmailCode }))}</div>` : ''}
            <label><span>${t('vt.we.code')}</span><input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
            <p class="form-error vt-error" role="alert"></p>
            <button class="btn btn-primary btn-sm" type="submit">${t('vt.we.confirm')}</button>
          </form>` : ''}
      </section>`;
  }

  // ---- The application: changed at /apply.html, after "Edit my application" ---------------------------------------------------
  function applicationSection() {
    if (data.v.status === 'suspended') return '';
    return `
      <section class="settings-card ap-section" id="ap-application" aria-labelledby="ap-application-h">
        <h3 id="ap-application-h">${t('settings.app.approvedTitle')}</h3>
        <p class="muted small">${t('settings.app.approvedText')}</p>
        <button type="button" class="btn btn-outline btn-sm" data-edit data-confirm="1">${t('ap.edit')}</button>
        <p class="form-error vt-error" role="alert"></p>
      </section>`;
  }

  // ---- Whole tab --------------------------------------------------------------------------------------------------------------
  // The headline and its colour come from v.state (a failed required step is never "verified").
  function headline() {
    const v = data.v;
    if (v.state === 'verified') return !data.user.needsPayout ? (WisecallI18n.launchMode() === 'prelaunch' ? 'vt.status.verifiedPrelaunch' : 'vt.status.verifiedListed') : 'vt.status.verifiedNoPayout';
    if (v.state === 'needs_attention') return 'vt.status.needsAttention';
    if (v.state === 'suspended') return 'vt.status.suspended';
    return 'ap.status.inReview';
  }

  function render() {
    const v = data.v;
    const tone = v.state === 'verified' ? 'answered' : (['suspended', 'needs_attention'].includes(v.state) ? 'rejected' : 'pending_payment');
    root.innerHTML = `
      <div class="settings-card vt-summary">
        <div class="vt-summary-head">
          <h2>${t('settings.tab.verification')}</h2>
          <span class="badge badge-${tone}">${t(headline())}</span>
        </div>
        ${v.state === 'verified' && data.user.needsPayout ? `<p class="muted small">${t('settings.payouts.needForListing')} <button type="button" class="linklike" data-goto="payouts">${t('vt.addPayout')}</button></p>` : ''}
      </div>
      ${identitySection()}
      ${licenceSection()}
      ${workEmailSection()}
      ${applicationSection()}
      <details class="settings-card vt-why">
        <summary><strong>${t('vt.why.title')}</strong></summary>
        <ul>
          <li>${t('vt.why.1')}</li>
          <li>${t('vt.why.2')}</li>
          <li>${t('ap.why.ai')}</li>
          <li>${t('vt.why.3')}</li>
          <li>${t('vt.why.4')}</li>
        </ul>
        <p class="small"><a href="/privacy.html">${t('vt.why.privacy')}</a></p>
      </details>`;
    wire();
  }

  // ---- Actions ----------------------------------------------------------------------------------------------------------------
  const formError = (form, text) => { const el = form.querySelector('.vt-error'); if (el) el.textContent = text || ''; };

  const LICENSE_ERR = { invalid_license_number: 'vt.lic.err.number', invalid_issuing_body: 'vt.lic.err.body', invalid_holder_name: 'vt.lic.err.holder', invalid_valid_until: 'vt.lic.err.until' };
  const DOC_ERR = { unsupported_file_type: 'vt.doc.err.type', file_too_large: 'vt.doc.err.size', too_many_files: 'vt.doc.err.many', empty_file: 'vt.doc.err.empty', application_locked: 'ap.err.application_locked' };
  const EMAIL_ERR = { free_email_domain: 'vt.we.free', invalid_email: 'vt.we.invalid', invalid_code: 'vt.we.wrongCode', expired: 'vt.we.expired', no_pending_code: 'vt.we.expired', too_many_attempts: 'vt.we.tooManyAttempts' };

  function uploadFile(step, file) {
    if (!file) throw Object.assign(new Error('empty_file'), { code: 'empty_file' });
    if (file.size > MAX_BYTES) throw Object.assign(new Error('file_too_large'), { code: 'file_too_large' });
    if (!/\.(pdf|jpe?g)$/i.test(file.name)) throw Object.assign(new Error('unsupported_file_type'), { code: 'unsupported_file_type' });
    return WisecallAPI.uploadFile(`/verification/documents/${step}`, file);
  }

  const HANDLERS = {
    license: (f) => WisecallAPI.apiFetch('/verification/license', { method: 'POST', body: { number: f.number.value, issuingBody: f.issuingBody.value, holderName: f.holderName.value, validUntil: f.validUntil.value } }),
    workEmailSend: async (f) => {
      const r = await WisecallAPI.apiFetch('/verification/work-email', { method: 'POST', body: { email: f.email.value.trim() } });
      devWorkEmailCode = r.devCode || null; // shown under the code box (never sent in production)
      return r;
    },
    workEmailConfirm: async (f) => { const r = await WisecallAPI.apiFetch('/verification/work-email/verify', { method: 'POST', body: { code: f.code.value.trim() } }); devWorkEmailCode = null; return r; },
    document: (f) => uploadFile(f.dataset.step, f.file.files[0])
  };
  const ERRORS = { license: LICENSE_ERR, document: DOC_ERR, workEmailSend: EMAIL_ERR, workEmailConfirm: EMAIL_ERR };

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

    // "Edit my application": an approved mentor leaves Browse experts until the changed application is approved again, so they are
    // asked first; then the application opens at /apply.html.
    const edit = root.querySelector('[data-edit]');
    if (edit) edit.addEventListener('click', async () => {
      if (edit.dataset.confirm && !(await WisecallDialog.confirm({ message: t('ap.edit.confirm'), confirmText: t('ap.edit.button') }))) return;
      edit.disabled = true;
      try { await WisecallAPI.apiFetch('/verification/edit', { method: 'POST' }); window.location.href = '/apply.html'; }
      catch (e) { WisecallNav.showToast(t('toast.error')); edit.disabled = false; }
    });

    const start = root.querySelector('[data-kyc-start]');
    if (start) start.addEventListener('click', async () => {
      start.disabled = true;
      try {
        const r = await WisecallAPI.apiFetch('/verification/kyc/start', { method: 'POST' });
        window.location.href = r.url; // the identity partner's own page
      } catch (e) {
        const el = start.parentElement.parentElement.querySelector('.vt-error');
        if (el) el.textContent = errText({ kyc_unavailable: 'vt.kyc.unavailable', already_verified: 'vt.kyc.already', age_final: 'ap.age.failed', email_not_verified: 'settings.mentor.emailNotVerified' }, e);
        start.disabled = false;
      }
    });

    root.querySelectorAll('[data-reload]').forEach((btn) => btn.addEventListener('click', () => reload()));
    root.querySelectorAll('[data-goto]').forEach((btn) => btn.addEventListener('click', () => options.goto && options.goto(btn.dataset.goto)));
    clearTimeout(recheckTimer);
    if (!root.querySelector('[data-still-checking]')) rechecks = 0;
    else if (rechecks < 30) recheckTimer = setTimeout(() => { rechecks += 1; reload(); }, 2000);
  }

  // ---- Loading ----------------------------------------------------------------------------------------------------------------
  async function reload() {
    try {
      data = { v: await WisecallAPI.apiFetch('/verification'), user: data ? data.user : options.user };
    } catch (e) {
      root.innerHTML = `<p class="muted">${t('toast.error')}</p>`;
      return;
    }
    render();
  }

  // container: where to draw. opts: { user, goto(tabName) }
  async function init(container, opts) {
    root = container;
    options = opts || {};
    data = { v: null, user: options.user };
    root.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    await reload();
  }

  window.SettingsVerification = { init, reload: () => (root ? reload() : null) };
})();
