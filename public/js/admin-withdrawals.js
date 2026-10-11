// Admin: withdrawals (top of the Payouts tab). The money overview, the open requests with what the bank transfer needs (the full IBAN is
// only shown here, and every view is logged), "Mark as paid" with the bank reference, "Reject" with a reason, a CSV of the open requests
// for one bulk transfer and "Mark all exported as paid", and the recent decisions. With PAYOUT_METHOD=flitt_iban a request is sent through
// the bank instead ("Send payout", with a code from the authenticator app every time) and "Mark as paid" is not offered (the bank says
// when it is paid). Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (tetri) => WisecallAPI.formatAmount(tetri);
  const when = (d) => WisecallI18n.formatDate(d, { dateStyle: 'medium', timeStyle: 'short' });
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const STATUS = { requested: 'pending_payment', sending: 'pending_payment', paid: 'answered', rejected: 'rejected', failed: 'rejected' };
  let automatic = false;

  function overview(o) {
    return `
      <p class="wd-held"><strong>${esc(fill('admin.wd.held', { amount: money(o.mentorMoneyHeld) }))}</strong></p>
      <div class="earn-cards">
        <div class="earn-card"><span>${esc(t('admin.wd.received'))}</span><strong>${esc(money(o.received))}</strong></div>
        <div class="earn-card"><span>${esc(fill('admin.wd.revenue', { percent: o.feePercent }))}</span><strong>${esc(money(o.revenue))}</strong></div>
        <div class="earn-card"><span>${esc(fill('admin.wd.bankFees', { percent: o.bankFeePercent }))}</span><strong>${esc(money(o.bankFeesEstimate))}</strong></div>
      </div>
      <p class="muted small">${esc(t('admin.wd.overviewHelp'))}</p>`;
  }

  function requestCard(r) {
    return `
      <div class="booking-card wd-request" data-id="${esc(r.id)}" data-amount="${r.amount}" data-name="${esc(r.payoutName || r.name)}">
        <div class="booking-top">
          <div>
            <div class="card-name">${esc(r.name)}</div>
            <span class="muted small">${esc(r.email)} · ${esc(fill('admin.wd.requestedAt', { date: when(r.requestedAt) }))}</span>
          </div>
          <div class="booking-amount">${esc(money(r.amount))}</div>
        </div>
        <p class="booking-question">
          <span class="muted small">${esc(t('admin.wd.holder'))}:</span> <strong>${esc(r.payoutName || '—')}</strong><br>
          <span class="muted small">${esc(t('admin.wd.verifiedName'))}:</span> ${esc(r.verifiedName || '—')}<br>
          <span class="mono iban-line">${esc(r.iban || '—')}</span>
        </p>
        ${r.debtDeducted ? `<p class="muted small">${esc(fill('admin.wd.debt', { amount: money(r.debtDeducted) }))}</p>` : ''}
        ${r.exportedAt ? `<p class="muted small">${esc(fill('admin.wd.exported', { date: when(r.exportedAt) }))}</p>` : ''}
        ${r.status === 'sending' ? `<p class="muted small">${esc(fill('admin.wd.sendingNote', { date: when(r.sendStartedAt) }))}</p>
        <div class="payout-pay"><button type="button" class="btn btn-outline btn-sm wd-sync">${esc(t('admin.wd.check'))}</button></div>` : `
        ${automatic ? `<div class="payout-pay">
          <input type="text" class="wd-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="${esc(t('admin.wd.codePlaceholder'))}" aria-label="${esc(t('admin.wd.codePlaceholder'))}">
          <button type="button" class="btn btn-primary btn-sm wd-send">${esc(t('admin.wd.send'))}</button>
        </div>` : `<div class="payout-pay">
          <input type="text" class="wd-ref" maxlength="100" placeholder="${esc(t('admin.wd.refPlaceholder'))}" aria-label="${esc(t('admin.wd.refPlaceholder'))}">
          <button type="button" class="btn btn-primary btn-sm wd-pay">${esc(t('admin.wd.markPaid'))}</button>
        </div>`}
        <div class="payout-pay">
          <input type="text" class="wd-reason" maxlength="500" placeholder="${esc(t('admin.wd.reasonPlaceholder'))}" aria-label="${esc(t('admin.wd.reasonPlaceholder'))}">
          <button type="button" class="btn btn-outline btn-sm wd-reject">${esc(t('admin.wd.reject'))}</button>
        </div>`}
      </div>`;
  }

  function recent(list) {
    if (!list.length) return '';
    return `<h3 class="reviews-title">${esc(t('admin.wd.recent'))}</h3>
      <ul class="earn-list">${list.map((r) => `<li><span>${esc(when(r.paidAt || r.rejectedAt))}</span>
        <span>${esc(r.name)} · <span class="badge badge-${STATUS[r.status] || 'badge-muted'}">${esc(t('admin.wd.status.' + r.status))}</span>
        ${esc(r.reference || r.reason || '')}</span><strong>${esc(money(r.amount))}</strong></li>`).join('')}</ul>`;
  }

  async function render(container, reload) {
    let d;
    try { d = await WisecallAPI.apiFetch('/admin/withdrawals'); } catch (e) { container.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    automatic = Boolean(d.automatic);
    const exported = d.queue.filter((r) => r.exportedAt).length;
    container.innerHTML = `
      <h2 class="reviews-title">${esc(t('admin.wd.title'))}</h2>
      ${overview(d.overview)}
      <h3 class="reviews-title">${esc(t('admin.wd.queue'))} (${d.queue.length})</h3>
      ${automatic ? `<p class="muted small">${esc(t('admin.wd.automaticHelp'))}</p>` : ''}
      ${d.queue.length ? `
        <div class="payout-toolbar">
          <a class="btn btn-outline btn-sm" href="/api/admin/withdrawals.csv" download>${esc(t('admin.wd.csv'))}</a>
        </div>
        ${exported ? `<div class="payout-pay wd-bulk">
          <input type="text" class="wd-bulk-ref" maxlength="100" placeholder="${esc(t('admin.wd.refPlaceholder'))}" aria-label="${esc(t('admin.wd.refPlaceholder'))}">
          <button type="button" class="btn btn-outline btn-sm wd-pay-exported">${esc(fill('admin.wd.payExported', { n: exported }))}</button>
        </div>` : ''}
        ${d.queue.map(requestCard).join('')}` : `<p class="muted">${esc(t('admin.wd.empty'))}</p>`}
      ${recent(d.recent)}`;

    const after = async (msg) => { WisecallNav.showToast(msg); if (reload) await reload(); else await render(container); };
    container.querySelectorAll('.wd-request').forEach((card) => {
      const id = card.dataset.id;
      const amount = Number(card.dataset.amount);
      const send = card.querySelector('.wd-send');
      if (send) send.addEventListener('click', async () => {
        const code = card.querySelector('.wd-code').value.trim();
        if (!/^\d{6}$/.test(code)) { WisecallNav.showToast(t('admin.wd.err.invalid_code')); return; }
        if (!(await WisecallDialog.confirm({ message: fill('admin.wd.sendConfirm', { amount: money(amount), name: card.dataset.name }), confirmText: t('admin.wd.send') }))) return;
        send.disabled = true;
        try {
          const r = await WisecallAPI.apiFetch(`/admin/withdrawals/${id}/send`, { method: 'POST', body: { code } });
          await after(t(r.request && r.request.status === 'paid' ? 'admin.wd.paid' : (r.request && r.request.status === 'failed' ? 'admin.wd.status.failed' : 'admin.wd.sent')));
        } catch (e) {
          WisecallNav.showToast(e.code === 'daily_limit' ? fill('admin.wd.err.daily_limit', { left: money(e.left || 0) }) : t(['invalid_code', 'code_locked', 'name_mismatch', 'no_payout_details', 'manual_method', 'two_factor_required'].includes(e.code) ? 'admin.wd.err.' + e.code : 'toast.error'));
          send.disabled = false;
        }
      });
      const sync = card.querySelector('.wd-sync');
      if (sync) sync.addEventListener('click', async () => {
        sync.disabled = true;
        try {
          const r = await WisecallAPI.apiFetch(`/admin/withdrawals/${id}/sync`, { method: 'POST' });
          if (r.request && r.request.status === 'sending') { WisecallNav.showToast(t('admin.wd.stillSending')); sync.disabled = false; }
          else await after(t(r.request && r.request.status === 'paid' ? 'admin.wd.paid' : 'admin.wd.status.failed'));
        } catch (e) { WisecallNav.showToast(t('toast.error')); sync.disabled = false; }
      });
      const pay = card.querySelector('.wd-pay');
      if (pay) pay.addEventListener('click', async (ev) => {
        const reference = card.querySelector('.wd-ref').value.trim();
        if (reference.length < 2) { WisecallNav.showToast(t('admin.wd.refRequired')); return; }
        if (!(await WisecallDialog.confirm({ message: fill('admin.wd.confirmPaid', { amount: money(amount), name: card.dataset.name }), confirmText: fill('admin.wd.payButton', { amount: money(amount) }) }))) return;
        ev.target.disabled = true;
        try { await WisecallAPI.apiFetch(`/admin/withdrawals/${id}/pay`, { method: 'POST', body: { reference, amount } }); await after(t('admin.wd.paid')); }
        catch (e) { WisecallNav.showToast(t(e.code === 'amount_changed' ? 'admin.wd.changed' : 'toast.error')); ev.target.disabled = false; }
      });
      const reject = card.querySelector('.wd-reject');
      if (reject) reject.addEventListener('click', async (ev) => {
        const reason = card.querySelector('.wd-reason').value.trim();
        if (reason.length < 5) { WisecallNav.showToast(t('admin.wd.reasonRequired')); return; }
        ev.target.disabled = true;
        try { await WisecallAPI.apiFetch(`/admin/withdrawals/${id}/reject`, { method: 'POST', body: { reason } }); await after(t('admin.wd.rejected')); }
        catch (e) { WisecallNav.showToast(t('toast.error')); ev.target.disabled = false; }
      });
    });
    const bulk = container.querySelector('.wd-pay-exported');
    if (bulk) bulk.addEventListener('click', async () => {
      const reference = container.querySelector('.wd-bulk-ref').value.trim();
      if (reference.length < 2) { WisecallNav.showToast(t('admin.wd.refRequired')); return; }
      if (!(await WisecallDialog.confirm({ message: fill('admin.wd.payExportedConfirm', { ref: reference }), confirmText: t('admin.wd.payExportedButton') }))) return;
      bulk.disabled = true;
      try {
        const r = await WisecallAPI.apiFetch('/admin/withdrawals/pay-exported', { method: 'POST', body: { reference } });
        await after([fill('admin.wd.payExportedDone', { n: r.paid }), r.changed.length ? fill('admin.wd.payExportedChanged', { n: r.changed.length }) : ''].filter(Boolean).join(' '));
      } catch (e) { WisecallNav.showToast(t('toast.error')); bulk.disabled = false; }
    });
  }

  window.AdminWithdrawals = { render };
})();
