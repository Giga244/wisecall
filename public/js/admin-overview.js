// Admin: the overview tab (the numbers to check first). Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (tetri) => WisecallAPI.formatAmount(tetri);
  const field = (niche) => (niche === 'any' ? t('wait.any') : WisecallI18n.nicheName(niche));
  const card = (label, value, warn) => `<div class="earn-card${warn ? ' warn' : ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const section = (title, body) => `<h2 class="reviews-title overview-title">${esc(title)}</h2>${body}`;
  const cards = (list) => `<div class="earn-cards">${list.join('')}</div>`;
  const n = (v) => Number(v || 0).toLocaleString(WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const TONE = { high: 'badge-rejected', medium: 'badge-pending_payment', low: 'badge-muted', none: 'badge-muted' };

  async function render(container) {
    container.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    let d;
    try { d = await WisecallAPI.apiFetch('/admin/overview'); } catch (e) { container.innerHTML = `<p class="muted">${t('toast.error')}</p>`; return; }
    const a = d.applications.byStatus;
    const r = d.applications.waitingByRisk;
    const q = d.questions.byStatus;
    const wl = Object.entries(d.waitlist.byNiche);
    container.innerHTML = [
      section(t('admin.ov.signups'), cards([
        card(t('admin.ov.users'), n(d.signups.total)), card(t('admin.ov.week'), n(d.signups.week)),
        card(t('admin.ov.month'), n(d.signups.month)), card(t('admin.ov.mentors'), n(d.signups.mentors))])),
      section(t('admin.ov.applications'), cards([
        card(t('admin.ov.app.waiting'), n(a.pending), a.pending > 0), card(t('admin.ov.app.draft'), n(a.draft)),
        card(t('admin.ov.app.verified'), n(a.verified)), card(t('admin.ov.app.rejected'), n(a.rejected)),
        card(t('admin.ov.app.suspended'), n(a.suspended)), card(t('admin.ov.flags'), n(d.applications.openFlags), d.applications.openFlags > 0)])
        + `<p class="muted small">${esc(t('admin.ov.risk'))}: ${['high', 'medium', 'low', 'none'].map((k) => `<span class="badge ${TONE[k]}">${esc(t('admin.ov.risk.' + k))}: ${n(r[k])}</span>`).join(' ')}</p>`),
      section(t('admin.ov.waitlist'), `<p><strong>${esc(t('admin.wl.total').replace('{n}', n(d.waitlist.total)))}</strong></p>`
        + (wl.length ? `<p class="wl-counts">${wl.map(([k, v]) => `<span class="badge badge-paid">${esc(field(k))}: ${n(v)}</span>`).join(' ')}</p>` : '')),
      section(t('admin.ov.questions'), cards([
        card(t('admin.ov.q.month'), n(d.questions.paidLast30Days)), card(t('admin.ov.q.paid'), n(q.paid), q.paid > 0),
        card(t('admin.ov.q.answered'), n(q.answered)), card(t('admin.ov.q.unpaid'), n(q.pending_payment)), card(t('admin.ov.q.expired'), n(q.expired))])),
      section(t('admin.ov.problems'), cards([
        card(t('admin.ov.refunds.pending'), n(d.refunds.pending), d.refunds.pending > 0), card(t('admin.ov.refunds.full'), n(d.refunds.full)),
        card(t('admin.ov.refunds.partial'), n(d.refunds.partial)), card(t('admin.ov.refunds.amount'), money(d.refunds.amount)),
        card(t('admin.ov.disputes.open'), n(d.disputes.open), d.disputes.open > 0), card(t('admin.ov.disputes.resolved'), n(d.disputes.resolved)),
        card(t('admin.ov.safety'), n(d.disputes.openSafety), d.disputes.openSafety > 0), card(t('admin.ov.support'), n(d.disputes.openSupport), d.disputes.openSupport > 0)])),
      section(t('admin.ov.money'), cards([
        card(t('admin.ov.received'), money(d.money.received)), card(t('admin.ov.fee').replace('{percent}', d.feePercent), money(d.money.fee)),
        card(t('admin.ov.payable'), money(d.payouts.payable), d.payouts.payable > 0), card(t('admin.ov.holding'), money(d.payouts.holding)),
        card(t('admin.ov.debt'), money(d.payouts.debt), d.payouts.debt > 0), card(t('admin.ov.paidOut'), money(d.payouts.paidOut))])
        + `<p class="muted small">${esc(t('admin.ov.moneyHelp'))}</p>`
        + (d.money.testPayments ? `<p class="muted small">${esc(t('admin.ov.testPayments').replace('{n}', n(d.money.testPayments)))}</p>` : ''))
    ].join('');
  }

  window.AdminOverview = { render };
})();
