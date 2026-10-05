// Admin: live sessions. The approval queue (a mentor's first 3 sessions: approve, approve with edited text, or reject with a reason),
// what is upcoming and live now (end a session at once for safety: everybody is refunded), open reports, and allowing a mentor who has
// not answered a question yet to host.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const when = (d) => WisecallI18n.formatDate(d, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const money = (tetri) => WisecallAPI.formatAmount(tetri);

  function reviewCard(s) {
    return `<form class="booking-card lv-review" data-id="${esc(s.id)}" novalidate>
      <div class="booking-head"><div><div class="card-name">${esc(s.mentor.name)}</div><div class="card-role small">${esc(s.mentor.email)} · ${esc(when(s.startsAt))} · ${esc(t('live.kind.' + s.kind))} · ${esc(money(s.price))}</div></div>
        ${s.regulated ? `<span class="badge badge-pending_payment">${esc(t('admin.live.regulated'))}</span>` : ''}</div>
      <label>${esc(t('admin.live.title'))}<input type="text" class="lv-title" maxlength="100" value="${esc(s.title)}"></label>
      <label>${esc(t('admin.live.description'))}<textarea class="lv-description" rows="5" maxlength="4000">${esc(s.description)}</textarea></label>
      <ul class="small">${(s.learnPoints || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <p><a class="btn btn-outline btn-sm" href="/live/${encodeURIComponent(s.slug)}" target="_blank" rel="noopener">${esc(t('admin.live.preview'))}</a></p>
      <div class="payout-pay">
        <button type="button" class="btn btn-primary btn-sm lv-approve">${esc(t('admin.live.approve'))}</button>
        <input type="text" class="lv-reason" maxlength="500" placeholder="${esc(t('admin.live.reasonPh'))}" aria-label="${esc(t('admin.live.reasonPh'))}">
        <button type="button" class="btn btn-outline btn-sm lv-reject">${esc(t('admin.live.reject'))}</button>
      </div>
    </form>`;
  }
  function sessionRow(s) {
    const active = ['published', 'live'].includes(s.status);
    return `<li data-id="${esc(s.id)}"><span>${esc(when(s.startsAt))}</span>
      <span><a class="plain-link" href="/live/${encodeURIComponent(s.slug)}" target="_blank" rel="noopener">${esc(s.title)}</a><br>
        <span class="muted small">${esc(s.mentor.name)} · ${esc(fill('live.dash.sold', { sold: s.sold, max: s.maxSeats }))}${s.openReports ? ` · <strong>${esc(fill('admin.live.reports', { n: s.openReports }))}</strong>` : ''}${s.cancelReason ? ` · ${esc(t('admin.live.cancel.' + s.cancelReason))}` : ''}</span></span>
      <span class="lv-row-end"><span class="badge ${s.status === 'live' ? 'badge-paid' : 'badge-muted'}">${esc(t('live.status.' + s.status))}</span>
      ${active ? `<button type="button" class="btn btn-danger btn-sm lv-end">${esc(t('admin.live.end'))}</button>` : ''}</span></li>`;
  }

  async function render(container) {
    container.innerHTML = `<p class="muted">${esc(t('admin.loading'))}</p>`;
    let d;
    try { d = await WisecallAPI.apiFetch('/admin/live'); } catch (e) { container.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    const review = d.sessions.filter((s) => s.status === 'review');
    const active = d.sessions.filter((s) => ['published', 'live'].includes(s.status));
    const past = d.sessions.filter((s) => ['ended', 'cancelled'].includes(s.status));
    container.innerHTML = `
      <h2 class="reviews-title">${esc(fill('admin.live.queue', { n: review.length }))}</h2>
      ${review.length ? review.map(reviewCard).join('') : `<p class="muted small">${esc(t('admin.live.queueEmpty'))}</p>`}
      <h2 class="reviews-title">${esc(t('admin.live.reportsTitle'))}</h2>
      ${d.reports.length ? `<ul class="earn-list">${d.reports.map((r) => `<li data-report="${esc(r.id)}"><span>${esc(when(r.createdAt))}</span>
          <span><strong>${esc(r.title)}</strong> · ${esc(t('admin.live.reason.' + r.reason))}<br><span class="muted small">${esc(r.details || '')} · ${esc(r.reporter || '')}</span></span>
          <span class="payout-pay"><input type="text" class="lr-note" maxlength="500" placeholder="${esc(t('admin.live.resolvePh'))}" aria-label="${esc(t('admin.live.resolvePh'))}">
          <button type="button" class="btn btn-outline btn-sm lr-resolve">${esc(t('admin.live.resolve'))}</button></span></li>`).join('')}</ul>` : `<p class="muted small">${esc(t('admin.live.noReports'))}</p>`}
      <h2 class="reviews-title">${esc(t('admin.live.upcoming'))}</h2>
      ${active.length ? `<ul class="earn-list">${active.map(sessionRow).join('')}</ul>` : `<p class="muted small">${esc(t('admin.live.none'))}</p>`}
      <h2 class="reviews-title">${esc(t('admin.live.past'))}</h2>
      ${past.length ? `<ul class="earn-list">${past.map(sessionRow).join('')}</ul>` : `<p class="muted small">${esc(t('admin.live.none'))}</p>`}
      <h2 class="reviews-title">${esc(t('admin.live.hostsTitle'))}</h2>
      <form class="payout-pay lv-host-form"><input type="email" class="lv-host-email" placeholder="${esc(t('admin.live.hostEmail'))}" aria-label="${esc(t('admin.live.hostEmail'))}">
        <button type="submit" class="btn btn-outline btn-sm">${esc(t('admin.live.allowHost'))}</button></form>
      <p class="muted small">${esc(t('admin.live.hostsHelp'))}</p>`;

    const post = async (path, body, okKey) => {
      try { await WisecallAPI.apiFetch(path, { method: 'POST', body }); WisecallNav.showToast(t(okKey || 'toast.saved')); render(container); }
      catch (e) { WisecallNav.showToast(t({ reason_required: 'admin.mv.reasonRequired', video_unavailable: 'admin.live.videoDown', not_found: 'admin.live.notFound' }[e.code] || 'toast.error')); }
    };
    container.querySelectorAll('.lv-review').forEach((card) => {
      const id = card.dataset.id;
      card.addEventListener('submit', (ev) => ev.preventDefault());
      card.querySelector('.lv-approve').addEventListener('click', () => post(`/admin/live/${id}/approve`,
        { title: card.querySelector('.lv-title').value, description: card.querySelector('.lv-description').value }, 'admin.live.approved'));
      card.querySelector('.lv-reject').addEventListener('click', () => {
        const reason = card.querySelector('.lv-reason').value.trim();
        if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
        post(`/admin/live/${id}/reject`, { reason }, 'admin.live.rejected');
      });
    });
    container.querySelectorAll('.lv-end').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('li').dataset.id;
      if (!(await WisecallDialog.confirm({ message: t('admin.live.endConfirm'), confirmText: t('admin.live.end'), danger: true }))) return;
      post(`/admin/live/${id}/end`, { reason: t('admin.live.endReason') }, 'admin.live.ended');
    }));
    container.querySelectorAll('.lr-resolve').forEach((b) => b.addEventListener('click', () => {
      const li = b.closest('li');
      const note = li.querySelector('.lr-note').value.trim();
      if (note.length < 3) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
      post(`/admin/live/reports/${li.dataset.report}/resolve`, { resolution: note });
    }));
    container.querySelector('.lv-host-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const email = container.querySelector('.lv-host-email').value.trim();
      if (email) post('/admin/live/hosts', { email, allow: true }, 'admin.live.hostAllowed');
    });
  }

  window.AdminLive = { render };
})();
