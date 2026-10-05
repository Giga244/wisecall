// Dashboard → "Live sessions": everybody's tickets (join from 10 minutes before, cancel, calendar, rate afterwards, gifts) and their
// 15 % codes, and for a mentor their own sessions (new, edit, preview, open the room, cancel, the share image, the summary for the
// people who attended) with their numbers. The server decides who may do what; this tab shows its answers.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const when = (d) => WisecallI18n.formatDate(d, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const day = (d) => WisecallI18n.formatDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
  const money = (tetri) => WisecallAPI.formatAmount(tetri);
  const errText = (e) => (t('live.err.' + e.code) !== 'live.err.' + e.code ? t('live.err.' + e.code) : t('toast.error'));
  const TONE = { draft: 'badge-muted', review: 'badge-pending_payment', rejected: 'badge-rejected', published: 'badge-paid', live: 'badge-paid',
    ended: 'badge-answered', cancelled: 'badge-muted', paid: 'badge-paid', refund_pending: 'badge-pending_payment', refunded: 'badge-muted' };
  const badge = (status, key) => `<span class="badge ${TONE[status] || 'badge-muted'}">${esc(t(key))}</span>`;
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  function giftLine(tk) {
    if (!tk.gift) return '';
    if (tk.gift.mine) {
      return `<p class="small">🎁 ${esc(fill(tk.gift.claimed ? 'live.gift.claimedBy' : 'live.gift.waitingFor', { email: tk.gift.email || '' }))}
        ${tk.canResendGift ? ` <button type="button" class="linklike lt-resend">${esc(t('live.gift.resend'))}</button>` : ''}</p>`;
    }
    return tk.gift.fromSomeone ? `<p class="small">🎁 ${esc(t('live.gift.received'))}</p>` : '';
  }

  // Stars and a comment, once, within 14 days of a session that took place.
  function rateForm(tk) {
    if (tk.rating) return `<p class="small">${esc(t('live.rate.yours'))} <span aria-label="${esc(fill('live.rate.starsLabel', { n: tk.rating }))}">${stars(tk.rating)}</span></p>`;
    if (!tk.canRate) return '';
    return `<details class="lt-rate" open><summary class="small"><strong>${esc(t('live.rate.title'))}</strong></summary>
      <form class="lt-rate-form" novalidate>
        <fieldset class="star-pick"><legend class="small">${esc(t('live.rate.stars'))}</legend>
          ${[5, 4, 3, 2, 1].map((n) => `<label class="checkbox-row"><input type="radio" name="stars" value="${n}"${n === 5 ? ' checked' : ''}> <span>${stars(n)} <span class="sr-only">${esc(fill('live.rate.starsLabel', { n }))}</span></span></label>`).join('')}
        </fieldset>
        <label><span class="small">${esc(t('live.rate.comment'))}</span><textarea name="comment" rows="2" maxlength="1000"></textarea></label>
        <p class="hint">${esc(t('live.rate.hint'))}</p>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-sm">${esc(t('live.rate.send'))}</button>
      </form></details>`;
  }

  function ticketCard(tk) {
    const s = tk.session;
    return `<div class="booking-card live-ticket" data-ticket="${esc(tk.id)}">
      <div class="booking-head"><div>
        <div class="card-name"><a class="plain-link" href="/live/${encodeURIComponent(s.slug)}">${esc(s.title)}</a></div>
        <div class="card-role small">${esc(when(s.startsAt))} · ${esc(s.mentorName)}${s.timeChanged ? ` · <strong>${esc(t('live.dash.timeChanged'))}</strong>` : ''}</div>
      </div>${badge(tk.status === 'paid' ? s.status : tk.status, tk.status === 'paid' ? 'live.status.' + s.status : 'live.ticket.' + tk.status)}</div>
      ${giftLine(tk)}
      <p class="live-ticket-actions">
        ${tk.canJoin ? `<a class="btn btn-primary btn-sm" href="/live/${encodeURIComponent(s.slug)}/room">${esc(t('live.join'))}</a>` : ''}
        ${tk.attends && tk.status === 'paid' && ['published', 'live'].includes(s.status) ? `<a class="btn btn-outline btn-sm" href="/api/live/tickets/${encodeURIComponent(tk.id)}/calendar.ics">${esc(t('live.addCalendar'))}</a>` : ''}
        ${tk.canCancel ? `<button type="button" class="btn btn-outline btn-sm lt-cancel" data-price="${tk.price}">${esc(t('live.dash.cancelTicket'))}</button>` : ''}
        ${tk.status === 'refunded' && !(tk.gift && tk.gift.fromSomeone) ? `<span class="muted small">${esc(fill('live.dash.refunded', { amount: money(tk.price) }))}</span>` : ''}
        ${tk.refundedAmount && tk.status === 'paid' ? `<span class="muted small">${esc(fill('live.dash.refunded', { amount: money(tk.refundedAmount) }))}</span>` : ''}
      </p>
      ${rateForm(tk)}
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

  // After a session that took place: a short summary and up to 5 links, sent to the attendees' Inbox (sent again when edited).
  function summaryForm(s) {
    if (s.status !== 'ended' || s.endKind !== 'normal') return '';
    const links = (s.summaryLinks || []).concat(Array(5).fill(null)).slice(0, 5);
    return `<details class="ls-summary"${s.summarySentAt ? '' : ' open'}><summary class="small"><strong>${esc(t(s.summarySentAt ? 'live.summary.edit' : 'live.summary.title'))}</strong></summary>
      <form class="ls-summary-form" novalidate>
        <label><span class="small">${esc(t('live.summary.text'))}</span><textarea name="summary" rows="4" maxlength="2000">${esc(s.summary || '')}</textarea></label>
        <fieldset><legend class="small">${esc(t('live.summary.links'))}</legend>
          ${links.map((l, i) => `<div class="ls-link-row">
            <label><span class="sr-only">${esc(fill('live.summary.linkTitle', { n: i + 1 }))}</span><input type="text" name="lt${i}" maxlength="100" placeholder="${esc(t('live.summary.linkTitlePh'))}" value="${esc(l ? l.title : '')}"></label>
            <label><span class="sr-only">${esc(fill('live.summary.linkUrl', { n: i + 1 }))}</span><input type="url" name="lu${i}" maxlength="500" inputmode="url" placeholder="https://" value="${esc(l ? l.url : '')}"></label>
          </div>`).join('')}
        </fieldset>
        <p class="hint">${esc(t('live.summary.hint'))}</p>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-sm">${esc(t(s.summarySentAt ? 'live.summary.resend' : 'live.summary.send'))}</button>
      </form></details>`;
  }

  function sessionCard(s) {
    const open = ['published', 'live'].includes(s.status) && Date.now() >= new Date(s.startsAt).getTime() - 10 * 60000;
    const shareable = ['published', 'live'].includes(s.status);
    return `<div class="booking-card live-own" data-session="${esc(s.id)}">
      <div class="booking-head"><div>
        <div class="card-name">${esc(s.title)}</div>
        <div class="card-role small">${esc(when(s.startsAt))} · ${esc(t('live.kind.' + s.kind))} · ${esc(fill('live.dash.sold', { sold: s.sold, max: s.maxSeats }))}${s.waiting ? ` · ${esc(fill('live.dash.waiting', { n: s.waiting }))}` : ''}</div>
      </div>${badge(s.status, 'live.status.' + s.status)}</div>
      ${s.status === 'rejected' && s.reviewReason ? `<p class="small"><strong>${esc(t('live.dash.toChange'))}</strong> ${esc(s.reviewReason)}</p>` : ''}
      <p class="live-ticket-actions">
        ${open ? `<a class="btn btn-primary btn-sm" href="/live/${encodeURIComponent(s.slug)}/room">${esc(t('live.openRoom'))}</a>` : ''}
        ${['draft', 'review', 'rejected', 'published'].includes(s.status) ? `<a class="btn btn-outline btn-sm" href="/live-edit.html?id=${encodeURIComponent(s.id)}">${esc(t('live.dash.edit'))}</a>` : ''}
        <a class="btn btn-outline btn-sm" href="/live/${encodeURIComponent(s.slug)}">${esc(t(s.status === 'draft' ? 'live.edit.preview' : 'live.dash.page'))}</a>
        ${shareable ? `<a class="btn btn-outline btn-sm" href="/api/live-share/${encodeURIComponent(s.id)}.png" download="wisecall-live.png">${esc(t('live.dash.shareImage'))}</a>` : ''}
        ${['draft', 'review', 'rejected', 'published'].includes(s.status) ? `<button type="button" class="btn btn-outline btn-sm ls-cancel">${esc(t('live.dash.cancelSession'))}</button>` : ''}
      </p>
      ${summaryForm(s)}
    </div>`;
  }

  // The mentor's numbers: per session and in total.
  function analytics(a) {
    if (!a || !a.sessions.length) return '';
    const tt = a.totals;
    const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);
    const tile = (label, value) => `<div class="earn-card"><span>${esc(t(label))}</span><strong>${esc(value)}</strong></div>`;
    return `<section class="live-dash-stats">
      <h2 class="earn-h">${esc(t('live.stats.title'))}</h2>
      <div class="earn-cards">
        ${tile('live.stats.sessions', String(tt.held))}${tile('live.stats.sold', String(tt.sold))}${tile('live.stats.attendance', pct(tt.attendanceRate))}
        ${tile('live.stats.net', money(tt.net))}${tile('live.stats.rating', tt.rating ? `★ ${tt.rating} (${tt.ratings})` : '—')}${tile('live.stats.followers', String(tt.followers))}
      </div>
      <div class="table-scroll"><table class="ov-sources live-stats-table">
        <thead><tr><th scope="col">${esc(t('live.stats.session'))}</th><th scope="col">${esc(t('live.stats.sold'))}</th><th scope="col">${esc(t('live.stats.attendance'))}</th>
          <th scope="col">${esc(t('live.stats.questions'))}</th><th scope="col">${esc(t('live.stats.net'))}</th><th scope="col">${esc(t('live.stats.rating'))}</th></tr></thead>
        <tbody>${a.sessions.slice(0, 50).map((s) => `<tr><td>${esc(s.title)}<br><span class="muted">${esc(day(s.startsAt))} · ${esc(t('live.status.' + s.status))}</span></td>
          <td>${s.sold}/${s.maxSeats}</td><td>${esc(pct(s.attendanceRate))}</td><td>${s.questions}</td><td>${esc(money(s.net))}</td>
          <td>${s.rating ? `★ ${esc(String(s.rating))} (${s.ratings})` : '—'}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">${esc(t('live.stats.hint'))}</p>
    </section>`;
  }

  function codes(list) {
    if (!list || !list.length) return '';
    return `<section class="live-dash-codes">
      <h2 class="earn-h">${esc(t('live.codes.title'))}</h2>
      <ul class="earn-list">${list.map((c) => `<li><span><code>${esc(c.code)}</code></span>
        <span>${esc(fill('live.codes.line', { percent: c.percent, name: c.mentorName }))}<br><span class="muted small">${esc(c.used ? t('live.codes.used') : (c.expired ? t('live.codes.expired') : fill('live.codes.until', { date: day(c.expiresAt) })))}</span></span>
        <span>${!c.used && !c.expired && c.mentorUsername ? `<a class="btn btn-outline btn-sm" href="/u/${encodeURIComponent(c.mentorUsername)}?code=${encodeURIComponent(c.code)}#ask">${esc(t('live.codes.use'))}</a>` : ''}</span></li>`).join('')}</ul>
    </section>`;
  }

  async function load(box, user) {
    box.innerHTML = `<p class="muted">${esc(t('experts.loading'))}</p>`;
    let d;
    try { d = await WisecallAPI.apiFetch('/live/mine'); } catch (e) { box.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    const mentor = user && (user.role === 'mentor' || user.role === 'both');
    const [a, c] = await Promise.all([
      mentor && d.sessions.length ? WisecallAPI.apiFetch('/live/analytics').catch(() => null) : null,
      WisecallAPI.apiFetch('/live/discounts').catch(() => null)
    ]);
    const hostBlock = !mentor ? '' : `<section class="live-dash-host">
        <div class="live-dash-head"><h2 class="earn-h">${esc(t('live.dash.yourSessions'))}</h2>
          ${d.canHost ? `<a class="btn btn-primary btn-sm" href="/live-edit.html">${esc(t('live.dash.new'))}</a>` : ''}</div>
        ${d.canHost ? '' : `<p class="muted small">${esc(t('live.dash.cannotHost.' + (d.hostReason || 'not_listed')))}</p>`}
        ${d.sessions.length ? d.sessions.map(sessionCard).join('') : (d.canHost ? `<p class="muted small">${esc(t('live.dash.noSessions'))}</p>` : '')}
      </section>${analytics(a)}`;
    box.innerHTML = `${hostBlock}
      <section class="live-dash-tickets">
        <h2 class="earn-h">${esc(t('live.dash.yourTickets'))}</h2>
        ${d.tickets.length ? d.tickets.map(ticketCard).join('') : `<p class="muted small">${esc(t('live.dash.noTickets'))} <a class="plain-link" href="/live">${esc(t('live.dash.browse'))}</a></p>`}
      </section>${codes(c && c.codes)}`;
    const reload = () => load(box, user);
    box.querySelectorAll('.lt-cancel').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('[data-ticket]').dataset.ticket;
      if (!(await WisecallDialog.confirm({ message: t('live.dash.cancelTicketConfirm'), confirmText: fill('live.dash.cancelTicketButton', { amount: money(Number(b.dataset.price)) }), danger: true }))) return;
      try { await WisecallAPI.apiFetch(`/live/tickets/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); WisecallNav.showToast(t('live.dash.ticketCancelled')); reload(); }
      catch (e) { WisecallNav.showToast(t(e.code === 'too_late_to_cancel' ? 'live.err.too_late_to_cancel' : 'toast.error')); }
    }));
    box.querySelectorAll('.lt-resend').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('[data-ticket]').dataset.ticket;
      b.disabled = true;
      try { await WisecallAPI.apiFetch(`/live/tickets/${encodeURIComponent(id)}/gift/resend`, { method: 'POST' }); WisecallNav.showToast(t('live.gift.resent')); }
      catch (e) { b.disabled = false; WisecallNav.showToast(t('toast.error')); }
    }));
    box.querySelectorAll('.lt-rate-form').forEach((f) => f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const id = f.closest('[data-ticket]').dataset.ticket;
      const err = f.querySelector('.form-error');
      err.textContent = '';
      const picked = f.querySelector('input[name="stars"]:checked');
      try {
        await WisecallAPI.apiFetch(`/live/tickets/${encodeURIComponent(id)}/rating`, { method: 'POST', body: { stars: Number(picked ? picked.value : 0), comment: f.comment.value } });
        WisecallNav.showToast(t('live.rate.thanks'));
        reload();
      } catch (e) { err.textContent = errText(e); }
    }));
    box.querySelectorAll('.lt-report-form').forEach((f) => f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const id = f.closest('[data-ticket]').dataset.ticket;
      try {
        await WisecallAPI.apiFetch(`/live/tickets/${encodeURIComponent(id)}/dispute`, { method: 'POST', body: { reason: f.reason.value, details: f.details.value } });
        WisecallNav.showToast(t('live.dash.reportSent'));
        reload();
      } catch (e) { WisecallNav.showToast(t('toast.error')); }
    }));
    box.querySelectorAll('.ls-summary-form').forEach((f) => f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const id = f.closest('[data-session]').dataset.session;
      const err = f.querySelector('.form-error');
      err.textContent = '';
      const links = [0, 1, 2, 3, 4].map((i) => ({ title: f[`lt${i}`].value.trim(), url: f[`lu${i}`].value.trim() })).filter((l) => l.url || l.title);
      try {
        const r = await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/summary`, { method: 'POST', body: { summary: f.summary.value, links } });
        WisecallNav.showToast(fill('live.summary.sent', { n: r.sentTo }));
        reload();
      } catch (e) { err.textContent = errText(e); }
    }));
    box.querySelectorAll('.ls-cancel').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('[data-session]').dataset.session;
      if (!(await WisecallDialog.confirm({ message: t('live.dash.cancelSessionConfirm'), confirmText: t('live.dash.cancelSession'), danger: true }))) return;
      try { await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); WisecallNav.showToast(t('live.dash.sessionCancelled')); reload(); }
      catch (e) { WisecallNav.showToast(t('toast.error')); }
    }));
  }

  window.WisecallLiveDashboard = { load };
})();
