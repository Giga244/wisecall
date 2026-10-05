// Admin: profiles. Reported profiles (look, then close the report with what you found); hiding one section or the whole profile with a
// reason the owner is told (logged), and showing it again; and, per mentor, the "Verified" mark on their profile items (with a note), next
// to the evidence the verification team accepted.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (d) => WisecallI18n.formatDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
  const SECTIONS = ['headline', 'about', 'experience', 'education', 'licences', 'skills', 'languages', 'projects', 'journey', 'links'];

  async function render(container) {
    container.innerHTML = `<p class="muted">${esc(t('admin.loading'))}</p>`;
    let d;
    try { d = await WisecallAPI.apiFetch('/admin/profiles/reports'); } catch (e) { container.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    container.innerHTML = `
      <h2 class="reviews-title">${esc(t('admin.pr.reports'))}</h2>
      ${d.reports.length ? `<ul class="earn-list">${d.reports.map((r) => `<li data-report="${esc(r.id)}" data-owner="${esc(r.owner.id)}"><span>${esc(when(r.createdAt))}</span>
          <span><a class="plain-link" href="/u/${encodeURIComponent(r.owner.username || '')}" target="_blank" rel="noopener">${esc(r.owner.name)}</a> · ${esc(t('admin.pr.reason.' + r.reason))}
            <br><span class="muted small">${esc(r.details || '')} · ${esc(r.reporter || '')}</span></span>
          <span class="payout-pay"><input type="text" class="pr-note" maxlength="500" placeholder="${esc(t('admin.live.resolvePh'))}" aria-label="${esc(t('admin.live.resolvePh'))}">
            <button type="button" class="btn btn-outline btn-sm pr-resolve">${esc(t('admin.live.resolve'))}</button></span></li>`).join('')}</ul>`
        : `<p class="muted small">${esc(t('admin.pr.none'))}</p>`}
      <h2 class="reviews-title">${esc(t('admin.pr.hideTitle'))}</h2>
      <form class="settings-card pr-hide" novalidate>
        <label>${esc(t('admin.pr.username'))}<input type="text" class="pr-user" maxlength="60" autocomplete="off"></label>
        <label>${esc(t('admin.pr.part'))}<select class="pr-section"><option value="">${esc(t('admin.pr.whole'))}</option>${SECTIONS.map((s) => `<option value="${s}">${esc(t('ps.s.' + s))}</option>`).join('')}</select></label>
        <label>${esc(t('admin.pr.reasonLabel'))}<input type="text" class="pr-reason" maxlength="500"></label>
        <p class="hint">${esc(t('admin.pr.hideHint'))}</p>
        <div class="payout-pay"><button type="submit" class="btn btn-danger btn-sm">${esc(t('admin.pr.hide'))}</button>
          <button type="button" class="btn btn-outline btn-sm pr-unhide">${esc(t('admin.pr.unhide'))}</button></div>
      </form>`;

    const ownerByName = async (username) => { const r = await WisecallAPI.apiFetch(`/users/${encodeURIComponent(username)}`); if (!r.profile) { const e = new Error('not_found'); e.code = 'not_found'; throw e; } return r.profile.id; };
    const act = async (fn, okKey) => {
      try { await fn(); WisecallNav.showToast(t(okKey || 'toast.saved')); render(container); }
      catch (e) { WisecallNav.showToast(t({ reason_required: 'admin.mv.reasonRequired', not_found: 'admin.pr.notFound' }[e.code] || 'toast.error')); }
    };
    container.querySelectorAll('.pr-resolve').forEach((b) => b.addEventListener('click', () => {
      const li = b.closest('li');
      const note = li.querySelector('.pr-note').value.trim();
      if (note.length < 3) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
      act(() => WisecallAPI.apiFetch(`/admin/profiles/reports/${li.dataset.report}/resolve`, { method: 'POST', body: { resolution: note } }));
    }));
    const form = container.querySelector('.pr-hide');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const reason = form.querySelector('.pr-reason').value.trim();
      if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
      act(async () => {
        const id = await ownerByName(form.querySelector('.pr-user').value.trim());
        await WisecallAPI.apiFetch(`/admin/profiles/${id}/hide`, { method: 'POST', body: { section: form.querySelector('.pr-section').value || null, reason } });
      }, 'admin.pr.hidden');
    });
    form.querySelector('.pr-unhide').addEventListener('click', () => act(async () => {
      const id = await ownerByName(form.querySelector('.pr-user').value.trim());
      await WisecallAPI.apiFetch(`/admin/profiles/${id}/unhide`, { method: 'POST', body: { section: form.querySelector('.pr-section').value || null } });
    }, 'admin.pr.shown'));
  }

  // In a mentor's verification card: their profile items, each with "Verified" on or off (and the note).
  async function itemsBlock(mentorId) {
    let d;
    try { d = await WisecallAPI.apiFetch(`/admin/profiles/${encodeURIComponent(mentorId)}/items`); } catch (e) { return ''; }
    if (!d.items.length) return `<p class="muted small">${esc(t('admin.pr.noItems'))}</p>`;
    const label = (it) => ({ experience: `${it.title} · ${it.organisation}`, education: [it.school, it.degree].filter(Boolean).join(' · '), licence: `${it.name} · ${it.issuer}`,
      project: it.title, journey: it.title }[it.section]);
    return `<ul class="earn-list pr-items">${d.items.filter((it) => it.section !== 'journey' && it.section !== 'project').map((it) => `<li data-item="${esc(it.id)}">
      <span>${esc(t('ps.s.' + ({ licence: 'licences' }[it.section] || it.section)))}</span><span>${esc(label(it))}${it.verified ? `<br><span class="muted small">✓ ${esc(it.verifiedNote || '')}</span>` : ''}</span>
      <span class="payout-pay">${it.verified ? `<button type="button" class="btn btn-outline btn-sm pr-unverify">${esc(t('admin.pr.unverify'))}</button>`
        : `<input type="text" class="pr-vnote" maxlength="500" placeholder="${esc(t('admin.pr.verifyPh'))}" aria-label="${esc(t('admin.pr.verifyPh'))}"><button type="button" class="btn btn-outline btn-sm pr-verify">${esc(t('admin.pr.verify'))}</button>`}</span></li>`).join('')}</ul>`;
  }
  function wireItems(box, reload) {
    box.addEventListener('click', async (ev) => {
      const li = ev.target.closest('li[data-item]');
      if (!li) return;
      const on = Boolean(ev.target.closest('.pr-verify'));
      if (!on && !ev.target.closest('.pr-unverify')) return;
      const note = on ? li.querySelector('.pr-vnote').value.trim() : '';
      if (on && note.length < 3) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
      try { await WisecallAPI.apiFetch(`/admin/profile-items/${li.dataset.item}/verify`, { method: 'POST', body: { verified: on, note } }); WisecallNav.showToast(t('toast.saved')); reload(); }
      catch (e) { WisecallNav.showToast(t('toast.error')); }
    });
  }

  window.AdminProfiles = { render, itemsBlock, wireItems };
})();
