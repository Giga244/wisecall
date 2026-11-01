// Admin: people to keep an eye on (docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 6): the minors, when each confirmed a parent's permission, how many times contact
// details were stopped, per person, and the "unsafe" flag that suspends a mentor while it is looked at. Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => WisecallI18n.formatDate(d, { dateStyle: 'medium', timeStyle: 'short' });
  let onlyMinors = false;

  function card(p) {
    const isMentor = p.role === 'mentor' || p.role === 'both';
    return `
      <div class="booking-card sf-card" data-id="${esc(p.id)}">
        <div class="booking-top">
          <div>
            <div class="card-name">${esc(p.name)}</div>
            <span class="muted small">${esc(p.email)}</span>
          </div>
          ${p.minor ? `<span class="badge badge-pending_payment">${esc(t('admin.sf.minor'))}</span>` : ''}
          ${p.unsafe ? `<span class="badge badge-rejected">${esc(t('admin.sf.unsafe'))}</span>` : ''}
        </div>
        <p class="small">${esc(t('admin.sf.blocked').replace('{n}', p.blocked))}</p>
        ${p.minor ? `<p class="muted small">${esc(t('admin.sf.permission'))}: ${p.parentPermissionAt ? esc(fmt(p.parentPermissionAt)) : '—'}</p>` : ''}
        ${p.birthYm ? `<div class="mv-decide"><button class="btn btn-ghost btn-sm sf-clear">${esc(t('admin.sf.clearAge'))}</button></div>` : ''}
        ${isMentor && !p.unsafe && p.verificationStatus !== 'suspended' ? `
          <div class="mv-decide">
            <input type="text" class="sf-reason" maxlength="300" placeholder="${esc(t('admin.sf.reason'))}" aria-label="${esc(t('admin.sf.reason'))}">
            <button class="btn btn-ghost btn-sm sf-unsafe">${esc(t('admin.sf.markUnsafe'))}</button>
          </div>` : ''}
      </div>`;
  }

  async function render(container) {
    container.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    let data;
    try { data = await WisecallAPI.apiFetch(`/admin/people${onlyMinors ? '?minor=1' : ''}`); }
    catch (e) { container.innerHTML = `<p class="muted">${t('toast.error')}</p>`; return; }
    const reload = () => render(container);
    container.innerHTML = `
      <p class="muted small">${esc(t('admin.sf.help'))}</p>
      <div class="admin-filters" role="group">
        <button class="chip${onlyMinors ? '' : ' active'}" data-minor="">${esc(t('admin.sf.all'))}</button>
        <button class="chip${onlyMinors ? ' active' : ''}" data-minor="1">${esc(t('admin.sf.minor'))}</button>
      </div>
      ${data.people.length ? data.people.map(card).join('') : `<p class="muted">${esc(t('admin.sf.none'))}</p>`}`;
    container.querySelectorAll('[data-minor]').forEach((b) => b.addEventListener('click', () => { onlyMinors = Boolean(b.dataset.minor); reload(); }));
    container.querySelectorAll('.sf-card').forEach((el) => {
      const id = el.dataset.id;
      const clear = el.querySelector('.sf-clear');
      if (clear) clear.addEventListener('click', async () => {
        if (!(await WisecallDialog.confirm({ message: t('admin.sf.clearConfirm'), confirmText: t('admin.sf.clearAge'), danger: true }))) return;
        try { await WisecallAPI.apiFetch(`/admin/people/${id}/clear-age`, { method: 'POST' }); WisecallNav.showToast(t('toast.saved')); reload(); }
        catch (e) { WisecallNav.showToast(t('toast.error')); }
      });
      const unsafe = el.querySelector('.sf-unsafe');
      if (unsafe) unsafe.addEventListener('click', async () => {
        const reason = el.querySelector('.sf-reason').value.trim();
        if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
        if (!(await WisecallDialog.confirm({ message: t('admin.sf.unsafeConfirm'), confirmText: t('admin.sf.markUnsafe'), danger: true }))) return;
        try { await WisecallAPI.apiFetch(`/admin/people/${id}/unsafe`, { method: 'POST', body: { reason } }); WisecallNav.showToast(t('toast.saved')); reload(); }
        catch (e) { WisecallNav.showToast(t('toast.error')); }
      });
    });
  }

  window.AdminSafety = { render };
})();
