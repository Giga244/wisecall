(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;

  if (!user) {
    window.location.href = '/login.html?redirect=/settings.html';
    return;
  }

  const becomeMentorCheckbox = document.getElementById('becomeMentor');
  const mentorForm = document.getElementById('mentorForm');
  const priceInput = document.getElementById('price');
  const verificationBox = document.getElementById('verificationBox');
  const payoutCard = document.getElementById('payoutCard');
  const payoutForm = document.getElementById('payoutForm');
  const payoutNameInput = document.getElementById('payoutName');
  const payoutIbanInput = document.getElementById('payoutIban');
  const payoutError = document.getElementById('payoutError');
  const payoutStatus = document.getElementById('payoutStatus');

  function renderVerification(u) {
    const isMentor = u.role === 'mentor' || u.role === 'both';
    if (!isMentor) { verificationBox.style.display = 'none'; return; }
    // (verificationState, from the server: the same state as the steps, so an approved mentor with a failed step shows "Needs attention")
    const status = u.verificationState || u.verificationStatus || 'none';
    const map = {
      none: { cls: 'badge-pending_payment', key: 'settings.verify.none' },
      pending: { cls: 'badge-pending_payment', key: 'settings.verify.none' },
      in_review: { cls: 'badge-pending_payment', key: 'settings.verify.pending' },
      needs_attention: { cls: 'badge-rejected', key: 'settings.verify.needs_attention' },
      verified: { cls: 'badge-answered', key: 'settings.verify.verified' },
      rejected: { cls: 'badge-rejected', key: 'settings.verify.rejected' },
      suspended: { cls: 'badge-rejected', key: 'settings.verify.suspended' }
    };
    const info = map[status] || map.none;
    const needsPayout = status === 'verified' && !u.hasPayoutDetails;
    let html = `<span class="badge ${info.cls}">${t(needsPayout ? 'settings.verify.approvedNoPayout' : info.key)}</span>`;
    if (status === 'rejected' && u.verificationNote) {
      html += `<p class="muted small" style="margin-top:8px">${escapeHtml(u.verificationNote)}</p>`;
    }
    // Approved mentors only appear in Browse experts once their payout details are saved.
    if (status === 'verified' && !u.hasPayoutDetails) {
      html += `<p class="form-error" style="margin-top:8px">${t('settings.payouts.needForListing')}</p>`;
    }
    html += `<p style="margin-top:10px"><button type="button" class="btn btn-outline btn-sm" data-goto-tab="verification">${t('vt.viewProgress')}</button></p>`;
    verificationBox.innerHTML = html;
    verificationBox.style.display = 'block';
  }
  verificationBox.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-goto-tab]');
    if (btn) selectTab(btn.dataset.gotoTab, { focus: true });
  });

  function isMentorUser(u) { return u.role === 'mentor' || u.role === 'both'; }

  async function loadPayout() {
    payoutCard.style.display = isMentorUser(user) ? 'block' : 'none';
    const balanceBox = document.getElementById('balanceSettings');
    balanceBox.hidden = !isMentorUser(user);
    if (!isMentorUser(user)) return;
    WisecallBalance.render(balanceBox);
    try {
      const data = await WisecallAPI.apiFetch('/me/payout');
      payoutNameInput.value = data.name || '';
      payoutIbanInput.value = data.iban || '';
      payoutStatus.textContent = data.hasPayoutDetails ? t('settings.payouts.saved') : t('settings.payouts.notSaved');
      document.getElementById('payoutPasswordField').hidden = !user.hasPassword;
      document.getElementById('payoutReauth').hidden = Boolean(user.hasPassword);
      if (user.payoutHoldUntil && new Date(user.payoutHoldUntil) > new Date()) {
        payoutStatus.textContent += ' ' + t('settings.payouts.held').replace('{date}', WisecallI18n.formatDate(user.payoutHoldUntil, { dateStyle: 'medium', timeStyle: 'short' }));
      }
    } catch (e) { /* the form still works */ }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fillForm(u) {
    const isMentor = u.role === 'mentor' || u.role === 'both';
    becomeMentorCheckbox.checked = isMentor;
    mentorForm.style.display = isMentor ? 'grid' : 'none';
    priceInput.value = u.price || '';
    renderVerification(u);
  }

  // ---- Tabs: Profile, Mentor, Verification, Payouts, Account -------------------------------------------
  const tabList = document.getElementById('settingsTabs');
  const tabButtons = Array.from(tabList.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  let activeTab = null;

  function selectTab(name, opts) {
    const o = opts || {};
    const btn = tabButtons.find((b) => b.dataset.tab === name && !b.hidden) || tabButtons[0];
    activeTab = btn.dataset.tab;
    tabButtons.forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' }); // on a phone the tab row scrolls: keep the chosen tab in view
    panels.forEach((p) => { p.hidden = p.dataset.panel !== activeTab; });
    if (o.push !== false) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', activeTab);
      window.history.replaceState(null, '', url);
    }
    if (o.focus) btn.focus();
    if (activeTab === 'notifications') drawNotificationSettings();
    if (activeTab === 'verification') SettingsVerification.init(document.getElementById('verificationPanel'), { user, goto: (n) => selectTab(n, { focus: true }) });
  }

  // Settings -> Notifications: the transactional emails are listed (they cannot be turned off); the optional ones are switches.
  async function drawNotificationSettings() {
    const box = document.getElementById('notificationsPanel');
    let s;
    try { s = await WisecallAPI.apiFetch('/inbox/email-settings'); } catch (e) { box.innerHTML = `<p class="muted">${escapeHtml(t('toast.error'))}</p>`; return; }
    box.innerHTML = `
      <h2>${escapeHtml(t('settings.notif.title'))}</h2>
      <p>${escapeHtml(t('settings.notif.always'))}</p>
      <p><strong>${escapeHtml(t('settings.notif.optional'))}</strong></p>
      ${s.optional.map((o) => `<label class="checkbox-row"><input type="checkbox" data-email-opt="${escapeHtml(o.key)}"${o.on ? ' checked' : ''}> <span>${escapeHtml(t('settings.notif.' + o.key))}</span></label>`).join('')}
      <p class="muted small">${escapeHtml(t('settings.notif.inbox'))} <a href="/inbox.html">${escapeHtml(t('nav.inbox'))}</a></p>`;
    box.querySelectorAll('[data-email-opt]').forEach((cb) => cb.addEventListener('change', async () => {
      const off = [...box.querySelectorAll('[data-email-opt]')].filter((x) => !x.checked).map((x) => x.dataset.emailOpt);
      try { await WisecallAPI.apiFetch('/inbox/email-settings', { method: 'PUT', body: { off } }); WisecallNav.showToast(t('settings.notif.saved')); }
      catch (e) { cb.checked = !cb.checked; WisecallNav.showToast(t('toast.error')); }
    }));
  }

  // Verification and Payouts only exist for mentors.
  function updateTabVisibility() {
    const mentor = isMentorUser(user);
    tabButtons.forEach((b) => { if (b.hasAttribute('data-mentor-only')) b.hidden = !mentor; });
    if (activeTab && tabButtons.find((b) => b.dataset.tab === activeTab).hidden) selectTab('profile');
  }

  tabList.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.tab');
    if (btn) selectTab(btn.dataset.tab);
  });
  tabList.addEventListener('keydown', (ev) => {
    const visible = tabButtons.filter((b) => !b.hidden);
    const i = visible.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: visible.length - 1 }[ev.key];
    if (next === undefined) return;
    ev.preventDefault();
    selectTab(visible[(next + visible.length) % visible.length].dataset.tab, { focus: true });
  });

  // ---- Mentor application progress, shown above the tabs ------------------------------------------------------------
  const progressBox = document.getElementById('appProgress');
  let lastVerification = null;
  function drawProgress(fresh) {
    if (fresh) lastVerification = fresh;
    if (!isMentorUser(user) || !lastVerification) { progressBox.hidden = true; return; }
    const v = lastVerification;
    const passed = (s) => (v.requirements.find((r) => r.step === s) || {}).status === 'passed';
    const app = v.application || { locked: false, stage: 'not_submitted' };
    const total = 3;
    const done = [['email', 'id_kyc', 'age', 'name_match'].every(passed), app.locked, app.stage === 'approved'].filter(Boolean).length;
    const pct = Math.round((done / total) * 100);
    const status = v.state || v.status; // (the same state as the steps)
    const verified = status === 'verified';
    const tone = verified ? 'answered' : (['rejected', 'suspended', 'needs_attention'].includes(status) ? 'rejected' : 'pending_payment');
    const label = verified ? (WisecallI18n.launchMode() === 'prelaunch' ? 'vt.status.verifiedPrelaunch' : 'vt.status.verifiedListed')
      : ({ suspended: 'vt.status.suspended', rejected: 'vt.status.rejected', needs_attention: 'vt.status.needsAttention' }[status] || (app.locked ? 'ap.status.inReview' : 'vt.status.pending'));
    const text = t('ap.progressText').replace('{done}', done).replace('{total}', total);
    progressBox.hidden = false;
    progressBox.innerHTML = `
      <div class="app-progress-head">
        <strong>${t('settings.progress.title')}</strong>
        <span class="badge badge-${tone}">${t(verified && !user.hasPayoutDetails ? 'vt.status.verifiedNoPayout' : label)}</span>
      </div>
      <div class="vt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="${escapeHtml(text)}"><span style="width:${pct}%"></span></div>
      <p class="small app-progress-foot"><strong>${escapeHtml(text)}</strong>
        ${verified ? '' : `<button type="button" class="linklike" data-goto-tab="verification">${t(app.locked && status !== 'needs_attention' ? 'settings.progress.status' : 'settings.progress.continue')}</button>`}</p>`;
  }
  progressBox.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-goto-tab]');
    if (btn) selectTab(btn.dataset.gotoTab, { focus: true });
  });
  document.addEventListener('wisecall:verification-changed', (ev) => drawProgress(ev.detail));
  document.addEventListener('wisecall:lang-changed', () => drawProgress());
  async function loadProgress() {
    if (!isMentorUser(user)) { progressBox.hidden = true; return; }
    try { drawProgress(await WisecallAPI.apiFetch('/verification')); } catch (e) { /* the tab still works */ }
  }

  AuthUI.init();
  fillForm(user);
  SettingsProfile.init(user);
  SettingsAccounts.init();
  loadPayout();
  updateTabVisibility();
  selectTab(new URLSearchParams(window.location.search).get('tab') || 'profile', { push: false });
  // Show the tabs once the progress box above them is drawn (or after 2 s at most), so nothing jumps down.
  const main = document.getElementById('main');
  Promise.race([loadProgress(), new Promise((r) => setTimeout(r, 2000))]).finally(() => main.removeAttribute('data-loading'));
  document.addEventListener('wisecall:lang-changed', () => { if (activeTab === 'verification') SettingsVerification.reload(); });

  payoutForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    payoutError.textContent = '';
    try {
      const passwordInput = document.getElementById('payoutPassword');
      const data = await WisecallAPI.apiFetch('/me/payout', { method: 'PUT', body: { name: payoutNameInput.value, iban: payoutIbanInput.value, currentPassword: passwordInput.value } });
      passwordInput.value = '';
      Object.assign(user, data.user);
      loadPayout();
      payoutIbanInput.value = data.iban;
      payoutNameInput.value = data.name;
      payoutStatus.textContent = t('settings.payouts.saved');
      renderVerification(user);
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) {
      const map = { invalid_iban: 'settings.payouts.err.iban', invalid_payout_name: 'settings.payouts.err.name', password_required: 'settings.payouts.err.password', wrong_password: 'settings.payouts.err.wrongPassword', reauth_required: 'settings.payouts.reauth', too_many_requests: 'settings.payouts.err.tooMany' };
      payoutError.textContent = t(map[e.code] || 'toast.error');
    }
  });

  becomeMentorCheckbox.addEventListener('change', async () => {
    const checked = becomeMentorCheckbox.checked;
    try {
      const data = await WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { becomeMentor: checked } });
      mentorForm.style.display = checked ? 'grid' : 'none';
      Object.assign(user, data.user);
      renderVerification(user);
      loadPayout();
      updateTabVisibility();
      loadProgress();
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) {
      becomeMentorCheckbox.checked = !checked;
      WisecallNav.showToast(t('toast.error'));
    }
  });

  mentorForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const data = await WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { price: Number(priceInput.value) } });
      Object.assign(user, data.user);
      renderVerification(user);
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) {
      WisecallNav.showToast(t(e.code === 'invalid_price' ? 'settings.mentor.price.invalid' : 'toast.error'));
    }
  });
  mentorForm.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-goto-tab]');
    if (btn) selectTab(btn.dataset.gotoTab, { focus: true });
  });

  document.getElementById('passwordForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errorEl = document.getElementById('passwordError');
    errorEl.textContent = '';
    try {
      await WisecallAPI.apiFetch('/me/password', {
        method: 'POST',
        body: {
          currentPassword: document.getElementById('currentPassword').value,
          newPassword: document.getElementById('newPassword').value
        }
      });
      ev.target.reset();
      document.dispatchEvent(new CustomEvent('wisecall:password-set'));
      WisecallNav.showToast(t('toast.passwordUpdated'));
    } catch (e) {
      errorEl.textContent = t({ wrong_password: 'settings.password.wrong', password_breached: 'auth.error.breached' }[e.code] || 'settings.password.error');
    }
  });

  document.querySelectorAll('.lang-toggle-lg .lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { language: btn.dataset.lang } }).catch(() => {});
    });
  });

})();
