// Admin: "Find me a mentor" requests. Counts by field and by week, the fields people want with no approved mentor (who to invite), every
// request (admins only: they carry emails), a CSV, merging two spellings of one field, and an outreach message to copy for a field.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = (d) => WisecallI18n.formatDate(d, { dateStyle: 'medium' });
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (x) { ok = false; }
      ta.remove(); return ok;
    }
  }

  async function render(container) {
    container.innerHTML = `<p class="muted">${esc(t('admin.loading'))}</p>`;
    let d;
    try { d = await WisecallAPI.apiFetch('/admin/requests'); } catch (e) { container.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    if (!d.requests.length) { container.innerHTML = `<p class="muted">${esc(t('admin.rq.empty'))}</p>`; return; }
    const options = d.byField.map((f) => `<option value="${esc(f.key)}">${esc(f.label)} (${f.count})</option>`).join('');
    container.innerHTML = `
      <div class="payout-toolbar"><a class="btn btn-outline btn-sm" href="/api/admin/requests.csv" download>${esc(t('admin.rq.csv'))}</a></div>
      <h2 class="reviews-title">${esc(t('admin.rq.unserved'))}</h2>
      ${d.topUnserved.length ? `<ul class="earn-list">${d.topUnserved.map((f) => `<li><span>${esc(f.label)}</span><span class="muted small">${esc(fill('admin.rq.people', { n: f.count }))}</span>
        <button type="button" class="btn btn-outline btn-sm rq-copy" data-field="${esc(f.label)}" data-count="${f.count}">${esc(t('admin.rq.copy'))}</button></li>`).join('')}</ul>` : `<p class="muted small">${esc(t('admin.rq.allServed'))}</p>`}
      <h2 class="reviews-title">${esc(t('admin.rq.byField'))}</h2>
      <ul class="earn-list">${d.byField.map((f) => `<li><span>${esc(f.label)}</span><span class="muted small">${esc(f.niche === 'other' ? t('niche.other') : t('niche.' + f.niche))}${f.hasMentor ? ' · ' + esc(t('admin.rq.hasMentor')) : ''}</span><strong>${f.count}</strong></li>`).join('')}</ul>
      <div class="payout-pay rq-merge">
        <label><span class="small">${esc(t('admin.rq.mergeFrom'))}</span><select class="rq-from">${options}</select></label>
        <label><span class="small">${esc(t('admin.rq.mergeInto'))}</span><select class="rq-into">${options}</select></label>
        <button type="button" class="btn btn-outline btn-sm rq-merge-btn">${esc(t('admin.rq.merge'))}</button>
      </div>
      <h2 class="reviews-title">${esc(t('admin.rq.byWeek'))}</h2>
      <ul class="earn-list">${d.byWeek.map((w) => `<li><span>${esc(day(w.week))}</span><strong>${w.n}</strong></li>`).join('')}</ul>
      <h2 class="reviews-title">${esc(t('admin.rq.all'))}</h2>
      <ul class="earn-list">${d.requests.map((r) => `<li><span>${esc(day(r.createdAt))}</span><span><strong>${esc(r.field)}</strong> · ${esc(r.email)}<br><span class="muted small">${esc(r.need)}</span></span>
        <span class="badge badge-muted">${esc(t('admin.rq.status.' + r.status))}</span></li>`).join('')}</ul>`;
    container.querySelectorAll('.rq-copy').forEach((b) => b.addEventListener('click', async () => {
      const ok = await copy(fill('admin.rq.outreach', { field: b.dataset.field, count: b.dataset.count }));
      WisecallNav.showToast(t(ok ? 'admin.rq.copied' : 'toast.error'));
    }));
    container.querySelector('.rq-merge-btn').addEventListener('click', async () => {
      const from = container.querySelector('.rq-from').value, into = container.querySelector('.rq-into').value;
      if (from === into) return;
      try { const r = await WisecallAPI.apiFetch('/admin/requests/merge', { method: 'POST', body: { from, into } }); WisecallNav.showToast(fill('admin.rq.merged', { n: r.merged })); render(container); }
      catch (e) { WisecallNav.showToast(t('toast.error')); }
    });
  }

  window.AdminRequests = { render };
})();
