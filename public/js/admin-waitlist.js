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
    // (the log of deleted addresses stays in sight when the list is empty)
    const deletions = (data.deletions || []).length ? `<details class="mv-audit wl-deletions"><summary>${t('admin.wl.deletions')} (${data.deletions.length})</summary>
        <ul class="earn-list">${data.deletions.map((d) => `<li><span>${day(d.at)} · ${esc(d.by || '')}</span>
          <span>${esc(t('admin.wl.deletedWhat').replace('{n}', d.entries).replace('{fields}', d.fields.map(field).join(', ')))}${d.requests ? ' · ' + esc(t('admin.wl.deletedRequests').replace('{n}', d.requests)) : ''}</span></li>`).join('')}</ul>
      </details>` : '';
    if (!data.total) { container.innerHTML = `<p class="muted">${t('admin.wl.empty')}</p>${deletions}`; return; }

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
      <ul class="earn-list wl-list">${data.signups.map((s) => `
        <li><span>${esc(s.email)}</span><span>${esc(field(s.niche))} · ${day(s.createdAt)}</span>
        <span class="badge ${s.notifiedAt ? 'badge-answered' : 'badge-pending_payment'}">${t(s.notifiedAt ? 'admin.wl.notified' : 'admin.wl.waiting')}</span>
        <button type="button" class="btn btn-ghost btn-sm wl-delete" data-wl-delete="${esc(s.id)}">${t('admin.wl.delete')}</button></li>`).join('')}</ul>
      ${deletions}`;

    // "წაშლა": asks first; the address goes from every field it waited for (the server logs it, without the address).
    container.querySelectorAll('[data-wl-delete]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await WisecallDialog.confirm({ message: t('admin.wl.deleteConfirm'), confirmText: t('admin.wl.delete'), danger: true }))) return;
      b.disabled = true;
      try {
        await WisecallAPI.apiFetch(`/admin/waitlist/${encodeURIComponent(b.dataset.wlDelete)}`, { method: 'DELETE' });
        WisecallNav.showToast(t('admin.wl.deleted'));
        await render(container);
      } catch (e) {
        b.disabled = false;
        WisecallNav.showToast(t('toast.error'));
      }
    }));
  }

  window.AdminWaitlist = { render };
})();
