// The mentor's Balance card (Dashboard → Earnings and Settings → Payouts): available, on hold (with the dates), requested, paid out,
// owed back, the "Withdraw" button and the history of withdrawals. Everything comes from /api/me/balance (server/withdrawals.js); the
// amount to withdraw is always computed by the server.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (tetri) => WisecallAPI.formatAmount(tetri);
  const day = (d) => WisecallI18n.formatDate(d, { day: 'numeric', month: 'long', year: 'numeric' });
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const STATUS = { requested: 'pending_payment', paid: 'answered', rejected: 'rejected' };

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

  function withdrawBox(d) {
    if (d.canWithdraw) {
      return `<form class="bal-withdraw" novalidate>
        ${d.balance.owedBack ? `<p class="muted small">${esc(fill('bal.debtNote', { amount: money(d.balance.owedBack) }))}</p>` : ''}
        ${d.closing ? `<p class="muted small">${esc(t('bal.closing'))}</p>` : ''}
        ${d.needsPassword
          ? `<label><span>${esc(t('bal.password'))}</span><input type="password" name="currentPassword" autocomplete="current-password"></label>`
          : `<p class="muted small">${esc(fill('bal.reauth', { minutes: d.reauthMinutes }))}</p>`}
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn btn-primary">${esc(fill('bal.withdraw', { amount: money(d.withdrawAmount) }))}</button>
      </form>`;
    }
    const first = d.blockers[0];
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
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = form.querySelector('.form-error');
      err.textContent = '';
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await WisecallAPI.apiFetch('/me/withdrawals', { method: 'POST', body: { currentPassword: form.currentPassword ? form.currentPassword.value : undefined } });
        WisecallNav.showToast(t('bal.sent'));
        await render(container);
      } catch (e) {
        const known = { wrong_password: 'settings.payouts.err.wrongPassword', password_required: 'settings.payouts.err.password', reauth_required: 'settings.payouts.reauth', too_many_requests: 'settings.payouts.err.tooMany' };
        err.textContent = e.code === 'below_minimum' ? fill('bal.min', { amount: money(d.minimum) })
          : t(known[e.code] || (t('bal.blocker.' + e.code) !== 'bal.blocker.' + e.code ? 'bal.blocker.' + e.code : 'toast.error'));
        btn.disabled = false;
      }
    });
  }

  window.WisecallBalance = { render };
})();
