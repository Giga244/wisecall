// Admin: reviewing mentor applications step by step. Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => new Date(d).toLocaleString(WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
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
            <input type="text" class="mv-reason" maxlength="300" placeholder="${esc(t('admin.mv.reasonPlaceholder'))}" aria-label="${esc(t('admin.mv.reasonPlaceholder'))}">
            <button class="btn btn-primary btn-sm mv-pass">${t('admin.mv.pass')}</button>
            <button class="btn btn-outline btn-sm mv-fail">${t('admin.mv.fail')}</button>
          </div>` : ''}
      </div>`;
  }

  // The person as the ID provider verified them. Only admins ever see this.
  function kycBlock(k) {
    if (!k) return `<p class="muted small">${t('admin.mv.kycNone')}</p>`;
    return `
      <div class="mv-kyc">
        <p><strong>${t('admin.mv.kyc')}</strong> ${esc(k.provider)} · ${t('verify.kyc.' + k.status)}</p>
        ${k.verifiedName ? `<p>${t('admin.mv.kycName')}: <strong>${esc(k.verifiedName)}</strong> · ${t('admin.mv.kycDob')}: ${esc(k.dateOfBirth || '—')} · ${t('admin.mv.kycCountry')}: ${esc(k.country || '—')}</p>` : ''}
        <button class="btn btn-ghost btn-sm mv-kyc-refresh">${t('admin.mv.kycRefresh')}</button>
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
          ${c ? line(t('admin.mv.licenseNumber'), `<strong>${esc(c.licenseNumber || '—')}</strong>`) + line(t('admin.mv.issuingBody'), esc(c.issuingBody)) + line(t('admin.mv.holderName'), esc(c.holderName)) + line(t('admin.mv.validUntil'), esc(c.validUntil || '—')) : ''}
          ${d.workEmail ? line(t('admin.mv.workEmail'), `${esc(d.workEmail.address)} · ${d.workEmail.verifiedAt ? t('admin.mv.workEmailConfirmed') : t('admin.mv.workEmailWaiting')}`) : ''}
        </ul>
        ${docs.length ? `
          <p class="muted small">${t('admin.mv.documents')}: ${t('admin.mv.docsNote')}</p>
          <ul class="mv-docs">${docs.map((f) => `
            <li>
              <span>${esc(stepTitle(f.step))} · ${esc(f.filename)} · ${Math.max(1, Math.round(f.size / 1024))} KB</span>
              <a class="btn btn-outline btn-sm" href="/api/admin/documents/${esc(f.id)}" download>${t('admin.mv.download')}</a>
              ${f.deleteAfter ? `<span class="muted small">${t('admin.mv.deleteOn').replace('{date}', new Date(f.deleteAfter).toLocaleDateString(WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB'))}</span>` : ''}
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
  function panelHtml(d) {
    const rows = d.requirements.map((r) => (r.type === 'step'
      ? stepRow(r)
      : `<div class="mv-group"><p class="muted small"><strong>${t('admin.mv.anyOf')}</strong></p>${r.options.map(stepRow).join('')}</div>`)).join('');
    const total = d.requirements.length;
    const done = d.requirements.filter((r) => (r.type === 'step' ? r.status === 'passed' : r.satisfied)).length;
    return `
      <div class="mv-panel">
        <p class="muted small">${t('admin.mv.progress').replace('{done}', done).replace('{total}', total)}</p>
        <div class="booking-answer"><strong>${t('admin.sampleTitle')}</strong> ${esc(d.mentor.sampleAnswer || '')}</div>
        ${d.mentor.proofUrl ? `<p>${t('admin.mv.proofLink')}: <a href="${esc(d.mentor.proofUrl)}" target="_blank" rel="noopener noreferrer">${esc(d.mentor.proofUrl)}</a></p>` : ''}
        ${d.registries.length ? `<p class="small"><strong>${t('admin.mv.registries')}</strong> ${d.registries.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.label)}</a>`).join(' · ')}</p>` : ''}
        ${flagsBlock(d.flags)}
        ${kycBlock(d.kyc)}
        ${credentialsBlock(d)}
        <div class="mv-steps">${rows}</div>
        <div class="mv-final">
          <button class="btn btn-primary mv-approve" ${d.ready && d.mentor.verificationStatus === 'pending' ? '' : 'disabled'}>${t('admin.approve')}</button>
          ${d.ready ? '' : `<span class="muted small">${t('admin.mv.approveBlocked')}</span>`}
          <div class="mv-reject">
            <input type="text" class="mv-reject-reason" maxlength="500" placeholder="${esc(t('admin.rejectReasonPlaceholder'))}" aria-label="${esc(t('admin.rejectReasonPlaceholder'))}">
            <button class="btn btn-outline btn-sm mv-reject-btn">${t('admin.reject')}</button>
          </div>
        </div>
        <div class="mv-suspend">
          <p class="muted small"><strong>${t('admin.mv.suspendTitle')}</strong></p>
          <div class="mv-decide">
            <input type="text" class="mv-suspend-reason" maxlength="300" placeholder="${esc(t(d.mentor.verificationStatus === 'suspended' ? 'admin.mv.reinstateReason' : 'admin.mv.suspendReason'))}" aria-label="${esc(t(d.mentor.verificationStatus === 'suspended' ? 'admin.mv.reinstateReason' : 'admin.mv.suspendReason'))}">
            ${d.mentor.verificationStatus === 'suspended'
              ? `<button class="btn btn-outline btn-sm mv-reinstate">${t('admin.mv.reinstate')}</button>`
              : `<button class="btn btn-ghost btn-sm mv-suspend-btn">${t('admin.mv.suspend')}</button>`}
          </div>
        </div>
        <details class="mv-audit"><summary>${t('admin.mv.audit')} (${d.audit.length})</summary>
          <ul class="earn-list">${d.audit.map((a) => `<li><span>${fmt(a.at)}</span><span>${esc(a.by || '')} · ${esc(a.action)}${a.step ? ' · ' + esc(stepTitle(a.step)) : ''}</span><span class="muted small">${esc(a.reason || '')}</span></li>`).join('')}</ul>
        </details>
      </div>`;
  }

  function card(m) {
    const v = m.verification || {};
    return `
      <div class="booking-card mv-card" data-id="${m.id}">
        <div class="booking-top">
          <div class="avatar" style="${WisecallAPI.avatarStyle(m.color)}">${esc(initials(m.name))}</div>
          <div>
            <div class="card-name">${esc(m.name)}</div>
            <span class="muted small">${esc(m.email)}</span>
          </div>
          <div class="booking-amount">${m.price ? WisecallAPI.formatPrice(m.price) : '—'}</div>
        </div>
        <p class="booking-question">
          <strong>${esc(m.roleTitle || '—')}</strong> · ${m.niche ? esc(t('niche.' + m.niche)) : '—'}
          <span class="badge badge-paid">${t('verify.level.' + (v.level || 'standard'))}</span>
        </p>
        ${m.verificationNote ? `<p class="muted small">${t('admin.lastNote')}: ${esc(m.verificationNote)}</p>` : ''}
        <div class="review-actions" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:10px;">
          <span class="badge badge-${m.verificationStatus === 'rejected' ? 'rejected' : (m.verificationStatus === 'verified' ? 'answered' : 'pending_payment')}">${t('settings.verify.' + (m.verificationStatus || 'none'))}</span>
          ${v.total ? `<span class="muted small">${t('admin.mv.progress').replace('{done}', v.done).replace('{total}', v.total)}</span>` : ''}
          ${v.waiting ? `<span class="badge badge-pending_payment">${t('admin.mv.waiting').replace('{n}', v.waiting)}</span>` : ''}
          ${v.openFlags ? `<span class="badge badge-rejected">${t('admin.mv.flagsOpen').replace('{n}', v.openFlags)}</span>` : ''}
          ${(m.reviewCount >= 3 && m.ratingAvg < 3.5) ? `<span class="form-error" style="margin:0">${t('admin.lowRatingFlag').replace('{avg}', m.ratingAvg)}</span>` : ''}
          <button class="btn btn-outline btn-sm mv-open" aria-expanded="false">${t('admin.mv.review')}</button>
        </div>
        <div class="mv-body" hidden></div>
      </div>`;
  }

  // mentors: the list from /admin/mentors. onChange: called after any decision so the list can refresh.
  function render(container, mentors, onChange) {
    if (!mentors.length) { container.innerHTML = `<p class="muted">${t('admin.empty')}</p>`; return; }
    container.innerHTML = mentors.map(card).join('');

    container.querySelectorAll('.mv-card').forEach((el) => {
      const id = el.dataset.id;
      const body = el.querySelector('.mv-body');
      const openBtn = el.querySelector('.mv-open');

      async function loadPanel() {
        body.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
        try {
          const d = await WisecallAPI.apiFetch(`/admin/mentors/${id}/verification`);
          body.innerHTML = panelHtml(d);
          wire(d);
        } catch (e) { body.innerHTML = `<p class="muted">${t('toast.error')}</p>`; }
      }

      function wire() {
        body.querySelectorAll('.mv-step').forEach((row) => {
          const step = row.dataset.step;
          const decide = async (decision) => {
            const reason = row.querySelector('.mv-reason').value.trim();
            if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
            try {
              await WisecallAPI.apiFetch(`/admin/mentors/${id}/steps/${step}`, { method: 'POST', body: { decision, reason } });
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
        const suspendBtn = body.querySelector('.mv-suspend-btn');
        const reinstateBtn = body.querySelector('.mv-reinstate');
        const changeStanding = (btn, path, confirmKey) => async () => {
          const reason = body.querySelector('.mv-suspend-reason').value.trim();
          if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
          if (confirmKey && !window.confirm(t(confirmKey).replace('{name}', el.querySelector('.card-name').textContent))) return;
          btn.disabled = true;
          try { await WisecallAPI.apiFetch(`/admin/mentors/${id}/${path}`, { method: 'POST', body: { reason } }); WisecallNav.showToast(t('toast.saved')); onChange(); }
          catch (e) { WisecallNav.showToast(t('toast.error')); btn.disabled = false; }
        };
        if (suspendBtn) suspendBtn.addEventListener('click', changeStanding(suspendBtn, 'suspend', 'admin.mv.suspendConfirm'));
        if (reinstateBtn) reinstateBtn.addEventListener('click', changeStanding(reinstateBtn, 'reinstate'));
        const refresh = body.querySelector('.mv-kyc-refresh');
        if (refresh) refresh.addEventListener('click', async () => {
          refresh.disabled = true;
          try { await WisecallAPI.apiFetch(`/admin/mentors/${id}/kyc/refresh`, { method: 'POST' }); await loadPanel(); onChange({ soft: true }); }
          catch (e) { WisecallNav.showToast(t('toast.error')); refresh.disabled = false; }
        });
        const approve = body.querySelector('.mv-approve');
        if (approve) approve.addEventListener('click', async () => {
          approve.disabled = true;
          try {
            await WisecallAPI.apiFetch(`/admin/mentors/${id}/approve`, { method: 'POST' });
            WisecallNav.showToast(t('toast.saved'));
            onChange();
          } catch (e) {
            WisecallNav.showToast(t(e.code === 'steps_incomplete' ? 'admin.mv.approveBlocked' : 'toast.error'));
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
