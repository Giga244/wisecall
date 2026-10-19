// Admin: the waiting list ("get notified when mentors in your field join"). Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = (d) => WisecallI18n.formatDate(d, { dateStyle: 'medium' });
  const field = (niche) => (niche === 'any' ? t('wait.any') : t('niche.' + niche));

  async function render(container) {
    container.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    let data;
    try { data = await WisecallAPI.apiFetch('/admin/waitlist'); } catch (e) { container.innerHTML = `<p class="muted">${t('toast.error')}</p>`; return; }
    if (!data.total) { container.innerHTML = `<p class="muted">${t('admin.wl.empty')}</p>`; return; }

    const counts = Object.entries(data.byNiche).sort((a, b) => b[1] - a[1])
      .map(([niche, n]) => `<span class="badge badge-paid">${esc(field(niche))}: ${n}</span>`).join(' ');
    container.innerHTML = `
      <div class="payout-toolbar">
        <a class="btn btn-outline btn-sm" href="/api/admin/waitlist.csv" download>${t('admin.wl.csv')}</a>
      </div>
      <p class="muted small">${t('admin.wl.help')}</p>
      <p><strong>${t('admin.wl.total').replace('{n}', data.total)}</strong></p>
      <p class="wl-counts">${counts}</p>
      <section class="wl-demand" aria-labelledby="wlDemandTitle">
        <h2 id="wlDemandTitle" class="reviews-title overview-title">${t('admin.wl.demand')}</h2>
        <p class="muted small">${t('admin.wl.demandHelp')}</p>
        ${(data.demand || []).length ? `<ul class="earn-list">${data.demand.map((d) => `
          <li><span>${esc(d.question)}</span><span>${esc(field(d.niche))} · ${day(d.createdAt)}</span></li>`).join('')}</ul>` : `<p class="muted small">${t('admin.wl.demandEmpty')}</p>`}
      </section>
      <ul class="earn-list">${data.signups.map((s) => `
        <li><span>${esc(s.email)}</span><span>${esc(field(s.niche))} · ${day(s.createdAt)}</span>
        <span class="badge ${s.notifiedAt ? 'badge-answered' : 'badge-pending_payment'}">${t(s.notifiedAt ? 'admin.wl.notified' : 'admin.wl.waiting')}</span></li>`).join('')}</ul>`;
  }

  window.AdminWaitlist = { render };
})();
