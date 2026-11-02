(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;

  if (!user) {
    window.location.href = '/login.html?redirect=/settings.html';
    return;
  }

  const mentorForm = document.getElementById('mentorForm');
  const priceInput = document.getElementById('price');
  const payoutCard = document.getElementById('payoutCard');
  const payoutForm = document.getElementById('payoutForm');
  const payoutNameInput = document.getElementById('payoutName');
  const payoutIbanInput = document.getElementById('payoutIban');
  const payoutError = document.getElementById('payoutError');
  const payoutStatus = document.getElementById('payoutStatus');

  function isMentorUser(u) { return u.role === 'mentor' || u.role === 'both'; }
  // An approved mentor (or a suspended one): their Mentor and Verification tabs. Someone applying has the card above the tabs instead.
  function isApprovedMentor(u) { return isMentorUser(u) && ['verified', 'suspended'].includes(u.verificationStatus); }

  // No payout details yet: a mentor who answers for free needs none, one with a price needs them to be listed.
  const payoutMissing = () => t(user.price === 0 ? 'settings.payouts.notSavedFree' : 'settings.payouts.notSaved');

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
      payoutStatus.textContent = data.hasPayoutDetails ? t('settings.payouts.saved') : payoutMissing();
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

  // "Answer for free" (price 0, with a weekly number) or "Set a price" (docs/CLAUDE-CODE-FREE-ANSWERS.md).
  const priceMode = () => (mentorForm.querySelector('input[name="priceMode"]:checked') || {}).value;
  function showPriceMode() {
    const free = priceMode() === 'free';
    document.getElementById('pricePaidBox').hidden = free;
    document.getElementById('priceFreeBox').hidden = !free;
    priceInput.required = !free;
  }
  function fillForm(u) {
    priceInput.value = u.price || '';
    mentorForm.querySelector(`input[name="priceMode"][value="${u.price === 0 ? 'free' : 'paid'}"]`).checked = true;
    document.getElementById('freeWeeklyCap').value = u.freeWeeklyCap || 10;
    showPriceMode();
    document.getElementById('publicAnswersPref').value = u.publicAnswersPref || 'ask';
    document.getElementById('showOnHome').checked = Boolean(u.showOnHome);
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
    btn.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'auto' }); // (the chosen tab stays in view)
    panels.forEach((p) => { p.hidden = p.dataset.panel !== activeTab; });
    if (o.push !== false) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', activeTab);
      window.history.replaceState(null, '', url);
    }
    if (o.focus) btn.focus();
    if (activeTab === 'notifications') drawNotificationSettings();
    if (activeTab === 'details') SettingsDetails.init(document.getElementById('detailsPanel'), { user, goto: (n) => selectTab(n, { focus: true }) });
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

  // Payouts exist for every mentor (applying or approved); the Mentor and Verification tabs for an approved mentor only (no tab is ever
  // empty: the application itself is at /apply.html).
  function updateTabVisibility() {
    const mentor = isMentorUser(user);
    const approved = isApprovedMentor(user);
    tabButtons.forEach((b) => {
      if (b.hasAttribute('data-mentor-only')) b.hidden = !mentor;
      if (b.hasAttribute('data-approved-only')) b.hidden = !approved;
    });
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

  // ---- The mentor application, above the tabs: where it stands and one button to /apply.html (public/js/settings-application.js) --------
  const progressBox = document.getElementById('appProgress');
  let lastVerification = null;
  let reviewDays = 2;
  function drawProgress() {
    const card = WisecallApplicationCard.view(user, lastVerification);
    progressBox.hidden = !card;
    progressBox.innerHTML = WisecallApplicationCard.html(card, t, reviewDays);
    if (window.WisecallIdCard) WisecallIdCard.wire(progressBox);
  }
  progressBox.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-goto-tab]');
    if (btn) selectTab(btn.dataset.gotoTab, { focus: true });
  });
  document.addEventListener('wisecall:lang-changed', () => drawProgress());
  async function loadProgress() {
    try { reviewDays = (await WisecallI18n.getConfig()).mentorReviewDays || 2; } catch (e) { /* 2 */ }
    // (which step failed, if one did: only someone applying has a /verification to ask)
    if (isMentorUser(user) && !isApprovedMentor(user)) { try { lastVerification = await WisecallAPI.apiFetch('/verification'); } catch (e) { /* the card without it */ } }
    drawProgress();
  }

  AuthUI.init();
  fillForm(user);
  SettingsProfile.init(user);
  if (window.WisecallProfileSections) WisecallProfileSections.init(user);
  SettingsAccounts.init();
  loadPayout();
  updateTabVisibility();
  selectTab(new URLSearchParams(window.location.search).get('tab') || 'profile', { push: false });
  // Show the tabs once the progress box above them is drawn (or after 2 s at most), so nothing jumps down.
  const main = document.getElementById('main');
  Promise.race([loadProgress(), new Promise((r) => setTimeout(r, 2000))]).finally(() => main.removeAttribute('data-loading'));
  document.addEventListener('wisecall:lang-changed', () => { if (activeTab === 'verification') SettingsVerification.reload(); if (activeTab === 'details') SettingsDetails.reload(); });

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
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) {
      const map = { invalid_iban: 'settings.payouts.err.iban', invalid_payout_name: 'settings.payouts.err.name', password_required: 'settings.payouts.err.password', wrong_password: 'settings.payouts.err.wrongPassword', reauth_required: 'settings.payouts.reauth', too_many_requests: 'settings.payouts.err.tooMany' };
      payoutError.textContent = t(map[e.code] || 'toast.error');
    }
  });

  mentorForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const body = priceMode() === 'free' ? { price: 0, freeWeeklyCap: Number(document.getElementById('freeWeeklyCap').value) } : { price: Number(priceInput.value) };
      const data = await WisecallAPI.apiFetch('/me', { method: 'PATCH', body });
      Object.assign(user, data.user);
      // (no payout details: the Payouts tab says whether they are needed, which a change between free and a price changes)
      if (!user.hasPayoutDetails) payoutStatus.textContent = payoutMissing();
      // From free to a price: payout details are needed now, to stay in Browse experts.
      if (data.payoutNeeded) { WisecallNav.showToast(t('settings.payouts.neededForPrice')); selectTab('payouts'); return; }
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) {
      WisecallNav.showToast(t(e.code === 'invalid_price' ? 'settings.mentor.price.invalid' : (e.code === 'invalid_free_cap' ? 'price.cap.invalid' : 'toast.error')));
    }
  });
  mentorForm.querySelectorAll('input[name="priceMode"]').forEach((r) => r.addEventListener('change', showPriceMode));
  document.getElementById('showOnHome').addEventListener('change', async (ev) => {
    try {
      const data = await WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { showOnHome: ev.target.checked } });
      Object.assign(user, data.user);
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) { ev.target.checked = !ev.target.checked; WisecallNav.showToast(t('toast.error')); }
  });
  document.getElementById('publicAnswersPref').addEventListener('change', async (ev) => {
    try {
      const data = await WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { publicAnswersPref: ev.target.value } });
      Object.assign(user, data.user);
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) { WisecallNav.showToast(t('toast.error')); }
  });
  mentorForm.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-goto-tab]');
    if (btn) selectTab(btn.dataset.gotoTab, { focus: true });
  });

  document.getElementById('passwordForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errorEl = document.getElementById('passwordError');
    const codeField = document.getElementById('passwordCodeField');
    errorEl.textContent = '';
    try {
      await WisecallAPI.apiFetch('/me/password', {
        method: 'POST',
        body: {
          currentPassword: document.getElementById('currentPassword').value,
          newPassword: document.getElementById('newPassword').value,
          ...(codeField.hidden ? {} : { code: document.getElementById('passwordCode').value })
        }
      });
      ev.target.reset();
      codeField.hidden = true;
      document.dispatchEvent(new CustomEvent('wisecall:password-set'));
      WisecallNav.showToast(t('toast.passwordUpdated'));
    } catch (e) {
      // (a first password on an account made with Google: a sign-in in the last minutes, and the code when two-step verification is on)
      if (e.code === 'code_required') { codeField.hidden = false; document.getElementById('passwordCode').focus(); }
      errorEl.textContent = t({ wrong_password: 'settings.password.wrong', password_breached: 'auth.error.breached', reauth_required: 'settings.data.googleReauth',
        code_required: 'auth.twoStep.help', invalid_code: 'auth.twoStep.wrong', locked: 'auth.twoStep.locked' }[e.code] || 'settings.password.error');
    }
  });

  document.querySelectorAll('.lang-toggle-lg .lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { language: btn.dataset.lang } }).catch(() => {});
    });
  });

})();
