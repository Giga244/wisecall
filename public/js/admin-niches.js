// Admin: the niches (fields), and the ones mentors suggested by choosing "Other (type your own)". Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  let data = null;

  const iconSelect = (name, selected) => `<select name="${name}" aria-label="${esc(t('admin.niches.icon'))}">${data.icons.map((i) => `<option value="${i}"${i === selected ? ' selected' : ''}>${i}</option>`).join('')}</select>`;
  const errText = (e) => t(e.code === 'invalid_name' ? 'admin.niches.err.invalid_name' : (e.code === 'regulated_by_law' ? 'admin.niches.regulatedLocked' : 'toast.error'));

  function nicheForm(n, idPrefix) {
    return `
      <form class="nf-form" data-key="${n ? esc(n.key) : ''}">
        <label for="${idPrefix}-en"><span>${t('admin.niches.en')}</span><input id="${idPrefix}-en" name="en" maxlength="60" value="${esc(n ? n.en : '')}" required></label>
        <label for="${idPrefix}-ka"><span>${t('admin.niches.ka')}</span><input id="${idPrefix}-ka" name="ka" maxlength="60" value="${esc(n ? n.ka : '')}" required></label>
        <label for="${idPrefix}-icon"><span>${t('admin.niches.icon')}</span>${iconSelect('icon', n ? n.icon : 'spark').replace('<select ', `<select id="${idPrefix}-icon" `)}</label>
        <label for="${idPrefix}-sort"><span>${t('admin.niches.sort')}</span><input id="${idPrefix}-sort" name="sort" type="number" min="0" max="32000" step="1" value="${esc(n ? n.sort : 1000)}"></label>
        <label class="checkbox-row" for="${idPrefix}-reg"><input id="${idPrefix}-reg" type="checkbox" name="regulated"${n && n.regulated ? ' checked' : ''}${n && n.researched ? ' disabled' : ''}><span>${t(n && n.researched ? 'admin.niches.regulatedLocked' : 'admin.niches.regulated')}</span></label>
        ${n ? `<label class="checkbox-row" for="${idPrefix}-act"><input id="${idPrefix}-act" type="checkbox" name="active"${n.active ? ' checked' : ''}><span>${t('admin.niches.active')}</span></label>` : ''}
        <p class="form-error nf-error" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-sm">${t(n ? 'admin.niches.save' : 'admin.niches.add')}</button>
      </form>`;
  }

  function suggestionCard(s, i) {
    const others = data.niches.filter((n) => n.active).map((n) => `<option value="${esc(n.key)}">${esc(WisecallI18n.nicheName(n.key))}</option>`).join('');
    return `
      <div class="booking-card nf-suggestion" data-group="${esc(s.group)}">
        <div class="mv-step-head"><strong>“${esc(s.label)}”</strong><span class="badge badge-paid">${esc(fill('admin.niches.count', { n: s.count }))}</span></div>
        ${s.spellings.length > 1 ? `<p class="muted small">${esc(fill('admin.niches.spellings', { list: s.spellings.join(', ') }))}</p>` : ''}
        <p class="small">${s.mentors.map((m) => esc(m.name)).join(', ')}</p>
        <details><summary>${t('admin.niches.promote')}</summary>
          <form class="nf-form" data-promote="${esc(s.group)}">
            <label for="sg${i}-en"><span>${t('admin.niches.en')}</span><input id="sg${i}-en" name="en" maxlength="60" value="${esc(s.label)}" required></label>
            <label for="sg${i}-ka"><span>${t('admin.niches.ka')}</span><input id="sg${i}-ka" name="ka" maxlength="60" required></label>
            <label for="sg${i}-icon"><span>${t('admin.niches.icon')}</span>${iconSelect('icon', 'spark').replace('<select ', `<select id="sg${i}-icon" `)}</label>
            <label class="checkbox-row" for="sg${i}-reg"><input id="sg${i}-reg" type="checkbox" name="regulated"><span>${t('admin.niches.regulated')}</span></label>
            <p class="muted small">${t('admin.niches.movedWarning')}</p>
            <p class="form-error nf-error" role="alert"></p>
            <button type="submit" class="btn btn-primary btn-sm">${t('admin.niches.promote')}</button>
          </form>
        </details>
        <div class="mv-decide">
          <label for="sg${i}-to" class="small">${t('admin.niches.moveTo')}</label>
          <select id="sg${i}-to" class="nf-to">${others}</select>
          <button type="button" class="btn btn-outline btn-sm nf-move">${t('admin.niches.move')}</button>
        </div>
      </div>`;
  }

  function nicheRow(n, i) {
    return `
      <div class="booking-card nf-niche${n.active ? '' : ' nf-inactive'}">
        <div class="mv-step-head">
          <span class="nf-name">${WisecallNicheIcons.svg(n.icon, 20)} <strong>${esc(n.en)}</strong> · ${esc(n.ka)} <span class="muted small">(${esc(n.key)})</span></span>
          <span>
            ${n.regulated ? `<span class="badge badge-paid">${t('verify.level.regulated')}</span>` : ''}
            ${n.active ? '' : `<span class="badge badge-rejected">${t('admin.niches.inactive')}</span>`}
          </span>
        </div>
        <p class="muted small">${esc(fill('admin.niches.mentors', { mentors: n.mentors, listed: n.listed }))}${n.extra ? ' · ' + esc(fill('admin.niches.extra', { n: n.extra })) : ''}${n.promotedFrom ? ' · ' + esc(fill('admin.niches.promotedFrom', { label: n.promotedFrom })) : ''}</p>
        <details><summary>${t('admin.niches.edit')}</summary>${nicheForm(n, `nf${i}`)}</details>
      </div>`;
  }

  async function render(container) {
    container.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    data = await WisecallAPI.apiFetch('/admin/niches');
    container.innerHTML = `
      <h2 class="nf-title">${t('admin.niches.suggestions')}</h2>
      ${data.suggestions.length ? data.suggestions.map(suggestionCard).join('') : `<p class="muted">${t('admin.niches.none')}</p>`}
      <h2 class="nf-title">${t('admin.niches.all')}</h2>
      <details class="booking-card"><summary><strong>${t('admin.niches.add')}</strong></summary>${nicheForm(null, 'nfnew')}</details>
      ${data.niches.map(nicheRow).join('')}`;
    wire(container);
  }

  function wire(container) {
    container.querySelectorAll('form.nf-form').forEach((form) => form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const out = form.querySelector('.nf-error');
      out.textContent = '';
      const body = { en: form.en.value, ka: form.ka.value, icon: form.icon.value };
      if (form.sort) body.sort = Number(form.sort.value);
      if (form.regulated && !form.regulated.disabled) body.regulated = form.regulated.checked;
      if (form.active) body.active = form.active.checked;
      try {
        if (form.dataset.promote !== undefined) {
          const r = await WisecallAPI.apiFetch('/admin/niches', { method: 'POST', body: { ...body, fromSuggestion: form.dataset.promote } });
          WisecallNav.showToast(fill('admin.niches.moved', { n: r.moved }));
        } else if (form.dataset.key) {
          await WisecallAPI.apiFetch(`/admin/niches/${encodeURIComponent(form.dataset.key)}`, { method: 'PATCH', body });
          WisecallNav.showToast(t('toast.saved'));
        } else {
          await WisecallAPI.apiFetch('/admin/niches', { method: 'POST', body });
          WisecallNav.showToast(t('toast.saved'));
        }
        await render(container);
      } catch (e) { out.textContent = errText(e); }
    }));
    container.querySelectorAll('.nf-suggestion').forEach((card) => card.querySelector('.nf-move').addEventListener('click', async () => {
      try {
        const r = await WisecallAPI.apiFetch('/admin/niches/suggestions/move', { method: 'POST', body: { group: card.dataset.group, to: card.querySelector('.nf-to').value } });
        WisecallNav.showToast(fill('admin.niches.moved', { n: r.moved }));
        await render(container);
      } catch (e) { WisecallNav.showToast(t('toast.error')); }
    }));
  }

  window.AdminNiches = { render };
})();
