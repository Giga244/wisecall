(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;

  if (!user) { // (the server already sends a signed-out visitor to the login page; this covers a session that ended while the page was open)
    window.location.href = '/login.html?redirect=/admin.html';
    return;
  }

  const content = document.getElementById('adminContent');
  document.getElementById('adminLaunchNote').hidden = WisecallI18n.launchMode() !== 'prelaunch';
  const filters = document.getElementById('statusFilters');
  let activeStatus = 'pending';
  let tab = 'mentors';
  const MENTOR_FILTERS = ['pending', 'verified', 'failed_step', 'rejected', 'suspended', ''];
  const BOOKING_FILTERS = ['paid', 'answered', 'refund_pending', 'refunded', 'pending_payment', ''];
  const NO_FILTERS = ['payouts', 'interviews', 'queue', 'reviews', 'waitlist', 'niches', 'support', 'disputes', 'overview', 'answers', 'requests', 'live', 'safety', 'categories']; // tabs that have no status chips
  const tabs = document.getElementById('adminTabs');

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const locale = () => (WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const money = (tetri) => WisecallAPI.formatAmount(tetri); // amounts arrive as whole tetri; the site is lari only
  const fmtDate = (d) => WisecallI18n.formatDate(d, { day: 'numeric', month: 'short', year: 'numeric' });

  function initials(name) {
    return (name || '?').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  }

  let loadNumber = 0;
  async function load() {
    const mine = ++loadNumber; // (a list that arrives after another filter was chosen is not drawn over it)
    content.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    try {
      const qs = tab === 'mentors' && activeStatus === 'pending' ? '?queue=needs_human' : (activeStatus ? `?status=${activeStatus}` : '');
      if (tab === 'interviews') {
        await AdminInterviews.render(content);
      } else if (tab === 'categories') {
        await AdminCategories.render(content);
      } else if (tab === 'safety') {
        await AdminSafety.render(content);
      } else if (tab === 'queue') {
        await AdminQueue.render(content);
      } else if (tab === 'reviews') {
        await AdminReviews.render(content);
      } else if (tab === 'waitlist') {
        await AdminWaitlist.render(content);
      } else if (tab === 'niches') {
        await AdminNiches.render(content);
      } else if (tab === 'support') {
        await AdminSupport.render(content);
      } else if (tab === 'live') {
        await AdminLive.render(content);
      } else if (tab === 'profiles') {
        await AdminProfiles.render(content);
      } else if (tab === 'requests') {
        await AdminRequests.render(content);
      } else if (tab === 'answers') {
        await AdminPublicAnswers.render(content);
      } else if (tab === 'overview') {
        await AdminOverview.render(content);
      } else if (tab === 'disputes') {
        await AdminDisputes.render(content);
      } else if (tab === 'payouts') {
        const [owed, history] = await Promise.all([WisecallAPI.apiFetch('/admin/payouts'), WisecallAPI.apiFetch('/admin/payouts/history')]);
        content.innerHTML = '<div id="wdBox"></div><div id="directBox"></div>';
        renderPayouts(owed, history.batches, document.getElementById('directBox'));
        await AdminWithdrawals.render(document.getElementById('wdBox'), load);
      } else if (tab === 'bookings') {
        const data = await WisecallAPI.apiFetch(`/admin/bookings${qs}`);
        if (mine !== loadNumber) return;
        renderBookings(data.bookings);
      } else {
        const data = await WisecallAPI.apiFetch(`/admin/mentors${qs}`);
        if (mine !== loadNumber) return;
        AdminMentors.render(content, data.mentors, (o) => { if (!(o && o.soft)) load(); });
      }
    } catch (e) {
      if (e.code === 'not_admin') {
        content.innerHTML = `<p class="muted">${t('admin.notAuthorized')}</p>`;
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
      <div class="booking-card" data-id="${b.id}" data-payout="${b.payoutStatus || ''}" data-amount="${Number(b.amount) - Number(b.refundedAmount || 0)}">
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
        ${WisecallI18n.devMode() ? `
        <div class="payout-pay dev-ff" role="group" aria-label="${t('admin.dev.badge')}">
          <span class="badge badge-pending_payment">${t('admin.dev.badge')}</span>
          <input type="number" class="ff-days" min="1" max="90" step="1" value="7" aria-label="${t('admin.dev.days')}" title="${t('admin.dev.help')}">
          <button type="button" class="btn btn-outline btn-sm ff-btn" title="${t('admin.dev.help')}">${t('admin.dev.ff')}</button>
        </div>` : ''}
      </div>
    `).join('');

    // Development only (the buttons exist only on a developer's computer): move this booking's clock forward, then run the checks now.
    content.querySelectorAll('.ff-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.booking-card');
        const days = Number(card.querySelector('.ff-days').value);
        btn.disabled = true;
        try {
          const r = await WisecallAPI.apiFetch(`/admin/dev/bookings/${card.dataset.id}/fast-forward`, { method: 'POST', body: { days } });
          const changes = [];
          if (r.before.status !== r.after.status) changes.push(t('admin.dev.changed.status').replace('{from}', t('dash.status.' + r.before.status)).replace('{to}', t('dash.status.' + r.after.status)));
          if (r.before.answerReview === 'held' && r.after.answerReview === 'released') changes.push(t('admin.dev.changed.released'));
          if (!r.before.payableNow && r.after.payableNow) changes.push(t('admin.dev.changed.payable'));
          if (r.after.ratingsRevealed > r.before.ratingsRevealed) changes.push(t('admin.dev.changed.revealed'));
          WisecallNav.showToast([t('admin.dev.done').replace('{days}', days), ...(changes.length ? changes : [t('admin.dev.nothing')])].join(' '));
        } catch (e) {
          WisecallNav.showToast(t('admin.dev.err'));
        }
        load();
      });
    });

    content.querySelectorAll('.refund-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const paidOut = btn.closest('.booking-card').dataset.payout === 'paid';
        const refund = money(Number(btn.closest('.booking-card').dataset.amount), 'gel');
        if (!(await WisecallDialog.confirm({ message: t(paidOut ? 'admin.bk.refundConfirmPaidOut' : 'admin.bk.refundConfirm'), confirmText: t('admin.bk.refundButton').replace('{amount}', refund), danger: true }))) return;
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
  function renderPayouts(owed, batches, box) {
    const rows = owed.mentors;
    const toolbar = `
      <h2 class="reviews-title" style="margin-top:32px">${t('admin.wd.direct')}</h2>
      <p class="muted small">${t('admin.wd.directHelp')}</p>
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
        ${r.flagged ? `<p class="form-error">${t('admin.po.flagged')}</p>` : ''}
        ${r.suspended ? `<p class="form-error">${t('admin.po.suspended')}</p>` : ''}
        ${r.net < 0 ? `<p class="form-error">${t('admin.po.debtExceeds')}</p>` : ''}
        ${(r.payable > 0 || r.debt > 0) && r.net >= 0 ? `
          <div class="payout-pay">
            <input type="text" class="payout-ref" maxlength="100" placeholder="${t('admin.po.refPlaceholder')}" aria-label="${t('admin.po.refPlaceholder')}">
            <button class="btn btn-primary btn-sm pay-btn" ${(r.iban || r.net === 0) && !r.flagged && !r.suspended ? '' : 'disabled'}>${t(r.net === 0 ? 'admin.po.settle' : 'admin.po.markPaid')}</button>
          </div>` : ''}
      </div>`).join('');
    const hist = batches.length === 0 ? '' : `
      <h2 class="reviews-title" style="margin-top:32px">${t('admin.po.history')}</h2>
      <ul class="earn-list">${batches.map(b => `<li><span>${fmtDate(b.paidAt)}</span><span>${escapeHtml(b.mentorName)} · ${escapeHtml(b.reference)}</span><strong>${money(b.amount, 'gel')}</strong></li>`).join('')}</ul>`;
    box.innerHTML = toolbar + cards + hist;

    box.querySelectorAll('.pay-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.booking-card');
        const net = Number(card.dataset.net);
        const reference = card.querySelector('.payout-ref').value.trim();
        if (!reference) { WisecallNav.showToast(t('admin.po.refRequired')); return; }
        if (!(await WisecallDialog.confirm({ message: t(net === 0 ? 'admin.po.confirmSettle' : 'admin.po.confirmPaid').replace('{amount}', money(net, 'gel')),
          confirmText: net === 0 ? t('admin.po.settleButton') : t('admin.po.payButton').replace('{amount}', money(net, 'gel')) }))) return;
        btn.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/admin/payouts/${card.dataset.mentor}/pay`, { method: 'POST', body: { amount: net, reference } });
          WisecallNav.showToast(t('admin.po.recorded'));
        } catch (e) {
          WisecallNav.showToast(e.code === 'amount_changed' ? t('admin.po.changed') : (e.code === 'nothing_to_pay' ? t('admin.po.nothing') : (e.code === 'request_open' ? t('admin.wd.requestOpen') : (e.code === 'payout_hold' ? t('admin.wd.err.payout_hold') : t('toast.error')))));
        }
        load();
      });
    });
  }

  function drawFilters() {
    filters.style.display = NO_FILTERS.includes(tab) ? 'none' : '';
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

  const statusesOf = (name) => (name === 'bookings' ? BOOKING_FILTERS : MENTOR_FILTERS);
  const defaultStatus = (name) => (name === 'bookings' ? 'paid' : (NO_FILTERS.includes(name) ? '' : 'pending'));
  function showTab(name) {
    tab = name;
    tabs.querySelectorAll('.chip').forEach(c => { const on = c.dataset.tab === name; c.classList.toggle('active', on); c.setAttribute('aria-selected', on); });
  }
  // The address says which tab and status are open (?tab=mentors&status=verified), so a reload, or a link in an email, opens the same list.
  function syncAddress() {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    if (NO_FILTERS.includes(tab)) url.searchParams.delete('status'); else url.searchParams.set('status', activeStatus || 'all');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  tabs.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.chip');
    if (!btn || btn.dataset.tab === tab) return;
    showTab(btn.dataset.tab);
    activeStatus = defaultStatus(tab);
    syncAddress();
    drawFilters();
    load();
  });
  filters.addEventListener('click', (ev) => { if (ev.target.closest('.chip')) syncAddress(); });

  document.addEventListener('wisecall:lang-changed', () => { drawFilters(); load(); });
  // An admin (or an email) can link straight to a tab and a status: /admin.html?tab=queue, /admin.html?tab=mentors&status=verified,
  // /admin.html?tab=mentors&status=all. An unknown tab or status is ignored (the default list opens).
  const params = new URLSearchParams(location.search);
  const wanted = tabs.querySelector(`.chip[data-tab="${CSS.escape(params.get('tab') || '')}"]`);
  if (wanted && wanted.dataset.tab !== tab) { showTab(wanted.dataset.tab); activeStatus = defaultStatus(tab); }
  const askedStatus = params.get('status');
  if (askedStatus !== null && !NO_FILTERS.includes(tab)) {
    // (needs_human: the waiting list, the mentors tab's own default; docs/CLAUDE-CODE-ADMIN-ONE-TAP-APPROVE.md)
    const s = askedStatus === 'all' ? '' : (askedStatus === 'needs_human' && tab === 'mentors' ? 'pending' : askedStatus);
    if (statusesOf(tab).includes(s)) activeStatus = s;
  }
  drawFilters();
  load();
})();