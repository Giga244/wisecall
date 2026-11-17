// Admin: reviewing mentor applications step by step. Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => WisecallI18n.formatDate(d, { dateStyle: 'medium', timeStyle: 'short' });
  const initials = (name) => (name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const STATUS_BADGE = { passed: 'answered', pending: 'pending_payment', failed: 'rejected', todo: 'badge-muted' };
  const stepTitle = (s) => t(`verify.step.${s}`);
  const badge = (status) => `<span class="badge badge-${STATUS_BADGE[status] || 'pending_payment'}">${t('verify.status.' + status)}</span>`;

  // Evidence is shown as plain "label: value" lines. Nothing here is ever a link the admin could
  // click by accident except URLs the mentor supplied, which open in a new tab without a referrer.
  const labelFor = (k) => (t('verify.ev.' + k) === 'verify.ev.' + k ? k : t('verify.ev.' + k));

  function evidenceHtml(ev) {
    const entries = Object.entries(ev || {}).filter(([k, v]) => v !== null && v !== undefined && v !== '' && k !== 'inputsHash' && k !== 'mismatch');
    if (!entries.length) return '';
    return `<ul class="mv-evidence">${entries.map(([k, v]) => {
      if (Array.isArray(v)) return `<li><span class="muted small">${esc(labelFor(k))}:</span><ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></li>`;
      const text = String(v);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return `<li><span class="muted small">${esc(labelFor(k))}:</span> ${esc(fmt(text))}</li>`;
      const value = /^https?:\/\//i.test(text) ? `<a href="${esc(text)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(typeof v === 'object' ? JSON.stringify(v) : text);
      return `<li><span class="muted small">${esc(labelFor(k))}:</span> ${value}</li>`;
    }).join('')}</ul>`;
  }

  // "Your field": the mentor's words and category; an admin can change both, and keep a category that needs no licence when the words
  // only look like a licensed profession.
  function fieldBlock(a) {
    const options = WisecallI18n.niches().map((n) => `<option value="${esc(n.key)}"${a.niche === n.key ? ' selected' : ''}>${esc(t('niche.' + n.key))}</option>`).join('')
      + `<option value="other"${a.niche === 'other' ? ' selected' : ''}>${esc(t('niche.other'))}</option>`;
    return `
      <details class="mv-audit mv-field">
        <summary>${t('admin.mv.field.title')}: ${esc(a.customNiche || '—')} · ${esc(a.niche ? t('niche.' + a.niche) : '—')}${a.fieldOverride ? ` · ${t('admin.mv.field.overridden')}` : ''}</summary>
        ${a.wordsCategory && !a.fieldOverride ? `<p class="muted small">${esc(t('admin.mv.field.wordsSay').replace('{niche}', t('niche.' + a.wordsCategory)))}</p>` : ''}
        <div class="mv-field-form">
          <label><span>${t('admin.mv.field.text')}</span><input type="text" class="mv-field-text" maxlength="60" value="${esc(a.customNiche || '')}"></label>
          <label><span>${t('admin.mv.field.category')}</span><select class="mv-field-niche">${options}</select></label>
          <label class="check"><input type="checkbox" class="mv-field-notreg"${a.fieldOverride ? ' checked' : ''}> <span>${t('admin.mv.field.notRegulated')}</span></label>
          <button type="button" class="btn btn-outline btn-sm mv-field-save">${t('admin.mv.field.save')}</button>
        </div>
      </details>`;
  }

  function stepRow(s) {
    const canDecide = s.manual && s.status !== 'todo';
    return `
      <div class="mv-step" data-step="${s.step}">
        <div class="mv-step-head">
          <strong>${esc(stepTitle(s.step))}</strong>
          ${badge(s.status)}
        </div>
        ${evidenceHtml(s.evidence)}
        ${s.reason ? `<p class="muted small">${esc(s.reason)}${s.decidedBy ? ` — ${esc(s.decidedBy)}` : ''}${s.decidedAt ? `, ${fmt(s.decidedAt)}` : ''}</p>` : ''}
        ${canDecide ? `
          <div class="mv-decide">
            <input type="text" class="mv-reason" maxlength="300" placeholder="${esc(t('admin.mv.reasonToFail'))}" aria-label="${esc(t('admin.mv.reasonToFail'))}">
            <button class="btn btn-primary btn-sm mv-pass">${t('admin.mv.pass')}</button>
            <button class="btn btn-outline btn-sm mv-fail">${t('admin.mv.fail')}</button>
          </div>` : ''}
      </div>`;
  }

  const fill = (key, vars) => Object.entries(vars || {}).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), t(key));
  const usd = (n) => '$' + Number(n || 0).toFixed(Number(n) < 0.1 ? 4 : 2);
  const RISK_BADGE = { low: 'answered', medium: 'pending_payment', high: 'rejected' };
  const riskBadge = (risk) => (risk ? `<span class="badge badge-${RISK_BADGE[risk]}">${esc(fill('admin.ai.risk', { risk: t('admin.ai.risk.' + risk) }))}</span>` : '');
  const label = (prefix, code) => (t(prefix + code) === prefix + code ? code : t(prefix + code));

  // Why the analysis sent it to a person, in plain words.
  function reasonText(r) {
    if (r.code === 'scores_below') return fill('admin.ai.reason.scores_below', { keys: r.keys.map((k) => label('admin.ai.score.', k)).join(', '), min: r.min });
    if (r.code === 'red_flags') return fill('admin.ai.reason.red_flags', { flags: r.flags.map((f) => label('admin.ai.flag.', f)).join(', ') });
    if (r.code === 'ai_unavailable') return fill('admin.ai.reason.ai_unavailable', { detail: r.detail || '' });
    return label('admin.ai.reason.', r.code);
  }

  // Step 3 on top: the latest automatic analysis (AI summary first), its reasons, scores, flags, signals and cost.
  function analysisBlock(d) {
    const a = d.analysis;
    const canRerun = d.mentor.verificationStatus === 'pending';
    const actions = `
      <div class="mv-decide">
        ${canRerun ? `<button class="btn btn-outline btn-sm mv-rerun">${t('admin.ai.rerun')}</button>` : ''}
        ${canRerun && !d.interviewRequested ? `<input type="text" class="mv-iv-reason" maxlength="300" placeholder="${esc(t('admin.ai.interviewReason'))}" aria-label="${esc(t('admin.ai.interviewReason'))}">
          <button class="btn btn-ghost btn-sm mv-iv-request">${t('admin.ai.requestInterview')}</button>` : ''}
      </div>`;
    if (!a) return `<div class="mv-analysis"><p><strong>${t('admin.ai.title')}</strong></p><p class="muted small">${t(d.application.submitted ? 'admin.ai.none' : 'admin.ai.notSubmitted')}</p>${actions}</div>`;
    if (a.status === 'running') return `<div class="mv-analysis"><p><strong>${t('admin.ai.title')}</strong></p><p class="muted small">${t('admin.ai.running')}</p></div>`;
    const ai = a.ai;
    const c = a.checks || {};
    const sig = c.signals || {};
    const signalLines = ['sharedDevice', 'sharedNetwork', 'duplicateStory', 'duplicateSample', 'duplicateEvidence'].filter((k) => sig[k]).map((k) => fill('admin.ai.signal.' + k, { n: sig[k] }));
    if (sig.newEmailDomain) signalLines.push(fill('admin.ai.signal.newEmailDomain', { days: sig.details && sig.details.emailDomainAgeDays }));
    const reasons = (a.reasons || []).filter((r) => r.code !== 'not_submitted_under_v2');
    return `
      <div class="mv-analysis">
        <div class="mv-step-head">
          <strong>${t('admin.ai.title')}</strong>
          ${riskBadge(a.risk)}
          ${ai ? `<span class="badge badge-${ai.recommendation === 'approve' ? 'answered' : (ai.recommendation === 'reject_suggested' ? 'rejected' : 'pending_payment')}">${esc(fill('admin.ai.recommends', { rec: t('admin.ai.rec.' + ai.recommendation) }))}</span>` : ''}
        </div>
        ${ai ? `<p class="mv-ai-summary"><span class="badge badge-paid">${t('admin.ai.summaryLabel')}</span> ${esc(ai.admin_summary)}</p><p class="muted small"><strong>${t('admin.ai.evidence')}</strong> ${esc(ai.evidence_summary)}</p>` : aiStatus(a.aiError)}
        ${c.wouldAutoApprove && !d.autoApprove ? `<p class="mv-note">${t('admin.ai.wouldAuto')}</p>` : ''}
        ${reasons.length ? `<p class="small"><strong>${t('admin.ai.reasons')}</strong></p><ul class="mv-evidence">${reasons.map((r) => `<li>${esc(reasonText(r))}</li>`).join('')}</ul>` : ''}
        ${ai ? `<table class="mv-scores"><caption class="sr-only">${t('admin.ai.scores')}</caption><tbody>${Object.entries(ai.scores).map(([k, v]) => `<tr><th scope="row">${esc(label('admin.ai.score.', k))}</th><td><span class="mv-score-bar" style="width:${Math.max(2, v)}%"></span></td><td>${v}</td></tr>`).join('')}</tbody></table>` : ''}
        ${ai && ai.red_flags.length ? `<p class="small"><strong>${t('admin.ai.redFlags')}</strong></p><ul class="mv-evidence">${ai.red_flags.map((f) => `<li><strong>${esc(label('admin.ai.flag.', f.code))}</strong>: ${esc(f.detail)}</li>`).join('')}</ul>` : ''}
        ${c.injection && c.injection.found ? `<p class="form-error"><strong>${t('admin.ai.injection')}</strong></p><ul class="mv-evidence">${c.injection.matches.map((m) => `<li>${esc(m.field)}: “${esc(m.snippet)}”</li>`).join('')}</ul>` : ''}
        ${signalLines.length ? `<p class="small"><strong>${t('admin.ai.signals')}</strong></p><ul class="mv-evidence">${signalLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        <p class="muted small">${esc(fill('admin.ai.cost', { cost: usd(a.usage.costUsd), in: a.usage.inputTokens, out: a.usage.outputTokens, model: a.aiModel || '-' }))} · ${esc(t('admin.ai.trigger.' + a.trigger))} · ${fmt(a.createdAt)}</p>
        ${(d.analysisHistory || []).length ? `<details><summary class="small">${fill('admin.ai.history', { n: d.analysisHistory.length })}</summary><ul class="mv-evidence">${d.analysisHistory.map((h) => `<li>${fmt(h.createdAt)} · ${esc(t('admin.ai.trigger.' + h.trigger))} · ${h.risk ? esc(t('admin.ai.risk.' + h.risk)) : '-'} · ${usd(h.costUsd)}${h.aiError ? ' · ' + esc(aiErrorText(h.aiError)) : ''}</li>`).join('')}</ul></details>` : ''}
        ${actions}
      </div>`;
  }

  // Step 2 as the mentor filled it in.
  function applicationBlock(d) {
    const a = d.application;
    return `
      <div class="mv-application">
        <p><strong>${t('admin.ai.application')}</strong> ${a.submittedAt ? `<span class="muted small">${esc(fill('admin.ai.submittedAt', { date: fmt(a.submittedAt) }))}</span>` : `<span class="badge badge-pending_payment">${t('admin.ai.draft')}</span>`}</p>
        <ul class="mv-evidence">
          <li><span class="muted small">${t('admin.ai.f.title')}:</span> ${esc(a.roleTitle || '-')}</li>
          <li><span class="muted small">${t('admin.ai.f.niche')}:</span> ${a.niche ? esc(t('niche.' + a.niche)) : '-'}</li>
          <li><span class="muted small">${t('admin.ai.f.tags')}:</span> ${esc((a.specialtyTags || []).join(', ') || '-')}</li>
          <li><span class="muted small">${t('admin.ai.f.years')}:</span> ${esc(a.yearsExperience === null || a.yearsExperience === undefined ? '-' : a.yearsExperience)}</li>
        </ul>
        <div class="booking-answer"><strong>${t('admin.ai.f.story')}</strong> ${esc(a.story || '')}</div>
        <div class="booking-answer" style="margin-top:8px"><strong>${t('admin.sampleTitle')}</strong> ${esc(a.sampleAnswer || '')}</div>
        ${a.profileExtras && [a.profileExtras.startTags, a.profileExtras.helpPoints, a.profileExtras.workLinks].some((x) => (x || []).length) ? `<div class="booking-answer mv-extras" style="margin-top:8px"><strong>${t('admin.ai.f.extras')}</strong> ${esc([...(a.profileExtras.startTags || []).map((id) => t('start.' + id)), ...(a.profileExtras.helpPoints || [])].join(' · '))}${(a.profileExtras.workLinks || []).length ? `<p class="small mv-work-links" style="overflow-wrap:anywhere;margin:6px 0 0"><span class="badge badge-muted">${esc(t('admin.ai.linkFlag.could_not_check'))}</span> ${a.profileExtras.workLinks.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(u)}</a>`).join(' · ')}</p>` : ''}</div>` : ''}
      </div>`;
  }

  // The evidence, with what the link check saw, and a way to confirm by hand what only a person can check.
  function evidenceBlock(d) {
    const list = d.evidence || [];
    if (!list.length) return `<p class="muted small">${t('admin.ai.noEvidence')}</p>`;
    const STATUS = { ok: 'answered', warning: 'pending_payment', failed: 'rejected', admin_check: 'paid', unchecked: 'badge-muted' };
    return `
      <div class="mv-evidence-list">
        <p><strong>${t('admin.ai.evidenceTitle')}</strong></p>
        ${list.map((e) => {
          const r = e.checkResult || {};
          const what = e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(e.url)}</a>` : (e.registryId ? esc(e.registryId) : (e.documentId ? `<a class="btn btn-outline btn-sm" href="/api/admin/documents/${esc(e.documentId)}" download>${esc(e.filename || t('admin.mv.download'))}</a>` : ''));
          const manual = !e.autoVerified && e.kind !== 'work_email';
          return `
            <div class="mv-step" data-evidence="${esc(e.id)}">
              <div class="mv-step-head">
                <strong>${esc(t('ap.ev.kind.' + e.kind))}</strong>
                <span class="badge badge-${STATUS[e.checkStatus] || 'badge-muted'}">${esc(label('admin.ai.ev.', e.checkStatus))}${e.autoVerified ? ' ✓' : ''}</span>
              </div>
              <p class="small" style="overflow-wrap:anywhere">${what}${e.note ? ` · <span class="muted">${esc(e.note)}</span>` : ''}</p>
              ${r.title || r.description ? `<p class="muted small">“${esc(r.title || '')}”${r.description ? ` · ${esc(r.description)}` : ''}</p>` : ''}
              ${r.match ? `<p class="muted small">${esc(label('admin.ai.match.', r.match))}</p>` : ''}
              ${(r.flags || []).length ? `<p class="muted small">${r.flags.map((f) => esc(label('admin.ai.linkFlag.', f))).join(' · ')}${r.domainAgeDays !== undefined ? ' · ' + esc(fill('admin.ai.domainAge', { days: r.domainAgeDays })) : ''}</p>` : ''}
              ${e.companyType || r.companyType ? `<p class="muted small">${esc(label('admin.ai.company.', r.companyType || e.companyType))}</p>` : ''}
              ${e.registry ? `<p class="small">${e.registry.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.label)}</a>`).join(' · ')}</p>` : ''}
              ${e.decidedAt ? `<p class="muted small">${esc(fill('admin.ai.decidedAt', { date: fmt(e.decidedAt) }))}</p>` : ''}
              ${manual ? `
                <div class="mv-decide">
                  <input type="text" class="mv-ev-reason" maxlength="300" placeholder="${esc(t('admin.mv.reasonToFail'))}" aria-label="${esc(t('admin.mv.reasonToFail'))}">
                  <button class="btn btn-primary btn-sm mv-ev-ok">${t('admin.ai.ev.confirm')}</button>
                  <button class="btn btn-outline btn-sm mv-ev-failed">${t('admin.ai.ev.refuse')}</button>
                </div>` : ''}
            </div>`;
        }).join('')}
      </div>`;
  }

  // Why the AI part of an analysis did not run, in plain words (the raw code only for an unknown one).
  function aiErrorText(code) {
    const base = String(code || '').split(':')[0].replace(/^api_error_\d+$/, 'api_error');
    const key = 'admin.ai.err.' + base;
    return t(key) !== key ? t(key) : fill('admin.ai.error', { error: code || '-' });
  }
  const aiStatus = (code) => (String(code).startsWith('not_configured') ? `<p class="muted small">${esc(aiErrorText(code))}</p>` : `<p class="form-error">${esc(aiErrorText(code))}</p>`);

  // The person as the ID provider verified them. Only admins ever see this.
  function kycBlock(k) {
    if (!k) return `<p class="muted small">${t('admin.mv.kycNone')}</p>`;
    return `
      <div class="mv-kyc">
        <p><strong>${t('admin.mv.kyc')}</strong> ${esc(k.provider)} · ${t('verify.kyc.' + k.status)}</p>
        ${k.verifiedName ? `<p>${t('admin.mv.kycName')}: <strong>${esc(k.verifiedName)}</strong> · ${t('admin.mv.kycDob')}: ${esc(k.dateOfBirth || '—')} · ${t('admin.mv.kycCountry')}: ${esc(k.country || '—')}</p>` : ''}
        <button class="btn btn-ghost btn-sm mv-kyc-refresh">${t('admin.mv.kycRefresh')}</button>
        <details class="mv-kyc-rerun">
          <summary>${t('admin.mv.kycRerun')}</summary>
          <p class="muted small">${t('admin.mv.kycRerunHelp')}</p>
          <label class="sr-only" for="mvRerunReason">${t('admin.mv.reasonPlaceholder')}</label>
          <input type="text" id="mvRerunReason" class="mv-kyc-rerun-reason" maxlength="1000" placeholder="${t('admin.mv.reasonPlaceholder')}">
          <button type="button" class="btn btn-outline btn-sm mv-kyc-rerun-btn">${t('admin.mv.kycRerunGo')}</button>
        </details>
      </div>`;
  }
  // What the mentor submitted as proof of qualification. Only admins ever see the full licence number,
  // and the documents open through an admin-only download that is written to the audit log.
  function credentialsBlock(d) {
    const c = d.credentials;
    const docs = d.documents || [];
    if (!c && !d.workEmail && !docs.length) return '';
    const line = (label, value) => `<li><span class="muted small">${esc(label)}:</span> ${value}</li>`;
    return `
      <div class="mv-credentials">
        <p><strong>${t('admin.mv.credentials')}</strong></p>
        <ul class="mv-evidence">
          ${c ? line(t('admin.mv.licenseNumber'), `<strong>${esc(c.licenseNumber || '—')}</strong>`) + line(t('admin.mv.issuingBody'), esc(c.issuingBody)) + line(t('admin.mv.holderName'), esc(c.holderName)) + line(t('admin.mv.validUntil'), esc(c.validUntil || t('admin.mv.noExpiry')))
            + (c.second ? line(t('admin.mv.second'), `${esc(c.second.issuingBody)}${c.second.licenseNumber ? ` · <strong>${esc(c.second.licenseNumber)}</strong>` : ''}`) : '') : ''}
          ${d.workEmail ? line(t('admin.mv.workEmail'), `${esc(d.workEmail.address)} · ${d.workEmail.verifiedAt ? t('admin.mv.workEmailConfirmed') : t('admin.mv.workEmailWaiting')}`) : ''}
        </ul>
        ${docs.length ? `
          <p class="muted small">${t('admin.mv.documents')}: ${t('admin.mv.docsNote')}</p>
          <ul class="mv-docs">${docs.map((f) => `
            <li>
              <span>${esc(stepTitle(f.step))} · ${esc(f.filename)} · ${Math.max(1, Math.round(f.size / 1024))} KB</span>
              <a class="btn btn-outline btn-sm" href="/api/admin/documents/${esc(f.id)}" download>${t('admin.mv.download')}</a>
              ${f.deleteAfter ? `<span class="muted small">${t('admin.mv.deleteOn').replace('{date}', WisecallI18n.formatDate(f.deleteAfter, { dateStyle: 'medium' }))}</span>` : ''}
            </li>`).join('')}</ul>` : ''}
      </div>`;
  }
  // The flag's sentence, with its numbers filled in (average rating, number of reports, expiry date).
  function flagText(f) {
    const d = f.detail || {};
    return t('admin.mv.flag.' + f.kind)
      .replace('{average}', d.average).replace('{reviews}', d.reviews).replace('{count}', d.count)
      .replace('{date}', d.expiresAt ? String(d.expiresAt).slice(0, 10) : '');
  }
  // Open flags the system raised for this mentor (for example a name that does not match the ID).
  function flagsBlock(list) {
    if (!list || !list.length) return '';
    return `<div class="mv-flags">${list.map((f) => `
      <div class="mv-flag" data-flag="${f.id}">
        <p><strong>${esc(flagText(f))}</strong></p>
        ${f.detail && f.detail.mismatches ? `<ul class="mv-evidence">${f.detail.mismatches.map((m) => `<li>${esc(m.source)}: “${esc(m.name)}” (${Math.round(m.score * 100)}%)</li>`).join('')}</ul>` : ''}
        <div class="mv-decide">
          <input type="text" class="mv-flag-reason" maxlength="300" placeholder="${esc(t('admin.mv.reasonPlaceholder'))}" aria-label="${esc(t('admin.mv.reasonPlaceholder'))}">
          <button class="btn btn-outline btn-sm mv-flag-resolve">${t('admin.mv.resolve')}</button>
        </div>
      </div>`).join('')}</div>`;
  }
  // One tap (docs/CLAUDE-CODE-ADMIN-ONE-TAP-APPROVE.md): the names of what "Approve" will count first, and why it cannot approve yet.
  const isDiplomaNiche = (key) => (WisecallI18n.niches().find((n) => n.key === key) || {}).credential === 'diploma';
  function oneTapItems(d) {
    const p = d.oneTap || { willPass: [], evidence: [] };
    const dip = isDiplomaNiche(d.application && d.application.niche);
    const names = p.willPass.map((s) => (dip && s === 'license' ? t('admin.oneTap.diploma') : (dip && s === 'license_document' ? t('admin.oneTap.diplomaCopy') : stepTitle(s))));
    if (p.evidence.length) names.push(t('admin.oneTap.evidence'));
    return names;
  }
  const blockText = (code) => (['not_submitted', 'invalid_state', 'email'].includes(code) ? t('admin.oneTap.block.' + code) : stepTitle(code));
  function oneTapHtml(d) {
    const items = oneTapItems(d);
    return d.oneTap && d.oneTap.canApprove && items.length ? `<p class="small mv-onetap">${esc(fill('admin.oneTap.will', { list: items.join(', ') }))}</p>` : '';
  }
  // "Change price" (docs/CLAUDE-CODE-MENTOR-EDIT.md): ₾ or free, a reason always, and the history. What changed in a sent application ("updated").
  function priceBlock(d) {
    const money = (n) => (n === 0 ? t('admin.price.free') : (n === null || n === undefined ? '—' : `${n} ₾`));
    const h = d.priceHistory || [];
    return `
      <div class="mv-price">
        <p class="small"><strong>${t('admin.price.title')}</strong> · ${esc(t('admin.price.now'))} <strong class="mv-price-now">${esc(money(d.price))}</strong></p>
        <div class="mv-decide">
          <label class="checkbox-row"><input type="checkbox" class="mv-price-free"${d.price === 0 ? ' checked' : ''}> <span>${t('admin.price.free')}</span></label>
          <input type="number" class="mv-price-amount" min="5" max="2000" step="1" inputmode="numeric" value="${d.price > 0 ? esc(d.price) : ''}" aria-label="${esc(t('admin.price.amount'))}" placeholder="₾"${d.price === 0 ? ' hidden' : ''}>
        </div>
        <div class="mv-decide">
          <input type="text" class="mv-price-reason" maxlength="300" placeholder="${esc(t('admin.price.reason'))}" aria-label="${esc(t('admin.price.reason'))}">
          <button class="btn btn-outline btn-sm mv-price-save">${t('admin.price.save')}</button>
        </div>
        <p class="muted small">${esc(t('admin.price.keep'))}${d.price === 0 && !d.mentor.hasPayoutDetails ? ' ' + esc(t('admin.price.payout')) : ''}</p>
        ${h.length ? `<details class="mv-audit"><summary>${t('admin.price.history')} (${h.length})</summary>
          <ul class="earn-list mv-price-history">${h.map((x) => `<li><span>${fmt(x.at)}</span><span>${esc(money(x.from))} → ${esc(money(x.to))} · ${esc(x.source === 'admin' ? (x.by || 'admin') : t('admin.price.byMentor'))}</span><span class="muted small">${esc(x.reason || '')}</span></li>`).join('')}</ul>
        </details>` : ''}
      </div>`;
  }
  function updatedBlock(d) {
    const c = d.applicationChanges;
    if (!c) return '';
    return `<p class="mv-note mv-updated" role="note"><span class="badge badge-pending_payment">${t('admin.updated.badge')}</span> ${esc(fill('admin.updated.what', { date: fmt(c.at), list: (c.fields || []).map((f) => t('admin.updated.f.' + f)).join(', ') }))}</p>`;
  }

  function panelHtml(d) {
    const rows = d.requirements.map(stepRow).join('');
    const optional = (d.optional || []).filter((r) => r.status !== 'todo').map(stepRow).join('');
    const legacy = (d.legacySteps || []).map(stepRow).join('');
    const total = d.requirements.length;
    const done = d.requirements.filter((r) => r.status === 'passed').length;
    return `
      <div class="mv-panel">
        ${updatedBlock(d)}
        ${analysisBlock(d)}
        ${applicationBlock(d)}
        ${evidenceBlock(d)}
        ${d.registries.length ? `<p class="small"><strong>${t('admin.mv.registries')}</strong> ${d.registries.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.label)}</a>`).join(' · ')}</p>` : ''}
        ${flagsBlock(d.flags)}
        ${kycBlock(d.kyc)}
        ${credentialsBlock(d)}
        <p class="muted small">${t('admin.mv.progress').replace('{done}', done).replace('{total}', total)}</p>
        <div class="mv-steps">${rows}${optional}</div>
        ${legacy ? `<details class="mv-audit"><summary>${t('admin.ai.legacySteps')}</summary><div class="mv-steps">${legacy}</div></details>` : ''}
        ${fieldBlock(d.application)}
        ${priceBlock(d)}
        <div class="mv-final">
          ${d.standing && d.standing.backInReview ? `<p class="mv-note" role="note"><strong>${t('admin.mv.reinstateNote')}</strong></p>` : ''}
          ${oneTapHtml(d)}
          <button class="btn btn-primary btn-lg mv-approve" ${d.oneTap && d.oneTap.canApprove ? '' : 'disabled'}>${t(d.standing && d.standing.wasApproved ? 'admin.reapprove' : 'admin.oneTap.approve')}</button>
          ${d.oneTap && !d.oneTap.canApprove ? `<p class="muted small mv-blocked">${esc(fill('admin.oneTap.blocked', { list: d.oneTap.blockedBy.map(blockText).join(', ') }))}</p>` : ''}
          <div class="mv-reject">
            <input type="text" class="mv-reject-reason" maxlength="500" placeholder="${esc(t('admin.rejectReasonPlaceholder'))}" aria-label="${esc(t('admin.rejectReasonPlaceholder'))}">
            <button class="btn btn-outline btn-sm mv-reject-btn">${t('admin.reject')}</button>
          </div>
        </div>
        <div class="mv-suspend">
          <p class="muted small"><strong>${t('admin.mv.suspendTitle')}</strong></p>
          ${d.mentor.verificationStatus === 'suspended' ? `
            <p class="mv-note" role="note"><strong>${t('admin.mv.reinstateNote')}</strong> ${t(d.ready ? 'admin.mv.reinstateReadyNote' : 'admin.mv.reinstateNotReady')}</p>` : ''}
          <div class="mv-decide">
            <input type="text" class="mv-suspend-reason" maxlength="300" placeholder="${esc(t(d.mentor.verificationStatus === 'suspended' ? 'admin.mv.reinstateReason' : 'admin.mv.suspendReason'))}" aria-label="${esc(t(d.mentor.verificationStatus === 'suspended' ? 'admin.mv.reinstateReason' : 'admin.mv.suspendReason'))}">
            ${d.mentor.verificationStatus === 'suspended'
              ? `<button class="btn btn-outline btn-sm mv-reinstate">${t('admin.mv.reinstate')}</button>
                 ${d.ready ? `<button class="btn btn-primary btn-sm mv-reinstate-approve">${t('admin.mv.reinstateApprove')}</button>` : ''}`
              : `<button class="btn btn-ghost btn-sm mv-suspend-btn">${t('admin.mv.suspend')}</button>`}
          </div>
        </div>
        <details class="mv-audit"><summary>${t('admin.mv.audit')} (${d.audit.length})</summary>
          <ul class="earn-list">${d.audit.map((a) => `<li><span>${fmt(a.at)}</span><span>${esc(a.by || '')} · ${esc(a.action)}${a.step ? ' · ' + esc(stepTitle(a.step)) : ''}</span><span class="muted small">${esc(a.reason || '')}</span></li>`).join('')}</ul>
        </details>
      </div>`;
  }

  // The last email to this person, as the provider reported it (a code that never arrived shows here as bounced or still "sent").
  const EMAIL_TONE = { delivered: 'answered', sent: 'pending_payment', delayed: 'pending_payment', bounced: 'rejected', complained: 'rejected' };
  const emailStatus = (m) => `<span class="badge badge-${EMAIL_TONE[m.emailStatus] || 'muted'} mv-email-status">${esc(fill('admin.email.last', { status: t('admin.email.' + (m.emailStatus || 'none')) }))}${m.emailStatusAt ? ` · ${esc(WisecallI18n.formatDate(m.emailStatusAt, { dateStyle: 'short', timeStyle: 'short' }))}` : ''}</span>`;
  // Confirmed or not (docs/CLAUDE-CODE-EMAIL-CODE-FIX.md 5): an application can be sent before the email code is entered, never approved.
  const emailConfirmed = (m) => (m.emailVerified
    ? `<span class="badge badge-answered mv-email-ok">${esc(t('admin.email.confirmed'))}</span>`
    : `<span class="badge badge-rejected mv-email-unconfirmed">${esc(t('admin.email.unconfirmed'))}</span> <span class="muted small mv-email-why">${esc(t('admin.email.noApprove'))}</span>`);
  function card(m) {
    const v = m.verification || {};
    return `
      <div class="booking-card mv-card" data-id="${m.id}">
        <div class="booking-top">
          <div class="avatar" style="${WisecallAPI.avatarStyle(m.color)}">${esc(initials(m.name))}</div>
          <div>
            <div class="card-name">${esc(m.name)}</div>
            <span class="muted small">${esc(m.email)}</span>
            ${emailConfirmed(m)}
            ${emailStatus(m)}
          </div>
          <div class="booking-amount">${m.price === null || m.price === undefined ? '—' : WisecallAPI.formatPrice(m.price)}</div>
        </div>
        <p class="booking-question">
          <strong>${esc(m.roleTitle || '—')}</strong> · ${m.customNiche ? `${esc(m.customNiche)} <span class="muted small">(${esc(m.niche ? t('niche.' + m.niche) : '—')})</span>` : (m.niche ? esc(t('niche.' + m.niche)) : '—')}
          ${v.level === 'regulated' ? `<span class="badge badge-paid">${t('verify.level.regulated')}</span>` : ''}
        </p>
        <p class="small mv-uni">${esc(t('admin.uni.title'))}: ${esc(m.universityBadge === 'removed' ? t('admin.uni.removed') : (m.university ? fill('admin.uni.shown', { name: WisecallI18n.getLang() === 'ka' ? m.university.ka : m.university.en }) : t('admin.uni.none')))}
          ${m.universityBadge === 'confirmed' || !m.university ? `<button type="button" class="btn btn-ghost btn-sm" data-uni="confirm">${esc(t('admin.uni.confirm'))}</button>` : ''}
          ${m.universityBadge === 'removed' ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-uni="remove">${esc(t('admin.uni.remove'))}</button>`}
          ${m.universityBadge ? `<button type="button" class="btn btn-ghost btn-sm" data-uni="reset">${esc(t('admin.uni.reset'))}</button>` : ''}</p>
        ${m.analysis && m.analysis.summary ? `<p class="mv-ai-summary small">${riskBadge(m.analysis.risk)} <span class="badge badge-paid">${t('admin.ai.summaryLabel')}</span> ${esc(m.analysis.summary)}</p>` : (m.analysis && m.analysis.risk ? `<p class="small">${riskBadge(m.analysis.risk)} ${m.analysis.aiError ? esc(aiErrorText(m.analysis.aiError)) : ''}</p>` : '')}
        ${m.verificationStatus === 'pending' && !v.submitted ? `<p><span class="badge badge-pending_payment">${t('admin.ai.draft')}</span></p>` : ''}
        ${m.verificationStatus !== 'none' && v.profileGaps && v.profileGaps.length ? `<p class="mv-incomplete" role="note"><span class="badge badge-rejected">${esc(t('admin.mv.incomplete').replace('{missing}', v.profileGaps.map((g) => t('admin.mv.gap.' + g)).join(', ')))}</span></p>` : ''}
        ${m.verificationNote ? `<p class="muted small">${t('admin.lastNote')}: ${esc(m.verificationNote)}</p>` : ''}
        <div class="review-actions" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:10px;">
          <span class="badge badge-${m.verificationStatus === 'rejected' ? 'rejected' : (m.verificationStatus === 'verified' ? 'answered' : 'pending_payment')}">${t('settings.verify.' + (m.verificationStatus || 'none'))}</span>
          ${v.total ? `<span class="muted small">${t('admin.mv.progress').replace('{done}', v.done).replace('{total}', v.total)}</span>` : ''}
          ${v.backInReview ? `<span class="badge badge-pending_payment">${t('admin.mv.backInReview')}</span>` : ''}
          ${v.submitted && !m.emailVerified ? `<span class="badge badge-muted mv-email-chip">${esc(t('admin.filter.email_unconfirmed'))}</span>` : ''}
          ${v.waiting ? `<span class="badge badge-pending_payment">${t('admin.mv.waiting').replace('{n}', v.waiting)}</span>` : ''}
          ${v.openFlags ? `<span class="badge badge-rejected">${t('admin.mv.flagsOpen').replace('{n}', v.openFlags)}</span>` : ''}
          ${v.failedRequired ? `<span class="badge badge-rejected">${t('admin.mv.failedRequired')}</span>` : ''}
          ${v.waitingForId ? `<span class="badge badge-rejected mv-waiting-id">${esc(t('admin.mv.waitingForId'))}</span>
            <button type="button" class="btn btn-outline btn-sm mv-id-reminder">${esc(t('admin.mv.idReminder'))}</button>` : ''}
          ${(m.reviewCount >= 3 && m.ratingAvg < 3.5) ? `<span class="form-error" style="margin:0">${t('admin.lowRatingFlag').replace('{avg}', m.ratingAvg)}</span>` : ''}
          <button class="btn btn-outline btn-sm mv-open" aria-expanded="false">${t('admin.mv.review')}</button>
        </div>
        <div class="mv-body" hidden></div>
      </div>`;
  }

  // mentors: the list from /admin/mentors. onChange: called after any decision so the list can refresh.
  // What the AI reviews cost, which model is used, and whether automatic approval is on (shown above the list).
  async function costLine(el) {
    try {
      const c = await WisecallAPI.apiFetch('/admin/verification/costs');
      el.innerHTML = `<p class="muted small">${esc(fill('admin.ai.costs', { month: usd(c.month.costUsd), budget: usd(c.budgetUsd), n: c.month.reviews, total: usd(c.total.costUsd), avg: usd(c.averageUsd), model: c.model }))}
        · ${t(c.autoApprove ? 'admin.ai.autoOn' : 'admin.ai.autoOff')}${c.aiEnabled ? '' : ' · ' + t('admin.ai.aiOff')}</p>`;
    } catch (e) { el.innerHTML = ''; }
  }

  function render(container, mentors, onChange) {
    // (the one-off "profile update" email to approved mentors: public/js/admin-profile-update.js)
    const costs = '<div class="mv-costs"></div><div class="mv-profile-update"></div>';
    const update = () => { const b = container.querySelector('.mv-profile-update'); if (b && window.AdminProfileUpdate) AdminProfileUpdate.mount(b); };
    if (!mentors.length) { container.innerHTML = costs + `<p class="muted">${t('admin.empty')}</p>`; costLine(container.querySelector('.mv-costs')); update(); return; }
    container.innerHTML = costs + mentors.map(card).join('');
    costLine(container.querySelector('.mv-costs'));
    update();

    container.querySelectorAll('.mv-card').forEach((el) => {
      const id = el.dataset.id;
      // The university badge: confirm (from their pages), remove, or back to automatic.
      el.querySelectorAll('[data-uni]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await WisecallAPI.apiFetch(`/admin/mentors/${id}/university-badge`, { method: 'POST', body: { action: b.dataset.uni } }); WisecallNav.showToast(t('toast.saved')); if (onChange) onChange(); }
        catch (e) { WisecallNav.showToast(t(e.code === 'no_university' ? 'admin.uni.noUniversity' : 'toast.error')); b.disabled = false; }
      }));
      // "Send ID reminder" (at most once in 48 hours per mentor: the server says when the next one is allowed)
      const remind = el.querySelector('.mv-id-reminder');
      if (remind) remind.addEventListener('click', async () => {
        remind.disabled = true;
        try { await WisecallAPI.apiFetch(`/admin/mentors/${id}/id-reminder`, { method: 'POST' }); WisecallNav.showToast(t('admin.mv.idReminderSent')); }
        catch (e) {
          WisecallNav.showToast(e.code === 'too_soon' && e.data && e.data.nextAt
            ? fill('admin.mv.idReminderSoon', { date: WisecallI18n.formatDate(e.data.nextAt, { dateStyle: 'medium', timeStyle: 'short' }) })
            : t('toast.error'));
        }
      });
      const body = el.querySelector('.mv-body');
      const openBtn = el.querySelector('.mv-open');

      let current = null; // (the mentor as last loaded: the one-tap dialog names what it will count)
      async function loadPanel() {
        body.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
        try {
          const d = await WisecallAPI.apiFetch(`/admin/mentors/${id}/verification`);
          current = d;
          body.innerHTML = panelHtml(d);
          wire(d);
          // (their profile items: self-reported unless marked verified here, next to the evidence above)
          if (window.AdminProfiles) {
            const box = document.createElement('details');
            box.className = 'mv-profile-items';
            box.innerHTML = `<summary>${t('admin.pr.itemsTitle')}</summary>${await AdminProfiles.itemsBlock(id)}`;
            body.appendChild(box);
            AdminProfiles.wireItems(box, loadPanel);
          }
        } catch (e) { body.innerHTML = `<p class="muted">${t('toast.error')}</p>`; }
      }

      function wire() {
        body.querySelectorAll('.mv-step').forEach((row) => {
          const step = row.dataset.step;
          const decide = async (decision) => {
            const reason = row.querySelector('.mv-reason').value.trim();
            // (passing needs no reason; failing does, since the mentor reads it)
            if (decision === 'failed' && reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
            try {
              await WisecallAPI.apiFetch(`/admin/mentors/${id}/steps/${step}`, { method: 'POST', body: { decision, ...(reason ? { reason } : {}) } });
              WisecallNav.showToast(t('toast.saved'));
              await loadPanel();
              onChange({ soft: true });
            } catch (e) { WisecallNav.showToast(t(e.code === 'reason_required' ? 'admin.mv.reasonRequired' : 'toast.error')); }
          };
          const pass = row.querySelector('.mv-pass');
          const fail = row.querySelector('.mv-fail');
          if (pass) pass.addEventListener('click', () => decide('passed'));
          if (fail) fail.addEventListener('click', () => decide('failed'));
        });
        body.querySelectorAll('.mv-flag').forEach((el) => {
          el.querySelector('.mv-flag-resolve').addEventListener('click', async () => {
            const reason = el.querySelector('.mv-flag-reason').value.trim();
            if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
            try { await WisecallAPI.apiFetch(`/admin/flags/${el.dataset.flag}/resolve`, { method: 'POST', body: { reason } }); await loadPanel(); onChange({ soft: true }); }
            catch (e) { WisecallNav.showToast(t('toast.error')); }
          });
        });
        body.querySelectorAll('[data-evidence]').forEach((row) => {
          const decide = async (decision) => {
            const reason = row.querySelector('.mv-ev-reason').value.trim();
            if (decision === 'failed' && reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
            try { await WisecallAPI.apiFetch(`/admin/mentors/${id}/evidence/${row.dataset.evidence}`, { method: 'POST', body: { decision, ...(reason ? { reason } : {}) } }); await loadPanel(); onChange({ soft: true }); }
            catch (e) { WisecallNav.showToast(t('toast.error')); }
          };
          const ok = row.querySelector('.mv-ev-ok');
          const no = row.querySelector('.mv-ev-failed');
          if (ok) ok.addEventListener('click', () => decide('ok'));
          if (no) no.addEventListener('click', () => decide('failed'));
        });
        const rerun = body.querySelector('.mv-rerun');
        if (rerun) rerun.addEventListener('click', async () => {
          rerun.disabled = true;
          rerun.textContent = t('admin.ai.running');
          try {
            const r = await WisecallAPI.apiFetch(`/admin/mentors/${id}/analysis`, { method: 'POST' });
            // It runs in the background: check every 2 seconds (for up to 2 minutes) until the new analysis has finished.
            for (let i = 0; i < 60; i++) {
              await new Promise((done) => setTimeout(done, 2000));
              const d = await WisecallAPI.apiFetch(`/admin/mentors/${id}/verification`);
              if (d.analysis && d.analysis.id !== r.previous && d.analysis.status !== 'running') break;
            }
            await loadPanel();
            onChange({ soft: true });
          } catch (e) { WisecallNav.showToast(t('toast.error')); rerun.disabled = false; rerun.textContent = t('admin.ai.rerun'); }
        });
        const ivReq = body.querySelector('.mv-iv-request');
        if (ivReq) ivReq.addEventListener('click', async () => {
          const reason = body.querySelector('.mv-iv-reason').value.trim();
          if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
          ivReq.disabled = true;
          try { await WisecallAPI.apiFetch(`/admin/mentors/${id}/interview/request`, { method: 'POST', body: { reason } }); WisecallNav.showToast(t('toast.saved')); await loadPanel(); onChange({ soft: true }); }
          catch (e) { WisecallNav.showToast(t('toast.error')); ivReq.disabled = false; }
        });
        const priceFree = body.querySelector('.mv-price-free');
        const priceAmount = body.querySelector('.mv-price-amount');
        if (priceFree) priceFree.addEventListener('change', () => { priceAmount.hidden = priceFree.checked; });
        const priceSave = body.querySelector('.mv-price-save');
        if (priceSave) priceSave.addEventListener('click', async () => {
          const reason = body.querySelector('.mv-price-reason').value.trim();
          if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
          const price = priceFree.checked ? 0 : Number(priceAmount.value);
          priceSave.disabled = true;
          try {
            const r = await WisecallAPI.apiFetch(`/admin/mentors/${id}/price`, { method: 'POST', body: { price, reason } });
            WisecallNav.showToast(t(r.payoutNeeded ? 'admin.price.savedPayout' : 'admin.price.saved'));
            await loadPanel(); onChange({ soft: true });
          } catch (e) {
            WisecallNav.showToast(t({ invalid_price: 'admin.price.invalid', same_price: 'admin.price.same', reason_required: 'admin.mv.reasonRequired' }[e.code] || 'toast.error'));
            priceSave.disabled = false;
          }
        });
        const suspendBtn = body.querySelector('.mv-suspend-btn');
        const reinstateBtn = body.querySelector('.mv-reinstate');
        const reinstateApproveBtn = body.querySelector('.mv-reinstate-approve');
        const changeStanding = (btn, path, confirmKey, extra) => async () => {
          const reason = body.querySelector('.mv-suspend-reason').value.trim();
          if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
          const who = el.querySelector('.card-name').textContent;
          if (confirmKey && !(await WisecallDialog.confirm({ message: t(confirmKey).replace('{name}', who), confirmText: t('admin.mv.suspendButton').replace('{name}', who), danger: true }))) return;
          btn.disabled = true;
          try {
            const r = await WisecallAPI.apiFetch(`/admin/mentors/${id}/${path}`, { method: 'POST', body: { reason, ...(extra || {}) } });
            WisecallNav.showToast(t(path === 'reinstate' ? (r.reapproved ? 'admin.mv.reapproved' : 'admin.mv.reinstated') : 'toast.saved'));
            onChange();
          } catch (e) { WisecallNav.showToast(t('toast.error')); btn.disabled = false; }
        };
        if (suspendBtn) suspendBtn.addEventListener('click', changeStanding(suspendBtn, 'suspend', 'admin.mv.suspendConfirm'));
        if (reinstateBtn) reinstateBtn.addEventListener('click', changeStanding(reinstateBtn, 'reinstate'));
        if (reinstateApproveBtn) reinstateApproveBtn.addEventListener('click', changeStanding(reinstateApproveBtn, 'reinstate', null, { reapprove: true }));
        const refresh = body.querySelector('.mv-kyc-refresh');
        if (refresh) refresh.addEventListener('click', async () => {
          refresh.disabled = true;
          try { await WisecallAPI.apiFetch(`/admin/mentors/${id}/kyc/refresh`, { method: 'POST' }); await loadPanel(); onChange({ soft: true }); }
          catch (e) { WisecallNav.showToast(t('toast.error')); refresh.disabled = false; }
        });
        const rerunId = body.querySelector('.mv-kyc-rerun-btn');
        if (rerunId) rerunId.addEventListener('click', async () => {
          const reason = body.querySelector('.mv-kyc-rerun-reason').value.trim();
          if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
          rerunId.disabled = true;
          try {
            const r = await WisecallAPI.apiFetch(`/admin/mentors/${id}/kyc/rerun`, { method: 'POST', body: { reason } });
            WisecallNav.showToast(t('admin.mv.kycRerun.' + r.outcome));
            await loadPanel(); onChange({ soft: true });
          } catch (e) { WisecallNav.showToast(t('toast.error')); rerunId.disabled = false; }
        });
        const fieldSave = body.querySelector('.mv-field-save');
        if (fieldSave) fieldSave.addEventListener('click', async () => {
          const form = body.querySelector('.mv-field');
          fieldSave.disabled = true;
          try {
            await WisecallAPI.apiFetch(`/admin/mentors/${id}/field`, { method: 'POST', body: { text: form.querySelector('.mv-field-text').value, niche: form.querySelector('.mv-field-niche').value, notRegulated: form.querySelector('.mv-field-notreg').checked } });
            WisecallNav.showToast(t('toast.saved'));
            await loadPanel(); onChange({ soft: true });
          } catch (e) {
            const msg = { regulated_words: 'admin.mv.field.regulatedWords', licence_missing: 'admin.mv.field.licenceMissing', invalid_custom_niche: 'ap.err.invalid_custom_niche' }[e.code];
            WisecallNav.showToast(msg ? t(msg).replace('{niche}', e.data && e.data.category ? t('niche.' + e.data.category) : '') : t('toast.error'));
            fieldSave.disabled = false;
          }
        });
        // One tap: one question (what it will count), nothing to type; then what is waiting is passed and the mentor approved.
        const approve = body.querySelector('.mv-approve');
        if (approve) approve.addEventListener('click', async () => {
          const items = oneTapItems(current);
          const name = current.mentor.name;
          const message = items.length ? fill('admin.oneTap.confirmWith', { name, list: items.join(', ') }) : fill('admin.oneTap.confirm', { name });
          if (!(await WisecallDialog.confirm({ message, confirmText: t('admin.oneTap.yes'), cancelText: t('admin.oneTap.no') }))) return;
          approve.disabled = true;
          try {
            await WisecallAPI.apiFetch(`/admin/mentors/${id}/approve`, { method: 'POST', body: { all: true } });
            WisecallNav.showToast(t('admin.oneTap.done'));
            onChange();
          } catch (e) {
            const missing = e.data && e.data.missing;
            WisecallNav.showToast(missing && missing.length ? fill('admin.oneTap.blocked', { list: missing.map(blockText).join(', ') }) : t('toast.error'));
            approve.disabled = false;
          }
        });
        body.querySelector('.mv-reject-btn').addEventListener('click', async () => {
          const reason = body.querySelector('.mv-reject-reason').value.trim();
          if (reason.length < 5) { WisecallNav.showToast(t('admin.reasonRequired')); return; }
          try {
            await WisecallAPI.apiFetch(`/admin/mentors/${id}/reject`, { method: 'POST', body: { reason } });
            WisecallNav.showToast(t('toast.saved'));
            onChange();
          } catch (e) { WisecallNav.showToast(t('toast.error')); }
        });
      }

      openBtn.addEventListener('click', async () => {
        const open = body.hidden;
        body.hidden = !open;
        openBtn.setAttribute('aria-expanded', String(open));
        if (open) await loadPanel();
      });
    });
  }

  window.AdminMentors = { render };
})();
