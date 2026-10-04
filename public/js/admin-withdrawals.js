// Admin: withdrawals (top of the Payouts tab). The money overview, the open requests with what the bank transfer needs (the full IBAN is
// only shown here, and every view is logged), "Mark as paid" with the bank reference, "Reject" with a reason, a CSV of the open requests
// for one bulk transfer and "Mark all exported as paid", and the recent decisions. Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (tetri) => WisecallAPI.formatAmount(tetri);
  const when = (d) => WisecallI18n.formatDate(d, { dateStyle: 'medium', timeStyle: 'short' });
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const STATUS = { requested: 'pending_payment', paid: 'answered', rejected: 'rejected' };

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
        <div class="payout-pay">
          <input type="text" class="wd-ref" maxlength="100" placeholder="${esc(t('admin.wd.refPlaceholder'))}" aria-label="${esc(t('admin.wd.refPlaceholder'))}">
          <button type="button" class="btn btn-primary btn-sm wd-pay">${esc(t('admin.wd.markPaid'))}</button>
        </div>
        <div class="payout-pay">
          <input type="text" class="wd-reason" maxlength="500" placeholder="${esc(t('admin.wd.reasonPlaceholder'))}" aria-label="${esc(t('admin.wd.reasonPlaceholder'))}">
          <button type="button" class="btn btn-outline btn-sm wd-reject">${esc(t('admin.wd.reject'))}</button>
        </div>
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
    const exported = d.queue.filter((r) => r.exportedAt).length;
    container.innerHTML = `
      <h2 class="reviews-title">${esc(t('admin.wd.title'))}</h2>
      ${overview(d.overview)}
      <h3 class="reviews-title">${esc(t('admin.wd.queue'))} (${d.queue.length})</h3>
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
      card.querySelector('.wd-pay').addEventListener('click', async (ev) => {
        const reference = card.querySelector('.wd-ref').value.trim();
        if (reference.length < 2) { WisecallNav.showToast(t('admin.wd.refRequired')); return; }
        if (!window.confirm(fill('admin.wd.confirmPaid', { amount: money(amount), name: card.dataset.name }))) return;
        ev.target.disabled = true;
        try { await WisecallAPI.apiFetch(`/admin/withdrawals/${id}/pay`, { method: 'POST', body: { reference, amount } }); await after(t('admin.wd.paid')); }
        catch (e) { WisecallNav.showToast(t(e.code === 'amount_changed' ? 'admin.wd.changed' : 'toast.error')); ev.target.disabled = false; }
      });
      card.querySelector('.wd-reject').addEventListener('click', async (ev) => {
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
      if (!window.confirm(fill('admin.wd.payExportedConfirm', { ref: reference }))) return;
      bulk.disabled = true;
      try {
        const r = await WisecallAPI.apiFetch('/admin/withdrawals/pay-exported', { method: 'POST', body: { reference } });
        await after([fill('admin.wd.payExportedDone', { n: r.paid }), r.changed.length ? fill('admin.wd.payExportedChanged', { n: r.changed.length }) : ''].filter(Boolean).join(' '));
      } catch (e) { WisecallNav.showToast(t('toast.error')); bulk.disabled = false; }
    });
  }

  window.AdminWithdrawals = { render };
})();
