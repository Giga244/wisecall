// Dashboard → "Live sessions": everybody's tickets (join from 10 minutes before, cancel, calendar), and for a mentor their own sessions
// (new, edit, preview, open the room, cancel). The server decides who may do what; this tab shows its answers.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const when = (d) => WisecallI18n.formatDate(d, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const money = (tetri) => WisecallAPI.formatAmount(tetri);
  const TONE = { draft: 'badge-muted', review: 'badge-pending_payment', rejected: 'badge-rejected', published: 'badge-paid', live: 'badge-paid',
    ended: 'badge-answered', cancelled: 'badge-muted', paid: 'badge-paid', refund_pending: 'badge-pending_payment', refunded: 'badge-muted' };
  const badge = (status, key) => `<span class="badge ${TONE[status] || 'badge-muted'}">${esc(t(key))}</span>`;

  function ticketCard(tk) {
    const s = tk.session;
    return `<div class="booking-card live-ticket" data-ticket="${esc(tk.id)}">
      <div class="booking-head"><div>
        <div class="card-name"><a class="plain-link" href="/live/${encodeURIComponent(s.slug)}">${esc(s.title)}</a></div>
        <div class="card-role small">${esc(when(s.startsAt))} · ${esc(s.mentorName)}${s.timeChanged ? ` · <strong>${esc(t('live.dash.timeChanged'))}</strong>` : ''}</div>
      </div>${badge(tk.status === 'paid' ? s.status : tk.status, tk.status === 'paid' ? 'live.status.' + s.status : 'live.ticket.' + tk.status)}</div>
      <p class="live-ticket-actions">
        ${tk.canJoin ? `<a class="btn btn-primary btn-sm" href="/live/${encodeURIComponent(s.slug)}/room">${esc(t('live.join'))}</a>` : ''}
        ${tk.status === 'paid' && ['published', 'live'].includes(s.status) ? `<a class="btn btn-outline btn-sm" href="/api/live/tickets/${encodeURIComponent(tk.id)}/calendar.ics">${esc(t('live.addCalendar'))}</a>` : ''}
        ${tk.canCancel ? `<button type="button" class="btn btn-outline btn-sm lt-cancel" data-price="${tk.price}">${esc(t('live.dash.cancelTicket'))}</button>` : ''}
        ${tk.status === 'refunded' ? `<span class="muted small">${esc(fill('live.dash.refunded', { amount: money(tk.price) }))}</span>` : ''}
        ${tk.refundedAmount && tk.status === 'paid' ? `<span class="muted small">${esc(fill('live.dash.refunded', { amount: money(tk.refundedAmount) }))}</span>` : ''}
      </p>
      ${tk.dispute ? `<p class="small"><strong>${esc(t(tk.dispute.status === 'open' ? 'live.dash.reportOpen' : 'live.dash.reportDecided'))}</strong>${tk.dispute.note ? ' ' + esc(tk.dispute.note) : ''}</p>` : ''}
      ${tk.disputeUntil ? `<details class="lt-report"><summary class="small">${esc(t('live.dash.report'))}</summary>
        <form class="lt-report-form" novalidate>
          <label><span class="small">${esc(t('live.dash.reportReason'))}</span><select name="reason">${['not_as_described', 'technical', 'wrong_or_harmful', 'rude', 'other'].map((k) => `<option value="${k}">${esc(t('dash.dispute.r.' + k))}</option>`).join('')}</select></label>
          <label><span class="small">${esc(t('live.dash.reportDetails'))}</span><textarea name="details" rows="3" maxlength="1500"></textarea></label>
          <p class="hint">${esc(fill('live.dash.reportHint', { date: when(tk.disputeUntil) }))}</p>
          <button type="submit" class="btn btn-outline btn-sm">${esc(t('live.dash.reportSend'))}</button>
        </form></details>` : ''}
    </div>`;
  }

  function sessionCard(s) {
    const open = ['published', 'live'].includes(s.status) && Date.now() >= new Date(s.startsAt).getTime() - 10 * 60000;
    return `<div class="booking-card live-own" data-session="${esc(s.id)}">
      <div class="booking-head"><div>
        <div class="card-name">${esc(s.title)}</div>
        <div class="card-role small">${esc(when(s.startsAt))} · ${esc(t('live.kind.' + s.kind))} · ${esc(fill('live.dash.sold', { sold: s.sold, max: s.maxSeats }))}</div>
      </div>${badge(s.status, 'live.status.' + s.status)}</div>
      ${s.status === 'rejected' && s.reviewReason ? `<p class="small"><strong>${esc(t('live.dash.toChange'))}</strong> ${esc(s.reviewReason)}</p>` : ''}
      <p class="live-ticket-actions">
        ${open ? `<a class="btn btn-primary btn-sm" href="/live/${encodeURIComponent(s.slug)}/room">${esc(t('live.openRoom'))}</a>` : ''}
        ${['draft', 'review', 'rejected', 'published'].includes(s.status) ? `<a class="btn btn-outline btn-sm" href="/live-edit.html?id=${encodeURIComponent(s.id)}">${esc(t('live.dash.edit'))}</a>` : ''}
        <a class="btn btn-outline btn-sm" href="/live/${encodeURIComponent(s.slug)}">${esc(t(s.status === 'draft' ? 'live.edit.preview' : 'live.dash.page'))}</a>
        ${['draft', 'review', 'rejected', 'published'].includes(s.status) ? `<button type="button" class="btn btn-outline btn-sm ls-cancel">${esc(t('live.dash.cancelSession'))}</button>` : ''}
      </p>
    </div>`;
  }

  async function load(box, user) {
    box.innerHTML = `<p class="muted">${esc(t('experts.loading'))}</p>`;
    let d;
    try { d = await WisecallAPI.apiFetch('/live/mine'); } catch (e) { box.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    const mentor = user && (user.role === 'mentor' || user.role === 'both');
    const hostBlock = !mentor ? '' : `<section class="live-dash-host">
        <div class="live-dash-head"><h2 class="earn-h">${esc(t('live.dash.yourSessions'))}</h2>
          ${d.canHost ? `<a class="btn btn-primary btn-sm" href="/live-edit.html">${esc(t('live.dash.new'))}</a>` : ''}</div>
        ${d.canHost ? '' : `<p class="muted small">${esc(t('live.dash.cannotHost.' + (d.hostReason || 'not_listed')))}</p>`}
        ${d.sessions.length ? d.sessions.map(sessionCard).join('') : (d.canHost ? `<p class="muted small">${esc(t('live.dash.noSessions'))}</p>` : '')}
      </section>`;
    box.innerHTML = `${hostBlock}
      <section class="live-dash-tickets">
        <h2 class="earn-h">${esc(t('live.dash.yourTickets'))}</h2>
        ${d.tickets.length ? d.tickets.map(ticketCard).join('') : `<p class="muted small">${esc(t('live.dash.noTickets'))} <a class="plain-link" href="/live">${esc(t('live.dash.browse'))}</a></p>`}
      </section>`;
    box.querySelectorAll('.lt-cancel').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('[data-ticket]').dataset.ticket;
      if (!(await WisecallDialog.confirm({ message: t('live.dash.cancelTicketConfirm'), confirmText: fill('live.dash.cancelTicketButton', { amount: money(Number(b.dataset.price)) }), danger: true }))) return;
      try { await WisecallAPI.apiFetch(`/live/tickets/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); WisecallNav.showToast(t('live.dash.ticketCancelled')); load(box, user); }
      catch (e) { WisecallNav.showToast(t(e.code === 'too_late_to_cancel' ? 'live.err.too_late_to_cancel' : 'toast.error')); }
    }));
    box.querySelectorAll('.lt-report-form').forEach((f) => f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const id = f.closest('[data-ticket]').dataset.ticket;
      try {
        await WisecallAPI.apiFetch(`/live/tickets/${encodeURIComponent(id)}/dispute`, { method: 'POST', body: { reason: f.reason.value, details: f.details.value } });
        WisecallNav.showToast(t('live.dash.reportSent'));
        load(box, user);
      } catch (e) { WisecallNav.showToast(t('toast.error')); }
    }));
    box.querySelectorAll('.ls-cancel').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('[data-session]').dataset.session;
      if (!(await WisecallDialog.confirm({ message: t('live.dash.cancelSessionConfirm'), confirmText: t('live.dash.cancelSession'), danger: true }))) return;
      try { await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); WisecallNav.showToast(t('live.dash.sessionCancelled')); load(box, user); }
      catch (e) { WisecallNav.showToast(t('toast.error')); }
    }));
  }

  window.WisecallLiveDashboard = { load };
})();
