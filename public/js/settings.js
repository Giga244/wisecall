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
  const payoutsBox = document.getElementById('payoutsBox');
  const payoutsStatus = document.getElementById('payoutsStatus');
  const connectBtn = document.getElementById('connectBtn');

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
    let html = `<span class="badge ${info.cls}">${t(info.key)}</span>`;
    if (status === 'rejected' && u.verificationNote) {
      html += `<p class="muted small" style="margin-top:8px">${escapeHtml(u.verificationNote)}</p>`;
    }
    verificationBox.innerHTML = html;
    verificationBox.style.display = 'block';
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
    payoutsBox.style.display = isMentor ? 'block' : 'none';
    roleTitleInput.value = u.roleTitle || '';
    nicheSelect.value = u.niche || 'business';
    priceInput.value = u.price || '';
    proofUrlInput.value = u.proofUrl || '';
    sampleInput.value = u.sampleAnswer || '';
    renderVerification(u);
  }

  fillForm(user);

  async function refreshPayoutStatus() {
    if (!(user.role === 'mentor' || user.role === 'both')) return;
    try {
      const status = await WisecallAPI.apiFetch('/connect/status');
      if (!status.enabled) {
        payoutsStatus.textContent = t('settings.payouts.disabled');
        connectBtn.style.display = 'none';
      } else if (status.payoutsReady) {
        payoutsStatus.textContent = t('settings.payouts.connected');
        connectBtn.style.display = 'none';
      } else {
        payoutsStatus.textContent = t(user.verificationStatus === 'verified' ? 'settings.payouts.needForListing' : 'settings.payouts.notConnected');
        connectBtn.style.display = 'inline-flex';
      }
    } catch (e) { /* ignore */ }
  }
  refreshPayoutStatus();

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
      payoutsBox.style.display = checked ? 'block' : 'none';
      Object.assign(user, data.user);
      renderVerification(user);
      refreshPayoutStatus();
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

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    try {
      const data = await WisecallAPI.apiFetch('/connect/onboard', { method: 'POST' });
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      payoutsStatus.textContent = (e.message2) || t('toast.error');
      connectBtn.disabled = false;
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

  const params = new URLSearchParams(location.search);
  if (params.get('connect') === 'success') {
    WisecallNav.showToast(t('settings.payouts.connected'));
    refreshPayoutStatus();
  }
})();
