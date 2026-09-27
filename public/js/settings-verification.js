// Settings > Verification: the mentor application in three steps, Identity -> Experience -> Review.
// Loaded by settings.html before settings.js. The server decides every result; this page only submits and explains.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const locale = () => (WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const fmtDay = (d) => new Date(d).toLocaleDateString(locale(), { dateStyle: 'medium' });
  const fmtSlot = (d) => new Date(d).toLocaleString(locale(), { dateStyle: 'full', timeStyle: 'short' });
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const chars = (s) => [...String(s || '').trim().replace(/\s+/g, ' ')].length;

  const BADGE = { done: 'answered', waiting: 'pending_payment', attention: 'rejected', todo: 'badge-muted' };
  const MAX_BYTES = 10 * 1024 * 1024;

  let root = null;
  let devWorkEmailCode = null; // development only: the server sends the code back when no email is sent
  let data = null; // { v: /verification, iv: /verification/interview, user }
  let options = {};

  const errText = (map, e, fallback) => t(map[e.code] || fallback || 'toast.error');
  const statusOf = (step) => { const r = data.v.requirements.find((x) => x.step === step); return r ? r.status : 'todo'; };
  const req = (step) => data.v.requirements.find((x) => x.step === step) || { step, status: 'todo' };

  // ---- Where each of the three steps stands ------------------------------------------------------------------------------
  function identityState() {
    const s = ['email', 'id_kyc', 'age', 'name_match'].map(statusOf);
    if (s.every((x) => x === 'passed')) return 'done';
    if (s.includes('failed')) return 'attention';
    if (statusOf('id_kyc') === 'passed' || statusOf('id_kyc') === 'pending') return 'waiting';
    return 'todo';
  }
  function experienceState() {
    const a = data.v.application;
    const exp = statusOf('experience');
    if (exp === 'passed' && a.locked) return 'done';
    if (exp === 'failed' && !a.locked) return 'attention';
    if (a.locked) return 'done'; // submitted: the form is finished, the review is step 3
    return 'todo';
  }
  function reviewState() {
    const stage = data.v.application.stage;
    if (stage === 'approved') return 'done';
    if (stage === 'rejected' || stage === 'suspended' || stage === 'needs_attention') return 'attention';
    if (stage === 'not_submitted') return 'todo';
    return 'waiting';
  }

  function stepper() {
    const items = [['identity', identityState()], ['experience', experienceState()], ['review', reviewState()]];
    const done = items.filter(([, s]) => s === 'done').length;
    return `
      <ol class="ap-stepper" aria-label="${esc(t('ap.progress'))}">
        ${items.map(([key, state], i) => `
          <li class="ap-stepper-item ap-${state}">
            <a href="#ap-${key}" class="ap-stepper-link">
              <span class="ap-stepper-num" aria-hidden="true">${state === 'done' ? '✓' : i + 1}</span>
              <span class="ap-stepper-text"><strong>${t('ap.step.' + key)}</strong><span class="small">${t('ap.state.' + state)}</span></span>
            </a>
          </li>`).join('')}
      </ol>
      <p class="sr-only" role="status">${esc(fill('ap.progressText', { done, total: 3 }))}</p>`;
  }

  // ---- Step 1: Identity ------------------------------------------------------------------------------------------------------
  function kycBlock() {
    const r = req('id_kyc');
    const state = data.v.kycState;
    const returned = new URLSearchParams(window.location.search).get('kyc') === 'returned';
    if (r.status === 'passed') return `<p class="ap-line ap-ok">✓ ${t('ap.id.passed')}</p>`;
    // Before launch the site can run without the ID-check provider: nothing to start yet, and the rest can be filled in.
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
    const email = statusOf('email');
    const lines = [];
    if (email !== 'passed') lines.push(`<p class="ap-line">${t('ap.missing.email')}</p>`);
    if (statusOf('id_kyc') === 'passed') {
      if (age === 'passed') lines.push(`<p class="ap-line ap-ok">✓ ${t('ap.age.passed')}</p>`);
      else if (age === 'failed') lines.push(`<p class="form-error">${t('ap.age.failed')}</p>`);
      else lines.push(`<p class="muted small">${t('ap.age.pending')}</p>`);
      if (names === 'passed') lines.push(`<p class="ap-line ap-ok">✓ ${t('ap.name.passed')}</p>`);
      else lines.push(`<div class="ap-note"><p>${t('ap.name.pending')}</p><button type="button" class="btn btn-outline btn-sm" data-goto="profile">${t('ap.name.fix')}</button></div>`);
    }
    const state = identityState();
    return `
      <section class="settings-card ap-section" id="ap-identity" aria-labelledby="ap-identity-h">
        <div class="vt-summary-head">
          <h3 id="ap-identity-h">${t('ap.id.title')}</h3>
          <span class="badge badge-${BADGE[state]}">${t('ap.state.' + state)}</span>
        </div>
        <p class="muted small">${t('ap.id.help')}</p>
        ${kycBlock()}
        ${lines.join('')}
      </section>`;
  }

  // ---- Step 2: Experience -------------------------------------------------------------------------------------------------------
  const evidenceKinds = () => data.v.evidenceKinds.filter((k) => k !== 'diploma');

  function evidenceList(editable) {
    const list = data.v.application.evidence;
    if (!list.length) return `<p class="muted small">${t('ap.ev.none')}</p>`;
    const stateBadge = { verified: 'answered', team: 'paid', unchecked: 'badge-muted', unclear: 'pending_payment', problem: 'rejected' };
    return `<ul class="ap-evidence">${list.map((e) => {
      const what = e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(e.url)}</a>` : esc(e.registryId || e.filename || '');
      const removable = editable && e.kind !== 'work_email';
      return `
        <li>
          <div class="ap-evidence-main">
            <span class="ap-evidence-kind">${t('ap.ev.kind.' + e.kind)}</span>
            <span class="ap-evidence-what">${what}</span>
            ${e.note ? `<span class="muted small">${esc(e.note)}</span>` : ''}
          </div>
          <span class="badge badge-${stateBadge[e.state] || 'badge-muted'}">${t('ap.ev.state.' + e.state)}</span>
          ${removable ? `<button type="button" class="btn btn-ghost btn-sm" data-ev-remove="${esc(e.id)}" aria-label="${esc(t('ap.ev.remove'))}">${t('ap.ev.remove')}</button>` : ''}
        </li>`;
    }).join('')}</ul>`;
  }

  function evidenceForm() {
    return `
      <form class="vt-form ap-ev-form" data-form="evidence" novalidate>
        <label><span>${t('ap.ev.kind')}</span>
          <select name="kind">${evidenceKinds().map((k) => `<option value="${k}">${t('ap.ev.kind.' + k)}</option>`).join('')}<option value="diploma">${t('ap.ev.kind.diploma')}</option></select>
        </label>
        <label class="ap-ev-url"><span>${t('ap.ev.url')}</span><input type="url" name="url" maxlength="500" placeholder="https://" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
        <label class="ap-ev-registry" hidden><span>${t('ap.ev.registry')}</span><input type="text" name="registryId" maxlength="13" inputmode="numeric" autocomplete="off"><span class="hint">${t('ap.ev.registry.hint')}</span></label>
        <label class="ap-ev-file" hidden><span>${t('ap.ev.upload')}</span><input type="file" name="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg"></label>
        <label class="ap-ev-note"><span>${t('ap.ev.note')}</span><input type="text" name="note" maxlength="${data.v.limits.evidenceNoteMax}"></label>
        <p class="form-error vt-error" role="alert"></p>
        <button class="btn btn-outline btn-sm" type="submit">${t('ap.ev.add')}</button>
      </form>`;
  }

  function licenceBlock(editable) {
    if (!data.v.regulated) return '';
    const l = data.v.inputs.license;
    const r = req('license');
    const needsDoc = data.v.requirements.some((x) => x.step === 'license_document');
    const expired = r.status === 'failed' && r.expiresAt && new Date(r.expiresAt) < new Date();
    const docs = data.v.inputs.documents.filter((d) => d.step === 'license_document');
    return `
      <div class="ap-block">
        <h4>${t('ap.lic.title')}</h4>
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
      </div>`;
  }

  function workEmailBlock() {
    const r = (data.v.optional || []).find((o) => o.step === 'work_email') || { status: 'todo' };
    const domain = data.v.inputs.workEmailDomain;
    if (r.status === 'passed') return `<p class="ap-line ap-ok">✓ ${fill('ap.opt.done', { domain: esc(domain || '') })}</p>`;
    const waiting = r.status === 'pending' && domain;
    return `
      <details class="ap-optional">
        <summary>${t('ap.opt.title')}</summary>
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
      </details>`;
  }

  function experienceForm() {
    const f = data.v.application.form;
    const L = data.v.limits;
    const nicheOptions = WisecallI18n.niches().map((n) => `<option value="${esc(n.key)}"${f.niche === n.key ? ' selected' : ''}>${esc(n.regulated ? fill('ap.f.niche.regulated', { niche: t('niche.' + n.key) }) : t('niche.' + n.key))}</option>`).join('')
      + `<option value="other"${f.niche === 'other' ? ' selected' : ''}>${esc(t('ap.f.niche.other'))}</option>`;
    return `
      <form class="vt-form ap-form" data-form="experience" novalidate>
        <label><span>${t('ap.f.title')}</span>
          <input type="text" name="roleTitle" maxlength="${L.titleMax}" value="${esc(f.roleTitle)}" autocomplete="organization-title">
          <span class="hint">${t('ap.f.title.hint')}</span></label>
        <label><span>${t('ap.f.niche')}</span>
          <select name="niche"><option value="">${t('ap.f.niche.choose')}</option>${nicheOptions}</select></label>
        <label class="ap-custom-niche"${f.niche === 'other' ? '' : ' hidden'}><span>${t('ap.f.customNiche')}</span>
          <input type="text" name="customNiche" maxlength="40" value="${esc(f.customNiche || '')}">
          <span class="hint">${t('ap.f.customNiche.hint')}</span></label>
        <label><span>${t('ap.f.tags')}</span>
          <input type="text" name="specialtyTags" maxlength="400" value="${esc(f.specialtyTags.join(', '))}">
          <span class="hint">${fill('ap.f.tags.hint', { max: L.tagsMax })}</span></label>
        <label><span>${t('ap.f.years')}</span>
          <input type="number" name="yearsExperience" min="0" max="${L.yearsMax}" step="1" inputmode="numeric" value="${f.yearsExperience === null || f.yearsExperience === undefined ? '' : esc(f.yearsExperience)}"></label>
        <label><span>${t('ap.f.story')}</span>
          <textarea name="story" rows="6" maxlength="${L.storyMax}" data-count="story">${esc(f.story)}</textarea>
          <span class="hint">${fill('ap.f.story.hint', { min: L.storyMin, max: L.storyMax })} <span class="ap-count" data-count-for="story"></span></span></label>
        <label><span>${t('ap.f.sample')}</span>
          <textarea name="sampleAnswer" rows="6" maxlength="${L.sampleMax}" data-count="sampleAnswer">${esc(f.sampleAnswer)}</textarea>
          <span class="hint">${fill('ap.f.sample.hint', { min: L.sampleMin })} <span class="ap-count" data-count-for="sampleAnswer"></span></span></label>
        <p class="form-error vt-error" role="alert"></p>
        <button class="btn btn-outline btn-sm" type="submit">${t('ap.f.save')}</button>
      </form>`;
  }

  function lockedSummary() {
    const f = data.v.application.form;
    const clip = (s, n) => (chars(s) > n ? esc([...s].slice(0, n).join('')) + '…' : esc(s));
    return `
      <dl class="ap-summary">
        <dt>${t('ap.f.title')}</dt><dd>${esc(f.roleTitle || '—')}</dd>
        <dt>${t('ap.f.niche')}</dt><dd>${f.niche ? esc(WisecallI18n.nicheName(f.niche, f.customNiche)) : '—'}</dd>
        <dt>${t('ap.f.tags')}</dt><dd>${esc(f.specialtyTags.join(', ') || '—')}</dd>
        <dt>${t('ap.f.years')}</dt><dd>${esc(f.yearsExperience === null ? '—' : f.yearsExperience)}</dd>
        <dt>${t('ap.f.story')}</dt><dd>${clip(f.story || '—', 280)}</dd>
        <dt>${t('ap.f.sample')}</dt><dd>${clip(f.sampleAnswer || '—', 280)}</dd>
      </dl>`;
  }

  function missingList() {
    const missing = data.v.application.missing;
    if (!missing.length) return '';
    return `
      <div class="ap-missing" role="note">
        <p><strong>${t('ap.missingHead')}</strong></p>
        <ul>${missing.map((m) => `<li>${m === 'price' ? `${t('ap.missing.price')} <button type="button" class="linklike" data-goto="mentor">${t('ap.missing.priceLink')}</button>` : t('ap.missing.' + m)}</li>`).join('')}</ul>
      </div>`;
  }

  function experienceSection() {
    const a = data.v.application;
    const state = experienceState();
    const exp = req('experience');
    const editable = !a.locked;
    const verified = data.v.status === 'verified';
    return `
      <section class="settings-card ap-section" id="ap-experience" aria-labelledby="ap-experience-h">
        <div class="vt-summary-head">
          <h3 id="ap-experience-h">${t('ap.exp.title')}</h3>
          <span class="badge badge-${BADGE[state]}">${t('ap.state.' + state)}</span>
        </div>
        <p class="ap-welcome">${t('ap.exp.welcome')}</p>
        ${editable ? `
          ${exp.status === 'failed' && exp.reason ? `<p class="form-error vt-reason"><strong>${t('vt.reason')}</strong> ${esc(exp.reason)}</p>` : ''}
          ${experienceForm()}
          <div class="ap-block">
            <h4>${t('ap.ev.title')}</h4>
            <p class="muted small">${t('ap.ev.hint')}</p>
            ${evidenceList(true)}
            ${evidenceForm()}
          </div>
          ${licenceBlock(true)}
          ${workEmailBlock()}
          <div class="ap-submit">
            ${missingList()}
            <p class="muted small">${t('ap.submit.ai')} <a href="/privacy.html#automated-review">${t('ap.submit.privacy')}</a></p>
            <button type="button" class="btn btn-primary" data-submit ${a.missing.length ? 'aria-disabled="true"' : ''}>${t('ap.submit')}</button>
            <p class="form-error ap-submit-error" role="alert"></p>
          </div>`
        : `
          <p class="muted small">${verified ? t('ap.lockedApproved') : fill('ap.locked', { date: a.submittedAt ? esc(fmtDay(a.submittedAt)) : '' })}</p>
          ${lockedSummary()}
          <div class="ap-block"><h4>${t('ap.ev.title')}</h4>${evidenceList(false)}</div>
          ${licenceBlock(false)}
          ${workEmailBlock()}
          ${data.v.status === 'suspended' ? '' : `<button type="button" class="btn btn-outline btn-sm" data-edit${verified ? ' data-confirm="1"' : ''}>${t('ap.edit')}</button>`}`}
      </section>`;
  }

  // ---- Step 3: Review ---------------------------------------------------------------------------------------------------------
  function interviewBlock() {
    const iv = data.iv;
    if (!iv || !iv.required) return '';
    const r = req('video_interview');
    if (r.status === 'passed') return `<p class="ap-line ap-ok">✓ ${t('ap.rev.interviewDone')}</p>`;
    let body;
    if (iv.booking) {
      body = `
        <p><strong>${fill('vt.iv.booked', { date: esc(fmtSlot(iv.booking.startsAt)) })}</strong></p>
        ${iv.booking.meetingLink
          ? `<p><a class="btn btn-primary btn-sm" href="${esc(iv.booking.meetingLink)}" target="_blank" rel="noopener noreferrer">${t('vt.iv.link')}</a></p>`
          : `<p class="muted small">${t('vt.iv.linkPending')}</p>`}
        <button type="button" class="btn btn-outline btn-sm" data-iv-cancel>${t('vt.iv.cancel')}</button>
        <p class="form-error vt-error" role="alert"></p>`;
    } else if (iv.blocked) body = `<p class="muted small">${t('vt.iv.blocked')}</p>`;
    else {
      const failed = iv.result && iv.result.result === 'failed';
      body = `
        ${failed ? `<p class="form-error">${t('vt.iv.failed')}${iv.result.reason ? ' ' + esc(iv.result.reason) : ''}</p>` : ''}
        ${iv.slots.length ? `
          <p class="muted small">${fill('vt.iv.pick', { minutes: iv.slots[0].minutes })}</p>
          <ul class="vt-slots">${iv.slots.map((s) => `<li><span>${esc(fmtSlot(s.startsAt))}</span><button type="button" class="btn btn-outline btn-sm" data-book="${esc(s.id)}">${t('vt.iv.book')}</button></li>`).join('')}</ul>
          <p class="form-error vt-error" role="alert"></p>` : `<p class="muted small">${t('vt.iv.none')}</p>`}`;
    }
    return `<div class="ap-block ap-interview"><h4>${t('verify.step.video_interview')}</h4><p class="muted small">${t('ap.rev.interview')}</p>${r.reason ? `<p class="muted small">${esc(r.reason)}</p>` : ''}${body}</div>`;
  }

  function reviewSection() {
    const v = data.v;
    const stage = v.application.stage;
    const state = reviewState();
    return `
      <section class="settings-card ap-section" id="ap-review" aria-labelledby="ap-review-h">
        <div class="vt-summary-head">
          <h3 id="ap-review-h">${t('ap.rev.title')}</h3>
          <span class="badge badge-${BADGE[state]}">${t('ap.state.' + state)}</span>
        </div>
        <p>${t('ap.rev.' + stage)}</p>
        ${stage === 'rejected' && v.note ? `<p class="form-error vt-reason"><strong>${t('vt.reason')}</strong> ${esc(v.note)}</p>` : ''}
        ${stage === 'checking' ? `<button type="button" class="btn btn-outline btn-sm" data-reload>${t('ap.rev.refresh')}</button>` : ''}
        ${stage === 'approved' && !v.hasPayoutDetails ? `<p><button type="button" class="btn btn-primary btn-sm" data-goto="payouts">${t('vt.addPayout')}</button></p>` : ''}
        ${interviewBlock()}
      </section>`;
  }

  // ---- Whole tab --------------------------------------------------------------------------------------------------------------
  // The headline and its colour come from v.state (the same state as the steps: a failed required step is never "verified").
  function headline() {
    const v = data.v;
    if (v.state === 'verified') return data.user.hasPayoutDetails ? (WisecallI18n.launchMode() === 'prelaunch' ? 'vt.status.verifiedPrelaunch' : 'vt.status.verifiedListed') : 'vt.status.verifiedNoPayout';
    if (v.state === 'needs_attention') return 'vt.status.needsAttention';
    if (v.state === 'suspended') return 'vt.status.suspended';
    if (v.state === 'rejected') return 'vt.status.rejected';
    return v.application.locked ? 'ap.status.inReview' : 'vt.status.pending';
  }

  function render() {
    const v = data.v;
    const tone = v.state === 'verified' ? 'answered' : (['rejected', 'suspended', 'needs_attention'].includes(v.state) ? 'rejected' : 'pending_payment');
    root.innerHTML = `
      <div class="settings-card vt-summary">
        <div class="vt-summary-head">
          <h2>${t('ap.title')}</h2>
          <span class="badge badge-${tone}">${t(headline())}</span>
        </div>
        <p class="muted">${fill('ap.intro', { minutes: v.limits.minutesToApply })}</p>
        ${stepper()}
        ${v.state !== 'verified' ? `<p class="muted small">${t('vt.gate')}</p>` : ''}
      </div>
      ${identitySection()}
      ${experienceSection()}
      ${reviewSection()}
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
  const FORM_ERR = {
    invalid_tags: 'ap.err.invalid_tags', invalid_years: 'ap.err.invalid_years', story_too_long: 'ap.err.story_too_long', sample_too_long: 'ap.err.sample_too_long',
    title_too_long: 'ap.err.title_too_long', invalid_niche: 'ap.err.invalid_niche', invalid_custom_niche: 'ap.err.invalid_custom_niche', application_locked: 'ap.err.application_locked', email_not_verified: 'settings.mentor.emailNotVerified'
  };
  const EV_ERR = {
    invalid_url: 'ap.ev.err.invalid_url', not_linkedin: 'ap.ev.err.not_linkedin', duplicate_evidence: 'ap.ev.err.duplicate_evidence', too_much_evidence: 'ap.ev.err.too_much_evidence',
    invalid_company_id: 'ap.ev.err.invalid_company_id', company_needs_id_or_url: 'ap.ev.err.company_needs_id_or_url', application_locked: 'ap.err.application_locked', ...DOC_ERR
  };

  function uploadFile(step, file) {
    if (!file) throw Object.assign(new Error('empty_file'), { code: 'empty_file' });
    if (file.size > MAX_BYTES) throw Object.assign(new Error('file_too_large'), { code: 'file_too_large' });
    if (!/\.(pdf|jpe?g)$/i.test(file.name)) throw Object.assign(new Error('unsupported_file_type'), { code: 'unsupported_file_type' });
    return WisecallAPI.uploadFile(`/verification/documents/${step}`, file);
  }

  const HANDLERS = {
    experience: (f) => WisecallAPI.apiFetch('/verification/experience', {
      method: 'PUT',
      body: {
        roleTitle: f.roleTitle.value, niche: f.niche.value || null, ...(f.niche.value === 'other' ? { customNiche: f.customNiche.value } : {}), specialtyTags: f.specialtyTags.value,
        yearsExperience: f.yearsExperience.value === '' ? null : Number(f.yearsExperience.value), story: f.story.value, sampleAnswer: f.sampleAnswer.value
      }
    }),
    evidence: (f) => {
      const kind = f.kind.value;
      if (kind === 'diploma') return uploadFile('diploma', f.file.files[0]);
      return WisecallAPI.apiFetch('/verification/evidence', { method: 'POST', body: { kind, url: f.url.value.trim() || undefined, registryId: kind === 'company' ? f.registryId.value.trim() || undefined : undefined, note: f.note.value.trim() || undefined } });
    },
    license: (f) => WisecallAPI.apiFetch('/verification/license', { method: 'POST', body: { number: f.number.value, issuingBody: f.issuingBody.value, holderName: f.holderName.value, validUntil: f.validUntil.value } }),
    workEmailSend: async (f) => {
      const r = await WisecallAPI.apiFetch('/verification/work-email', { method: 'POST', body: { email: f.email.value.trim() } });
      devWorkEmailCode = r.devCode || null; // shown under the code box (never sent in production)
      return r;
    },
    workEmailConfirm: async (f) => { const r = await WisecallAPI.apiFetch('/verification/work-email/verify', { method: 'POST', body: { code: f.code.value.trim() } }); devWorkEmailCode = null; return r; },
    document: (f) => uploadFile(f.dataset.step, f.file.files[0])
  };
  const ERRORS = { experience: FORM_ERR, evidence: EV_ERR, license: LICENSE_ERR, document: DOC_ERR, workEmailSend: EMAIL_ERR, workEmailConfirm: EMAIL_ERR };

  // The evidence form shows the fields that fit the chosen type.
  function syncEvidenceForm(form) {
    const kind = form.kind.value;
    form.querySelector('.ap-ev-url').hidden = kind === 'diploma';
    form.querySelector('.ap-ev-registry').hidden = kind !== 'company';
    form.querySelector('.ap-ev-file').hidden = kind !== 'diploma';
    form.querySelector('.ap-ev-note').hidden = kind === 'diploma';
  }

  function updateCount(area) {
    const out = root.querySelector(`[data-count-for="${area.dataset.count}"]`);
    if (out) out.textContent = fill('ap.f.count', { n: chars(area.value) });
  }

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

    // "Other (type your own)" shows the field for the mentor's own words.
    const expForm = root.querySelector('form[data-form="experience"]');
    if (expForm) expForm.niche.addEventListener('change', () => { expForm.querySelector('.ap-custom-niche').hidden = expForm.niche.value !== 'other'; });
    const evForm = root.querySelector('form[data-form="evidence"]');
    if (evForm) { evForm.kind.addEventListener('change', () => syncEvidenceForm(evForm)); syncEvidenceForm(evForm); }
    root.querySelectorAll('textarea[data-count]').forEach((area) => { updateCount(area); area.addEventListener('input', () => updateCount(area)); });

    root.querySelectorAll('[data-ev-remove]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await WisecallAPI.apiFetch(`/verification/evidence/${btn.dataset.evRemove}`, { method: 'DELETE' }); await reload(); }
      catch (e) { WisecallNav.showToast(t(e.code === 'application_locked' ? 'ap.err.application_locked' : 'toast.error')); btn.disabled = false; }
    }));
    root.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await WisecallAPI.apiFetch(`/verification/documents/${btn.dataset.remove}`, { method: 'DELETE' }); await reload(); }
      catch (e) { WisecallNav.showToast(t('toast.error')); btn.disabled = false; }
    }));

    const submit = root.querySelector('[data-submit]');
    if (submit) submit.addEventListener('click', async () => {
      const out = root.querySelector('.ap-submit-error');
      out.textContent = '';
      // Unsaved changes in the form are saved first, so what is submitted is what the mentor sees.
      const form = root.querySelector('form[data-form="experience"]');
      submit.disabled = true;
      try {
        if (form) await HANDLERS.experience(form);
        await WisecallAPI.apiFetch('/verification/submit', { method: 'POST' });
        WisecallNav.showToast(t('ap.submitted'));
        await reload();
        const review = document.getElementById('ap-review');
        if (review) review.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch (e) {
        out.textContent = t(e.code === 'incomplete' ? 'ap.err.incomplete' : (FORM_ERR[e.code] || 'toast.error'));
        submit.disabled = false;
        if (e.code === 'incomplete') await reload();
      }
    });

    const edit = root.querySelector('[data-edit]');
    if (edit) edit.addEventListener('click', async () => {
      if (edit.dataset.confirm && !window.confirm(t('ap.edit.confirm'))) return;
      edit.disabled = true;
      try { const r = await WisecallAPI.apiFetch('/verification/edit', { method: 'POST' }); Object.assign(data.user, r.user); await reload(); }
      catch (e) { WisecallNav.showToast(t('toast.error')); edit.disabled = false; }
    });

    root.querySelectorAll('[data-book]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await WisecallAPI.apiFetch('/verification/interview/book', { method: 'POST', body: { slotId: btn.dataset.book } }); WisecallNav.showToast(t('toast.saved')); await reload(); }
      catch (e) {
        const el = btn.closest('.ap-interview').querySelector('.vt-error');
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
        const el = start.parentElement.parentElement.querySelector('.vt-error');
        if (el) el.textContent = errText({ kyc_unavailable: 'vt.kyc.unavailable', already_verified: 'vt.kyc.already', age_final: 'ap.age.failed', email_not_verified: 'settings.mentor.emailNotVerified' }, e);
        start.disabled = false;
      }
    });

    root.querySelectorAll('[data-reload]').forEach((btn) => btn.addEventListener('click', () => reload()));
    root.querySelectorAll('[data-goto]').forEach((btn) => btn.addEventListener('click', () => options.goto && options.goto(btn.dataset.goto)));
  }

  // ---- Loading ----------------------------------------------------------------------------------------------------------------
  async function reload() {
    const openDetails = Array.from(root.querySelectorAll('details.ap-optional[open]')).length > 0;
    try {
      const [v, iv] = await Promise.all([WisecallAPI.apiFetch('/verification'), WisecallAPI.apiFetch('/verification/interview')]);
      data = { v, iv, user: data ? data.user : options.user };
    } catch (e) {
      root.innerHTML = `<p class="muted">${t('toast.error')}</p>`;
      return;
    }
    render();
    if (openDetails) { const d = root.querySelector('details.ap-optional'); if (d) d.open = true; }
    document.dispatchEvent(new CustomEvent('wisecall:verification-changed', { detail: data.v }));
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
