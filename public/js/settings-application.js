// Settings: the "Mentor application" card at the top (docs/CLAUDE-CODE-ONE-APPLY-PATH.md). The application itself lives in one place,
// /apply.html; Settings only says where it stands, in plain words, with one button that opens it at the right step:
//   none      not started (someone who is not a mentor applicant)    "Start my application"
//   draft     step X of 5                                             "Continue – step X of 5"
//   sent      sent, under review                                      "See my application"
//   fix       a required step failed: named in one sentence           "Continue – step X of 5" or "See my application"
//   rejected  not approved, with the reason when one was given        "See my application"
// An approved mentor (or a suspended one) and an admin get no card. Loaded by settings.html before settings.js.
(function () {
  // user: /api/me's user (role, isAdmin, verificationStatus, applicationSubmittedAt, verificationNote, mentorPath). verification: GET
  // /verification (its requirements say which step failed), or null. -> what the card says, or null for no card.
  function view(user, verification) {
    if (!user || user.isAdmin) return null;
    if (user.role !== 'mentor' && user.role !== 'both') return { state: 'none', button: { key: 'settings.app.start', href: '/apply.html' } };
    const status = user.verificationStatus;
    if (status === 'verified' || status === 'suspended') return null;
    const failed = verification && (verification.requirements || []).find((r) => r.status === 'failed');
    const fix = failed ? failed.step : null;
    if (status === 'rejected') return { state: 'rejected', reason: user.verificationNote || null, fix: null, button: { key: 'settings.app.see', href: '/apply.html' } };
    const path = user.mentorPath || {};
    const sent = path.state === 'sent' || (status === 'pending' && Boolean(user.applicationSubmittedAt));
    if (sent) return { state: fix ? 'fix' : 'sent', fix, button: { key: 'settings.app.see', href: '/apply.html' } };
    // (an ID check to take again is step 5)
    const step = fix === 'id_kyc' || fix === 'age' ? 5 : (path.step || 1);
    return { state: fix ? 'fix' : 'draft', step, fix, button: { key: 'settings.app.continue', step, href: `/apply.html?step=${step}` } };
  }

  const TONE = { none: 'badge-muted', draft: 'badge-pending_payment', sent: 'badge-pending_payment', fix: 'badge-rejected', rejected: 'badge-rejected' };

  // -> the card's HTML ('' for no card). t: the dictionary; days: how many working days a review takes.
  function html(card, t, days) {
    if (!card) return '';
    const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
    const label = card.state === 'draft' ? fill('settings.app.state.draft', { n: card.step }) : t('settings.app.state.' + card.state);
    const text = { none: t('settings.app.text.none'), draft: t('settings.app.text.draft'), sent: fill(days === 1 ? 'apply.done.body1' : 'apply.done.body', { days }),
      fix: t('settings.app.text.fix'), rejected: t('settings.app.text.rejected') }[card.state];
    const button = card.button.key === 'settings.app.continue' ? fill('settings.app.continue', { n: card.button.step }) : t(card.button.key);
    return `
      <div class="app-progress-head">
        <strong>${esc(t('settings.progress.title'))}</strong>
        <span class="badge ${TONE[card.state]}" data-app-state="${card.state}">${esc(label)}</span>
      </div>
      ${card.state === 'draft' ? `<div class="vt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${card.step - 1}" aria-label="${esc(label)}"><span style="width:${((card.step - 1) / 5) * 100}%"></span></div>` : ''}
      ${card.fix ? `<p class="app-progress-failed" role="alert">${esc(t('settings.failed.' + card.fix))}${card.fix === 'name_match' ? ` <button type="button" class="linklike" data-goto-tab="profile">${esc(t('ap.name.fix'))}</button>` : ''}</p>` : ''}
      ${card.reason ? `<p class="app-card-reason"><strong>${esc(t('vt.reason'))}</strong> ${esc(card.reason)}</p>` : ''}
      <p class="app-card-text">${esc(text)}</p>
      <p class="app-card-action"><a class="btn btn-primary" href="${esc(card.button.href)}" data-app-button>${esc(button)}</a></p>`;
  }

  window.WisecallApplicationCard = { view, html };
})();
