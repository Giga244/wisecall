(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;

  if (!user) {
    window.location.href = '/login.html?redirect=/settings.html';
    return;
  }

  const nameInput = document.getElementById('name');
  const bioInput = document.getElementById('bio');
  const becomeMentorCheckbox = document.getElementById('becomeMentor');
  const mentorForm = document.getElementById('mentorForm');
  const roleTitleInput = document.getElementById('roleTitle');
  const nicheSelect = document.getElementById('niche');
  const priceInput = document.getElementById('price');
  const proofUrlInput = document.getElementById('proofUrl');
  const sampleInput = document.getElementById('sampleAnswer');
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
    const status = u.verificationStatus || 'none';
    const map = {
      none: { cls: 'badge-pending_payment', key: 'settings.verify.none' },
      pending: { cls: 'badge-pending_payment', key: 'settings.verify.pending' },
      verified: { cls: 'badge-answered', key: 'settings.verify.verified' },
      rejected: { cls: 'badge-rejected', key: 'settings.verify.rejected' }
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
    if (!isMentorUser(user)) return;
    try {
      const data = await WisecallAPI.apiFetch('/me/payout');
      payoutNameInput.value = data.name || '';
      payoutIbanInput.value = data.iban || '';
      payoutStatus.textContent = data.hasPayoutDetails ? t('settings.payouts.saved') : t('settings.payouts.notSaved');
    } catch (e) { /* the form still works */ }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fillForm(u) {
    nameInput.value = u.name || '';
    bioInput.value = u.bio || '';
    const isMentor = u.role === 'mentor' || u.role === 'both';
    becomeMentorCheckbox.checked = isMentor;
    mentorForm.style.display = isMentor ? 'grid' : 'none';
    roleTitleInput.value = u.roleTitle || '';
    nicheSelect.value = u.niche || 'business';
    priceInput.value = u.price || '';
    proofUrlInput.value = u.proofUrl || '';
    sampleInput.value = u.sampleAnswer || '';
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
    panels.forEach((p) => { p.hidden = p.dataset.panel !== activeTab; });
    if (o.push !== false) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', activeTab);
      window.history.replaceState(null, '', url);
    }
    if (o.focus) btn.focus();
    if (activeTab === 'verification') SettingsVerification.init(document.getElementById('verificationPanel'), { user, goto: (n) => selectTab(n, { focus: true }) });
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

  fillForm(user);
  loadPayout();
  updateTabVisibility();
  selectTab(new URLSearchParams(window.location.search).get('tab') || 'profile', { push: false });
  document.addEventListener('wisecall:lang-changed', () => { if (activeTab === 'verification') SettingsVerification.reload(); });

  payoutForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    payoutError.textContent = '';
    try {
      const data = await WisecallAPI.apiFetch('/me/payout', { method: 'PUT', body: { name: payoutNameInput.value, iban: payoutIbanInput.value } });
      Object.assign(user, data.user);
      payoutIbanInput.value = data.iban;
      payoutNameInput.value = data.name;
      payoutStatus.textContent = t('settings.payouts.saved');
      renderVerification(user);
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) {
      const map = { invalid_iban: 'settings.payouts.err.iban', invalid_payout_name: 'settings.payouts.err.name' };
      payoutError.textContent = t(map[e.code] || 'toast.error');
    }
  });

  document.getElementById('profileForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await WisecallAPI.apiFetch('/me', {
        method: 'PATCH',
        body: { name: nameInput.value.trim(), bio: bioInput.value.trim() }
      });
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) {
      WisecallNav.showToast(t('toast.error'));
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
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) {
      becomeMentorCheckbox.checked = !checked;
      WisecallNav.showToast(t('toast.error'));
    }
  });

  mentorForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const data = await WisecallAPI.apiFetch('/me', {
        method: 'PATCH',
        body: {
          roleTitle: roleTitleInput.value.trim(),
          niche: nicheSelect.value,
          price: Number(priceInput.value),
          proofUrl: proofUrlInput.value.trim(),
          sampleAnswer: sampleInput.value.trim()
        }
      });
      Object.assign(user, data.user);
      renderVerification(user);
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) {
      const map = {
        invalid_proof_url: 'settings.mentor.proofUrl.invalid',
        proof_required: 'settings.mentor.proofUrl.required',
        sample_required: 'settings.mentor.sample.required',
        email_not_verified: 'settings.mentor.emailNotVerified'
      };
      WisecallNav.showToast(t(map[e.code] || 'toast.error'));
    }
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
      WisecallNav.showToast(t('toast.passwordUpdated'));
    } catch (e) {
      errorEl.textContent = t(e.code === 'wrong_password' ? 'settings.password.wrong' : 'settings.password.error');
    }
  });

  document.querySelectorAll('.lang-toggle-lg .lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { language: btn.dataset.lang } }).catch(() => {});
    });
  });

})();
