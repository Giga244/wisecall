// Admin: the categories (docs/CLAUDE-CODE-CATEGORIES.md): mentors who could not be mapped to a field, the most-used free tags (to promote into chips in
// server/categories.js), and how many mentors and questions each field and chip has. Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const table = (rows) => `<ul class="cat-list">${rows.map(([a, b]) => `<li><span>${esc(a)}</span> <strong>${esc(b)}</strong></li>`).join('')}</ul>`;

  async function render(container) {
    container.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    let d;
    try { d = await WisecallAPI.apiFetch('/admin/categories'); } catch (e) { container.innerHTML = `<p class="muted">${t('toast.error')}</p>`; return; }
    const chipName = (id) => { const c = d.chips.find((x) => x.id === id); return c ? WisecallI18n.nameIn(c) : id; };
    container.innerHTML = `
      <h2 class="reviews-title">${t('admin.cat.unmapped')} (${d.unmapped.length})</h2>
      <p class="muted small">${t('admin.cat.unmappedHelp')}</p>
      ${d.unmapped.length ? d.unmapped.map((m) => `<div class="booking-card"><div class="card-name">${esc(m.name)}</div><span class="muted small">${esc(m.email)} · ${esc(m.customNiche || m.niche || '')}</span></div>`).join('') : `<p class="muted">${t('admin.cat.noUnmapped')}</p>`}
      <h2 class="reviews-title" style="margin-top:32px">${t('admin.cat.tags')}</h2>
      <p class="muted small">${t('admin.cat.tagsHelp')}</p>
      ${d.tags.length ? table(d.tags.map((x) => [x.tag, x.n])) : `<p class="muted">${t('admin.empty')}</p>`}
      <h2 class="reviews-title" style="margin-top:32px">${t('admin.cat.questions')}</h2>
      ${d.questions.length ? table(d.questions.map((x) => [chipName(x.id), x.n])) : `<p class="muted">${t('admin.empty')}</p>`}
      <h2 class="reviews-title" style="margin-top:32px">${t('admin.cat.mentors')}</h2>
      ${table(d.fields.map((f) => [WisecallI18n.nameIn(f), f.mentors]))}
      ${d.chips.length ? table(d.chips.map((c) => [WisecallI18n.nameIn(c), c.mentors])) : ''}`;
  }
  window.AdminCategories = { render };
})();
