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
  const BOOKING_FILTERS = ['paid', 'answered', 'refund_pending', 'refunded', 'pending_payment', ''];
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
      if (tab === 'payouts') {
        const [owed, history] = await Promise.all([WisecallAPI.apiFetch('/admin/payouts'), WisecallAPI.apiFetch('/admin/payouts/history')]);
        renderPayouts(owed, history.batches);
      } else if (tab === 'bookings') {
        const data = await WisecallAPI.apiFetch(`/admin/bookings${qs}`);
        renderBookings(data.bookings);
      } else {
        const data = await WisecallAPI.apiFetch(`/admin/mentors${qs}`);
        AdminMentors.render(content, data.mentors, (o) => { if (!(o && o.soft)) load(); });
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

  function renderBookings(list) {
    if (list.length === 0) {
      content.innerHTML = `<p class="muted">${t('admin.empty')}</p>`;
      return;
    }
    content.innerHTML = list.map(b => `
      <div class="booking-card" data-id="${b.id}" data-payout="${b.payoutStatus || ''}">
        <div class="booking-top">
          <div>
            <div class="card-name">${escapeHtml(b.seekerName)} → ${escapeHtml(b.mentorName)}</div>
            <span class="muted small">${escapeHtml(b.seekerEmail)} · ${escapeHtml(b.mentorEmail)}</span>
          </div>
          <div class="booking-amount">${money(b.amount, b.currency)}</div>
        </div>
        <p class="booking-question">${escapeHtml(b.question)}</p>
        <p class="muted small">${t('admin.bk.created')}: ${fmtDate(b.createdAt)}${b.answerDeadline && b.status === 'paid' ? ` · ${t('admin.bk.deadline')}: ${fmtDate(b.answerDeadline)}` : ''}${b.refundReason ? ` · ${t('admin.bk.reason')}: ${escapeHtml(b.refundReason)}` : ''}${b.refundError ? ` · <span class="form-error">${t('admin.bk.refundError')}: ${escapeHtml(b.refundError)}</span>` : ''}</p>
        <div class="review-actions" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:10px;">
          <span class="badge badge-${b.status}">${t('dash.status.' + b.status)}</span>
          ${(b.status === 'paid' || b.status === 'answered' || (b.status === 'refund_pending' && b.refundError)) ? `<button class="btn btn-outline btn-sm refund-btn">${t(b.status === 'refund_pending' ? 'admin.bk.retryRefund' : 'admin.bk.refund')}</button>` : ''}
        </div>
      </div>
    `).join('');

    content.querySelectorAll('.refund-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const paidOut = btn.closest('.booking-card').dataset.payout === 'paid';
        if (!window.confirm(t(paidOut ? 'admin.bk.refundConfirmPaidOut' : 'admin.bk.refundConfirm'))) return;
        btn.disabled = true;
        try {
          const res = await WisecallAPI.apiFetch(`/admin/bookings/${btn.closest('.booking-card').dataset.id}/refund`, { method: 'POST' });
          WisecallNav.showToast(t(res.mentorOwesBack ? 'admin.bk.refundedOwed' : 'admin.bk.refundRequested'));
        } catch (e) {
          WisecallNav.showToast(e.code === 'not_refundable' ? t('admin.bk.notRefundable') : (e.code === 'refund_failed' ? t('admin.bk.refundFailed') : t('toast.error')));
        }
        load();
      });
    });
  }

  // Manual mentor payouts: who to pay how much, and a record of what was sent.
  function renderPayouts(owed, batches) {
    const rows = owed.mentors;
    const toolbar = `
      <div class="payout-toolbar">
        <a class="btn btn-outline btn-sm" href="/api/admin/payouts.csv" download>${t('admin.po.csv')}</a>
        <a class="btn btn-ghost btn-sm" href="/api/admin/payouts/history.csv" download>${t('admin.po.historyCsv')}</a>
      </div>
      <p class="muted small">${t('admin.po.help').replace('{days}', owed.holdDays)}</p>`;
    const cards = rows.length === 0 ? `<p class="muted">${t('admin.po.empty')}</p>` : rows.map(r => `
      <div class="booking-card" data-mentor="${r.mentorId}" data-net="${r.net}">
        <div class="booking-top">
          <div>
            <div class="card-name">${escapeHtml(r.name)}</div>
            <span class="muted small">${escapeHtml(r.email)}</span>
          </div>
          <div class="booking-amount">${money(Math.max(r.net, 0), 'gel')}</div>
        </div>
        ${r.iban
          ? `<p class="booking-question"><strong>${escapeHtml(r.payoutName || '')}</strong><br><span class="mono iban-line">${escapeHtml(r.iban)}</span></p>`
          : `<p class="form-error">${t('admin.po.noIban')}</p>`}
        <p class="muted small">
          ${t('admin.po.payable')}: ${money(r.payable, 'gel')} · ${t('admin.po.holding')}: ${money(r.holding, 'gel')}${r.debt ? ` · <span class="form-error">${t('admin.po.debt')}: ${money(r.debt, 'gel')}</span>` : ''}
        </p>
        ${r.net < 0 ? `<p class="form-error">${t('admin.po.debtExceeds')}</p>` : ''}
        ${(r.payable > 0 || r.debt > 0) && r.net >= 0 ? `
          <div class="payout-pay">
            <input type="text" class="payout-ref" maxlength="100" placeholder="${t('admin.po.refPlaceholder')}" aria-label="${t('admin.po.refPlaceholder')}">
            <button class="btn btn-primary btn-sm pay-btn" ${r.iban || r.net === 0 ? '' : 'disabled'}>${t(r.net === 0 ? 'admin.po.settle' : 'admin.po.markPaid')}</button>
          </div>` : ''}
      </div>`).join('');
    const hist = batches.length === 0 ? '' : `
      <h2 class="reviews-title" style="margin-top:32px">${t('admin.po.history')}</h2>
      <ul class="earn-list">${batches.map(b => `<li><span>${fmtDate(b.paidAt)}</span><span>${escapeHtml(b.mentorName)} · ${escapeHtml(b.reference)}</span><strong>${money(b.amount, 'gel')}</strong></li>`).join('')}</ul>`;
    content.innerHTML = toolbar + cards + hist;

    content.querySelectorAll('.pay-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.booking-card');
        const net = Number(card.dataset.net);
        const reference = card.querySelector('.payout-ref').value.trim();
        if (!reference) { WisecallNav.showToast(t('admin.po.refRequired')); return; }
        if (!window.confirm(t(net === 0 ? 'admin.po.confirmSettle' : 'admin.po.confirmPaid').replace('{amount}', money(net, 'gel')))) return;
        btn.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/admin/payouts/${card.dataset.mentor}/pay`, { method: 'POST', body: { amount: net, reference } });
          WisecallNav.showToast(t('admin.po.recorded'));
        } catch (e) {
          WisecallNav.showToast(e.code === 'amount_changed' ? t('admin.po.changed') : (e.code === 'nothing_to_pay' ? t('admin.po.nothing') : t('toast.error')));
        }
        load();
      });
    });
  }

  function drawFilters() {
    filters.style.display = tab === 'payouts' ? 'none' : '';
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
    activeStatus = tab === 'bookings' ? 'paid' : (tab === 'payouts' ? '' : 'pending');
    drawFilters();
    load();
  });

  document.addEventListener('wisecall:lang-changed', () => { drawFilters(); load(); });
  drawFilters();
  load();
})();