// Admin: the Reviews tab. Reported reviews (hide or dismiss, with a written reason), hidden reviews (show again), and askers whose
// average rating from mentors is low. Every decision needs a reason of at least 5 characters, and is logged on the server.
// Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (s, vars) => Object.keys(vars).reduce((out, k) => out.split('{' + k + '}').join(vars[k]), s);
  const locale = () => (WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const fmt = (d) => new Date(d).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

  const ratingHtml = (r) => `
    <div class="booking-answer">
      ${WisecallRatings.stars(r.stars)} <span class="badge badge-paid">${t('admin.rv.direction.' + r.direction)}</span>
      ${WisecallRatings.tagList(r.tags)}
      <p class="review-text">${r.review ? esc(r.review) : `<span class="muted">${t('admin.rv.noText')}</span>`}</p>
    </div>`;

  function reportCard(p) {
    return `
      <div class="booking-card q-card rv-card" data-report="${esc(p.id)}" data-rating="${esc(p.ratingId)}">
        <p class="muted small">${esc(fill(t('admin.rv.from'), { name: p.rating.rater.name, email: p.rating.rater.email, ratee: p.rating.ratee.name }))}</p>
        ${ratingHtml(p.rating)}
        ${p.rating.reply ? `<p class="muted small">${esc(fill(t('admin.rv.reply'), { text: p.rating.reply }))}</p>` : ''}
        <p class="muted small"><span class="badge badge-rejected">${t('report.review.reason.' + p.reason)}</span> ${esc(fill(t('admin.rv.reportedBy'), { name: p.reporter.name, email: p.reporter.email, reason: '' }))}${p.details ? `<br>${esc(p.details)}` : ''} · ${fmt(p.createdAt)}</p>
        <div class="mv-decide">
          <input type="text" class="rv-reason" maxlength="300" placeholder="${esc(t('admin.rv.reason'))}" aria-label="${esc(t('admin.rv.reason'))}">
          <button class="btn btn-outline btn-sm rv-dismiss">${t('admin.rv.dismiss')}</button>
          <button class="btn btn-primary btn-sm rv-hide">${t('admin.rv.hide')}</button>
        </div>
      </div>`;
  }

  function hiddenCard(h) {
    return `
      <div class="booking-card q-card rv-card" data-rating="${esc(h.id)}">
        <p class="muted small">${esc(fill(t('admin.rv.from'), { name: h.rater, email: '', ratee: h.ratee }).replace(' ()', ''))}</p>
        ${ratingHtml(h)}
        <p class="muted small">${esc(fill(t('admin.rv.hiddenBy'), { by: h.by || '?', date: fmt(h.hiddenAt), reason: h.reason || '' }))}</p>
        <div class="mv-decide">
          <input type="text" class="rv-reason" maxlength="300" placeholder="${esc(t('admin.rv.reason'))}" aria-label="${esc(t('admin.rv.reason'))}">
          <button class="btn btn-outline btn-sm rv-unhide">${t('admin.rv.unhide')}</button>
        </div>
      </div>`;
  }

  function askerCard(a) {
    return `
      <div class="booking-card q-card rv-card" data-flag="${esc(a.flagId)}">
        <div class="booking-top"><div><div class="card-name">${esc(a.name)}</div><span class="muted small">${esc(a.email)}</span></div>
          <span class="badge badge-rejected">${esc(fill(t('admin.rv.askerAvg'), { avg: a.average, n: a.ratings }))}</span></div>
        <div class="mv-decide">
          <input type="text" class="rv-reason" maxlength="300" placeholder="${esc(t('admin.rv.reason'))}" aria-label="${esc(t('admin.rv.reason'))}">
          <button class="btn btn-outline btn-sm rv-resolve">${t('admin.rv.resolve')}</button>
        </div>
      </div>`;
  }

  async function render(container) {
    container.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    let data;
    try { data = await WisecallAPI.apiFetch('/admin/reviews'); } catch (e) { container.innerHTML = `<p class="muted">${t('toast.error')}</p>`; return; }
    const reload = () => render(container);
    const section = (title, list, empty, card, help) => `
      <h2 class="reviews-title"${title === 'admin.rv.reports' ? '' : ' style="margin-top:32px"'}>${t(title)} (${list.length})</h2>
      ${help ? `<p class="muted small">${t(help)}</p>` : ''}
      ${list.length ? list.map(card).join('') : `<p class="muted">${t(empty)}</p>`}`;
    container.innerHTML =
      section('admin.rv.reports', data.reports, 'admin.rv.noReports', reportCard) +
      section('admin.rv.askers', data.askers, 'admin.rv.noAskers', askerCard, 'admin.rv.askersHelp') +
      section('admin.rv.hidden', data.hidden, 'admin.rv.noHidden', hiddenCard);

    container.querySelectorAll('.rv-card').forEach((card) => {
      const reason = () => card.querySelector('.rv-reason').value.trim();
      const post = async (path, body) => {
        if (body.reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
        try { await WisecallAPI.apiFetch(path, { method: 'POST', body }); WisecallNav.showToast(t('toast.saved')); reload(); } catch (e) { WisecallNav.showToast(t(e.code === 'reason_required' ? 'admin.mv.reasonRequired' : 'toast.error')); }
      };
      const on = (sel, fn) => { const el = card.querySelector(sel); if (el) el.addEventListener('click', fn); };
      on('.rv-hide', () => { if (window.confirm(t('admin.rv.hideConfirm'))) post(`/admin/review-reports/${card.dataset.report}/resolve`, { decision: 'hide', reason: reason() }); });
      on('.rv-dismiss', () => post(`/admin/review-reports/${card.dataset.report}/resolve`, { decision: 'dismiss', reason: reason() }));
      on('.rv-unhide', () => post(`/admin/reviews/${card.dataset.rating}/unhide`, { reason: reason() }));
      on('.rv-resolve', () => post(`/admin/flags/${card.dataset.flag}/resolve`, { reason: reason() }));
    });
  }

  window.AdminReviews = { render };
})();
