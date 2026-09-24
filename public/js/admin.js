(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;

  if (!user) {
    window.location.href = '/login.html?redirect=/admin.html';
    return;
  }

  const content = document.getElementById('adminContent');
  const filters = document.getElementById('statusFilters');
  let activeStatus = 'pending';
  let tab = 'mentors';
  const MENTOR_FILTERS = ['pending', 'verified', 'rejected', ''];
  const BOOKING_FILTERS = ['paid', 'answered', 'refunded', 'pending_payment', ''];
  const tabs = document.getElementById('adminTabs');

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function initials(name) {
    return (name || '?').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  }

  async function load() {
    content.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    try {
      const qs = activeStatus ? `?status=${activeStatus}` : '';
      if (tab === 'bookings') {
        const data = await WisecallAPI.apiFetch(`/admin/bookings${qs}`);
        renderBookings(data.bookings);
      } else {
        const data = await WisecallAPI.apiFetch(`/admin/mentors${qs}`);
        render(data.mentors);
      }
    } catch (e) {
      if (e.code === 'not_admin') {
        content.innerHTML = `<p class="muted">${t('admin.notAuthorized')}</p>`;
      } else if (e.code === 'admin_not_configured') {
        content.innerHTML = `<p class="muted">${e.message2 || t('admin.notConfigured')}</p>`;
      } else {
        content.innerHTML = `<p class="muted">${t('toast.error')}</p>`;
      }
    }
  }

  function render(mentors) {
    if (mentors.length === 0) {
      content.innerHTML = `<p class="muted">${t('admin.empty')}</p>`;
      return;
    }
    content.innerHTML = mentors.map(m => `
      <div class="booking-card" data-id="${m.id}">
        <div class="booking-top">
          <div class="avatar" style="background:${m.color || '#182236'}">${initials(m.name)}</div>
          <div>
            <div class="card-name">${escapeHtml(m.name)}</div>
            <span class="muted small">${escapeHtml(m.email)}</span>
          </div>
          <div class="booking-amount">${m.price ? '$' + m.price : '—'}</div>
        </div>
        <p class="booking-question">
          <strong>${escapeHtml(m.roleTitle || '—')}</strong> · ${m.niche ? t('niche.' + m.niche) : '—'}<br>
          ${m.proofUrl ? `<a href="${escapeHtml(m.proofUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.proofUrl)}</a>` : `<span class="muted">${t('admin.noProof')}</span>`}
        </p>
        ${m.verificationNote ? `<p class="muted small">${t('admin.lastNote')}: ${escapeHtml(m.verificationNote)}</p>` : ''}
        ${m.sampleAnswer ? `<div class="booking-answer"><strong>${t('admin.sampleTitle')}</strong> ${escapeHtml(m.sampleAnswer)}</div>` : `<p class="muted small">${t('admin.noSample')}</p>`}
        ${(m.reviewCount >= 3 && m.ratingAvg < 3.5) ? `<p class="form-error">${t('admin.lowRatingFlag').replace('{avg}', m.ratingAvg)}</p>` : ''}
        <div class="checklist">
          <label class="checkbox-row"><input type="checkbox" class="chk-identity"> <span>${t('admin.check.identity')}</span></label>
          <label class="checkbox-row"><input type="checkbox" class="chk-credential"> <span>${t('admin.check.credential')}</span></label>
          <label class="checkbox-row"><input type="checkbox" class="chk-sample"> <span>${t('admin.check.sample')}</span></label>
        </div>        <div class="review-actions" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:10px;">
          <span class="badge badge-${m.verificationStatus === 'rejected' ? 'rejected' : (m.verificationStatus === 'verified' ? 'answered' : 'pending_payment')}">${t('settings.verify.' + (m.verificationStatus || 'none'))}</span>
          <button class="btn btn-primary btn-sm approve-btn">${t('admin.approve')}</button>
          <button class="btn btn-outline btn-sm reject-btn">${t('admin.reject')}</button>
        </div>
        <div class="reject-note" style="display:none; margin-top:10px;">
          <input type="text" class="reject-note-input" placeholder="${t('admin.rejectReasonPlaceholder')}">
          <button class="btn btn-outline btn-sm confirm-reject-btn" style="margin-top:8px;">${t('admin.confirmReject')}</button>
        </div>
      </div>
    `).join('');

    content.querySelectorAll('.booking-card').forEach(card => {
      const id = card.dataset.id;
      card.querySelector('.approve-btn').addEventListener('click', () => {
        const checks = { identity: card.querySelector('.chk-identity').checked, credential: card.querySelector('.chk-credential').checked, sample: card.querySelector('.chk-sample').checked };
        if (!(checks.identity && checks.credential && checks.sample)) { WisecallNav.showToast(t('admin.checklistNeeded')); return; }
        review(id, true, null, checks);
      });
      card.querySelector('.reject-btn').addEventListener('click', () => {
        card.querySelector('.reject-note').style.display = 'block';
      });
      card.querySelector('.confirm-reject-btn').addEventListener('click', () => {
        const note = card.querySelector('.reject-note-input').value.trim();
        if (!note) { WisecallNav.showToast(t('admin.reasonRequired')); return; }
        review(id, false, note);
      });
    });
  }

  async function review(id, approve, note, checks) {
    try {
      await WisecallAPI.apiFetch(`/admin/mentors/${id}/review`, {
        method: 'POST',
        body: { approve, note, checks }
      });
      WisecallNav.showToast(t('toast.saved'));
      load();
    } catch (e) {
      WisecallNav.showToast(t('toast.error'));
    }
  }

  function money(cents, currency) {
    return `$${(cents / 100).toFixed(2)} ${(currency || 'usd').toUpperCase()}`;
  }

  function fmtDate(d) {
    return new Date(d).toLocaleString(WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function renderBookings(list) {
    if (list.length === 0) {
      content.innerHTML = `<p class="muted">${t('admin.empty')}</p>`;
      return;
    }
    content.innerHTML = list.map(b => `
      <div class="booking-card" data-id="${b.id}">
        <div class="booking-top">
          <div>
            <div class="card-name">${escapeHtml(b.seekerName)} → ${escapeHtml(b.mentorName)}</div>
            <span class="muted small">${escapeHtml(b.seekerEmail)} · ${escapeHtml(b.mentorEmail)}</span>
          </div>
          <div class="booking-amount">${money(b.amount, b.currency)}</div>
        </div>
        <p class="booking-question">${escapeHtml(b.question)}</p>
        <p class="muted small">${t('admin.bk.created')}: ${fmtDate(b.createdAt)}${b.answerDeadline && b.status === 'paid' ? ` · ${t('admin.bk.deadline')}: ${fmtDate(b.answerDeadline)}` : ''}${b.refundReason ? ` · ${t('admin.bk.reason')}: ${escapeHtml(b.refundReason)}` : ''}${b.transferError ? ` · <span class="form-error">${t('admin.bk.payoutIssue')}</span>` : ''}</p>
        <div class="review-actions" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:10px;">
          <span class="badge badge-${b.status}">${t('dash.status.' + b.status)}</span>
          ${(b.status === 'paid' || b.status === 'answered') ? `<button class="btn btn-outline btn-sm refund-btn">${t('admin.bk.refund')}</button>` : ''}
        </div>
      </div>
    `).join('');

    content.querySelectorAll('.refund-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!window.confirm(t('admin.bk.refundConfirm'))) return;
        btn.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/admin/bookings/${btn.closest('.booking-card').dataset.id}/refund`, { method: 'POST' });
          WisecallNav.showToast(t('admin.bk.refunded'));
        } catch (e) {
          WisecallNav.showToast(e.code === 'not_refundable' ? t('admin.bk.notRefundable') : t('toast.error'));
        }
        load();
      });
    });
  }

  function drawFilters() {
    const list = tab === 'bookings' ? BOOKING_FILTERS : MENTOR_FILTERS;
    filters.innerHTML = list.map(s => {
      const label = s === '' ? t('admin.filter.all') : (tab === 'bookings' ? t('dash.status.' + s) : t('admin.filter.' + s));
      return `<button class="chip${s === activeStatus ? ' active' : ''}" data-status="${s}">${label}</button>`;
    }).join('');
  }

  filters.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.chip');
    if (!btn) return;
    activeStatus = btn.dataset.status;
    drawFilters();
    load();
  });

  tabs.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.chip');
    if (!btn || btn.dataset.tab === tab) return;
    tabs.querySelectorAll('.chip').forEach(c => { c.classList.toggle('active', c === btn); c.setAttribute('aria-selected', c === btn); });
    tab = btn.dataset.tab;
    activeStatus = tab === 'bookings' ? 'paid' : 'pending';
    drawFilters();
    load();
  });

  document.addEventListener('wisecall:lang-changed', () => { drawFilters(); load(); });
  drawFilters();
  load();
})();