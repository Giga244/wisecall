// The mentor's Balance card (Dashboard → Earnings and Settings → Payouts): available, on hold (with the dates), requested, paid out,
// owed back, the "Withdraw" button and the history of withdrawals. Everything comes from /api/me/balance (server/withdrawals.js); the
// amount to withdraw is always computed by the server.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (tetri) => WisecallAPI.formatAmount(tetri);
  const day = (d) => WisecallI18n.formatDate(d, { day: 'numeric', month: 'long', year: 'numeric' });
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const STATUS = { requested: 'pending_payment', sending: 'pending_payment', paid: 'answered', rejected: 'rejected', failed: 'rejected' };

  function cards(b) {
    const card = (label, value, cls) => `<div class="earn-card${cls ? ' ' + cls : ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    return `<div class="earn-cards">
      ${card(t('bal.available'), money(b.available))}
      ${card(t('bal.onHold'), money(b.onHold))}
      ${b.requested ? card(t('bal.requested'), money(b.requested)) : ''}
      ${card(t('bal.paidOut'), money(b.paidOut))}
      ${b.owedBack ? card(t('bal.owedBack'), money(b.owedBack), 'warn') : ''}
    </div>`;
  }

  function holds(h) {
    const lines = h.until.map((x) => `<li>${esc(fill('bal.holdUntil', { amount: money(x.amount), date: day(x.date) }))}</li>`);
    if (h.disputed) lines.push(`<li>${esc(fill('bal.disputed', { amount: money(h.disputed) }))}</li>`);
    return lines.length ? `<ul class="bal-holds muted small">${lines.join('')}</ul>` : '';
  }

  // No bank account saved yet (it is never needed to be shown on the site): the Withdraw form asks for it right here, the account holder's
  // name and the IBAN, with the same checks as Settings → ანაზღაურება; then the request goes on.
  function bankFields(d) {
    if (!d.needsPayoutDetails) return '';
    return `<fieldset class="bal-bank">
        <legend>${esc(t('bal.bank.title'))}</legend>
        <p class="muted small">${esc(t('bal.bank.intro'))}</p>
        <label><span>${esc(t('settings.payouts.name'))}</span><input type="text" name="payoutName" autocomplete="name" maxlength="100" aria-describedby="balBankNameErr">
          <span class="hint">${esc(t('bal.bank.nameHint'))}</span></label>
        <p class="form-error bal-field-error" id="balBankNameErr" data-bank-error="name" role="alert" hidden></p>
        <label><span>${esc(t('settings.payouts.iban'))}</span><input type="text" name="payoutIban" autocomplete="off" inputmode="text" maxlength="34" placeholder="GE00 XX00 0000 0000 0000 00" aria-describedby="balBankIbanErr">
          <span class="hint">${esc(t('settings.payouts.ibanHint'))}</span></label>
        <p class="form-error bal-field-error" id="balBankIbanErr" data-bank-error="iban" role="alert" hidden></p>
      </fieldset>`;
  }

  function withdrawBox(d) {
    if (d.canWithdraw) {
      return `<form class="bal-withdraw" novalidate>
        ${d.balance.owedBack ? `<p class="muted small">${esc(fill('bal.debtNote', { amount: money(d.balance.owedBack) }))}</p>` : ''}
        ${d.closing ? `<p class="muted small">${esc(t('bal.closing'))}</p>` : ''}
        ${bankFields(d)}
        ${d.needsPassword
          ? `<label><span>${esc(t('bal.password'))}</span><input type="password" name="currentPassword" autocomplete="current-password"></label>`
          : `<p class="muted small">${esc(fill('bal.reauth', { minutes: d.reauthMinutes }))}</p>`}
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn btn-primary">${esc(fill('bal.withdraw', { amount: money(d.withdrawAmount) }))}</button>
      </form>`;
    }
    // (no bank account is never what stands in the way: it is asked for with the withdrawal)
    const first = d.blockers.find((b) => b !== 'no_payout_details') || d.blockers[0];
    const text = first === 'below_minimum' ? fill('bal.min', { amount: money(d.minimum) }) : t('bal.blocker.' + first);
    return `<p class="muted small bal-blocked">${esc(text)}</p>`;
  }

  function history(list) {
    if (!list.length) return '';
    return `<h3 class="earn-h">${esc(t('bal.history'))}</h3>
      <ul class="earn-list">${list.map((h) => `<li>
        <span>${esc(day(h.requestedAt || h.paidAt))}</span>
        <span><span class="badge badge-${STATUS[h.status] || 'badge-muted'}">${esc(t('bal.status.' + h.status))}</span>
          ${h.reference ? ` <span class="muted small">${esc(fill('bal.ref', { ref: h.reference }))}</span>` : ''}
          ${h.reason ? ` <span class="muted small">${esc(fill('bal.reason', { reason: h.reason }))}</span>` : ''}</span>
        <strong>${esc(money(h.amount))}</strong></li>`).join('')}</ul>`;
  }

  async function render(container) {
    if (!container) return;
    let d;
    try { d = await WisecallAPI.apiFetch('/me/balance'); } catch (e) { container.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    container.innerHTML = `<h2 class="earn-h">${esc(t('bal.title'))}</h2>${cards(d.balance)}${holds(d.holds)}${withdrawBox(d)}${history(d.history)}`;
    const form = container.querySelector('.bal-withdraw');
    if (!form) return;
    // (as typed, the line under a bank box goes)
    form.addEventListener('input', (ev) => {
      const which = { payoutName: 'name', payoutIban: 'iban' }[ev.target && ev.target.name];
      const line = which && form.querySelector(`[data-bank-error="${which}"]`);
      if (line) { line.textContent = ''; line.hidden = true; ev.target.setAttribute('aria-invalid', 'false'); }
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = form.querySelector('.form-error:not(.bal-field-error)');
      err.textContent = '';
      // (the bank account's own lines: what is wrong is said under the box it is about, with the box in focus)
      const bankError = (which, text) => {
        const line = form.querySelector(`[data-bank-error="${which}"]`);
        const input = form[which === 'name' ? 'payoutName' : 'payoutIban'];
        if (!line || !input) return false;
        line.textContent = text || '';
        line.hidden = !text;
        input.setAttribute('aria-invalid', text ? 'true' : 'false');
        if (text) input.focus();
        return true;
      };
      bankError('name', ''); bankError('iban', '');
      const body = { currentPassword: form.currentPassword ? form.currentPassword.value : undefined };
      if (d.needsPayoutDetails) {
        body.payout = { name: form.payoutName.value, iban: form.payoutIban.value };
        if (!body.payout.name.trim()) { bankError('name', t('settings.payouts.err.name')); return; }
        if (!body.payout.iban.trim()) { bankError('iban', t('settings.payouts.err.iban')); return; }
      }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await WisecallAPI.apiFetch('/me/withdrawals', { method: 'POST', body });
        WisecallNav.showToast(t('bal.sent'));
        document.dispatchEvent(new CustomEvent('wisecall:payout-saved'));
        await render(container);
      } catch (e) {
        btn.disabled = false;
        const bank = { invalid_payout_name: ['name', 'settings.payouts.err.name'], missing_fields: ['name', 'settings.payouts.err.name'], invalid_iban: ['iban', 'settings.payouts.err.iban'], payout_name_mismatch: ['name', 'bal.bank.err.name'] }[e.code];
        if (bank && bankError(bank[0], t(bank[1]))) return;
        const known = { wrong_password: 'settings.payouts.err.wrongPassword', password_required: 'settings.payouts.err.password', reauth_required: 'settings.payouts.reauth', too_many_requests: 'settings.payouts.err.tooMany' };
        err.textContent = e.code === 'below_minimum' ? fill('bal.min', { amount: money(d.minimum) })
          : t(known[e.code] || (t('bal.blocker.' + e.code) !== 'bal.blocker.' + e.code ? 'bal.blocker.' + e.code : 'toast.error'));
      }
    });
  }

  window.WisecallBalance = { render };
})();
