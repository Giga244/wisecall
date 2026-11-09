// Settings → Profile, below the basic profile: the optional sections (experience, education, licences, projects, journey, skills, language
// levels, more links), who sees each part, and a quiet "profile strength" bar only the owner sees. Each list section: add, edit and delete
// inline, reorder by dragging or with the up/down buttons; what is typed in an open form is kept in this browser until it is saved.
window.WisecallProfileSections = (function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const errText = (e) => { const k = 'ps.err.' + e.code; return t(k) !== k ? fill(k, { max: (e.data && e.data.max) || '' }) : t('toast.error'); };
  const LISTS = [['experience', 'experience'], ['education', 'education'], ['licences', 'licence'], ['projects', 'project'], ['journey', 'journey']];
  const ALL = ['headline', 'about', 'experience', 'education', 'licences', 'skills', 'languages', 'projects', 'journey', 'links'];
  const LEVELS = ['everyone', 'signed_in', 'only_me'];
  let root;
  let user;
  let data;
  let editor;

  // ---- Small helpers: dates ("Mar 2021", "2021"), durations ("3 yrs 4 mos") ---------------------------------------------------------
  const monthName = (m) => WisecallI18n.formatDate(new Date(Date.UTC(2020, m - 1, 15)), { month: 'short' });
  const dateText = (d) => (d ? (d.month ? `${monthName(d.month)} ${d.year}` : String(d.year)) : '');
  function duration(n) {
    const y = Math.floor(n / 12);
    const m = n % 12;
    return [y ? fill(y === 1 ? 'ps.dur.yr' : 'ps.dur.yrs', { n: y }) : '', m ? fill(m === 1 ? 'ps.dur.mo' : 'ps.dur.mos', { n: m }) : ''].filter(Boolean).join(' ') || fill('ps.dur.mo', { n: 1 });
  }
  const monthSelect = (name, value) => `<select name="${name}" aria-label="${esc(t('ps.f.month'))}"><option value="">${esc(t('ps.f.month'))}</option>${
    Array.from({ length: 12 }, (x, i) => `<option value="${i + 1}"${Number(value) === i + 1 ? ' selected' : ''}>${esc(monthName(i + 1))}</option>`).join('')}</select>`;
  const yearInput = (name, value, label) => `<input type="number" name="${name}" min="1950" max="${new Date().getFullYear() + 10}" step="1" inputmode="numeric" value="${esc(value || '')}" placeholder="${esc(t('ps.f.year'))}" aria-label="${esc(label || t('ps.f.year'))}">`;
  const field = (label, html, hint) => `<label><span>${esc(label)}</span>${html}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;
  const input = (name, value, max, type = 'text') => `<input type="${type}" name="${name}" maxlength="${max}" value="${esc(value || '')}"${type === 'url' ? ' inputmode="url" placeholder="https://"' : ''}>`;
  // (no maxlength on a text box: a browser would cut a pasted text without a word; the server says when it is too long, with the limit)
  const area = (name, value, max, rows = 3) => `<textarea name="${name}" data-max="${max}" rows="${rows}">${esc(value || '')}</textarea>`;

  // ---- One item, shown in its list ----------------------------------------------------------------------------------------------------
  function itemLine(section, it) {
    const verified = it.verified ? ` <span class="badge badge-paid ps-verified">✓ ${esc(t('ps.verified'))}</span>` : '';
    const lines = {
      experience: () => [`<strong>${esc(it.title)}</strong> · ${esc(it.organisation)}${verified}`, `${esc(dateText(it.start))} – ${esc(it.current ? t('ps.present') : dateText(it.end))}${it.location ? ' · ' + esc(it.location) : ''}`],
      education: () => [`<strong>${esc(it.school)}</strong>${verified}`, [it.degree, it.field].filter(Boolean).map(esc).join(', ') + (it.startYear || it.endYear ? ` · ${esc([it.startYear, it.endYear].filter(Boolean).join(' – '))}` : '')],
      licence: () => [`<strong>${esc(it.name)}</strong> · ${esc(it.issuer)}${verified}`, `${esc(dateText(it.issued))}${it.expires ? ' – ' + esc(dateText(it.expires)) : ''}`],
      project: () => [`<strong>${esc(it.title)}</strong>`, it.url ? esc(it.url) : ''],
      journey: () => [`<strong>${esc(dateText(it.date))}</strong> · ${esc(it.title)}`, '']
    }[section]();
    return `<li class="ps-item" draggable="true" data-id="${esc(it.id)}">
      <span class="ps-grip" aria-hidden="true">⋮⋮</span>
      <span class="ps-item-text">${lines[0]}${lines[1] ? `<br><span class="muted small">${lines[1]}</span>` : ''}</span>
      <span class="ps-item-actions">
        <button type="button" class="icon-btn ps-up" aria-label="${esc(t('ps.up'))}">↑</button>
        <button type="button" class="icon-btn ps-down" aria-label="${esc(t('ps.down'))}">↓</button>
        <button type="button" class="linklike ps-edit">${esc(t('ps.edit'))}</button>
        <button type="button" class="linklike ps-del">${esc(t('ps.delete'))}</button>
      </span></li>`;
  }
  const itemsOf = (key) => (key === 'experience' ? (data.experience || []).flatMap((g) => g.items) : (data[key] || []));

  // ---- The form of one item (new or edited) ---------------------------------------------------------------------------------------------
  function formHtml(section, it = {}) {
    const f = {
      experience: () => `${field(t('ps.f.title'), input('title', it.title, 100))}${field(t('ps.f.organisation'), input('organisation', it.organisation, 120))}
        <div class="lv-row">${field(t('ps.f.location'), input('location', it.location, 80))}
          ${field(t('ps.f.type'), `<select name="type">${editor.types.map((x) => `<option value="${x}"${(it.type || 'full_time') === x ? ' selected' : ''}>${esc(t('ps.type.' + x))}</option>`).join('')}</select>`)}</div>
        <div class="lv-row">${field(t('ps.f.start'), `<span class="ps-date">${monthSelect('startMonth', it.start && it.start.month)}${yearInput('startYear', it.start && it.start.year, t('ps.f.start'))}</span>`)}
          ${field(t('ps.f.end'), `<span class="ps-date">${monthSelect('endMonth', it.end && it.end.month)}${yearInput('endYear', it.end && it.end.year, t('ps.f.end'))}</span>`)}</div>
        <label class="checkbox-row"><input type="checkbox" name="current"${it.current ? ' checked' : ''}> <span>${esc(t('ps.f.current'))}</span></label>
        ${field(t('ps.f.description'), area('description', it.description, 1000))}
        <fieldset><legend class="small">${esc(t('ps.f.achievements'))}</legend>${[0, 1, 2, 3, 4].map((i) => `<input type="text" name="ach${i}" maxlength="150" value="${esc((it.achievements || [])[i] || '')}" aria-label="${esc(fill('ps.f.achievement', { n: i + 1 }))}">`).join('')}</fieldset>`,
      education: () => `${field(t('ps.f.school'), input('school', it.school, 150))}<div class="lv-row">${field(t('ps.f.degree'), input('degree', it.degree, 100))}${field(t('ps.f.field'), input('field', it.field, 100))}</div>
        <div class="lv-row">${field(t('ps.f.startYear'), yearInput('startYear', it.startYear, t('ps.f.startYear')))}${field(t('ps.f.endYear'), yearInput('endYear', it.endYear, t('ps.f.endYear')))}</div>
        ${field(t('ps.f.description'), area('description', it.description, 1000))}`,
      licence: () => `${field(t('ps.f.name'), input('name', it.name, 150))}${field(t('ps.f.issuer'), input('issuer', it.issuer, 150))}
        <div class="lv-row">${field(t('ps.f.issued'), `<span class="ps-date">${monthSelect('issuedMonth', it.issued && it.issued.month)}${yearInput('issuedYear', it.issued && it.issued.year, t('ps.f.issued'))}</span>`)}
          ${field(t('ps.f.expires'), `<span class="ps-date">${monthSelect('expiresMonth', it.expires && it.expires.month)}${yearInput('expiresYear', it.expires && it.expires.year, t('ps.f.expires'))}</span>`)}</div>
        ${field(t('ps.f.url'), input('url', it.url, 300, 'url'), t('ps.f.urlHint'))}`,
      project: () => `${field(t('ps.f.title'), input('title', it.title, 100))}${field(t('ps.f.url'), input('url', it.url, 300, 'url'), t('ps.f.urlHint'))}
        ${field(t('ps.f.description'), area('description', it.description, 500))}
        ${it.id ? `<p class="small">${it.imageUrl ? `<img class="ps-thumb" src="${esc(it.imageUrl)}" alt="" width="64" height="64"> ` : ''}
          <label class="btn btn-outline btn-sm"><span>${esc(t(it.imageUrl ? 'ps.f.imageChange' : 'ps.f.image'))}</span><input type="file" name="image" accept="image/jpeg,image/png,image/webp" class="sr-only"></label>
          ${it.imageUrl ? `<button type="button" class="linklike ps-image-del">${esc(t('ps.f.imageRemove'))}</button>` : ''}</p>` : `<p class="hint">${esc(t('ps.f.imageAfter'))}</p>`}`,
      journey: () => `<div class="lv-row">${field(t('ps.f.date'), `<span class="ps-date">${monthSelect('dateMonth', it.date && it.date.month)}${yearInput('dateYear', it.date && it.date.year, t('ps.f.date'))}</span>`)}
        ${field(t('ps.f.title'), input('title', it.title, 100), t('ps.f.journeyHint'))}</div>${field(t('ps.f.text'), area('text', it.text, 500, 2))}`
    }[section]();
    return `<form class="ps-form" novalidate data-section="${section}" data-id="${esc(it.id || '')}">${f}
      <p class="form-error" role="alert"></p>
      <p class="muted small ps-draft" hidden>${esc(t('ps.draftRestored'))}</p>
      <div class="lv-actions"><button type="submit" class="btn btn-primary btn-sm">${esc(t('ps.save'))}</button><button type="button" class="btn btn-outline btn-sm ps-cancel">${esc(t('ps.cancel'))}</button></div></form>`;
  }
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const dateOf = (f, prefix) => (num(f[prefix + 'Year'].value) ? { year: num(f[prefix + 'Year'].value), ...(num(f[prefix + 'Month'].value) ? { month: num(f[prefix + 'Month'].value) } : {}) } : null);
  function formData(f) {
    switch (f.dataset.section) {
      case 'experience': return { title: f.title.value, organisation: f.organisation.value, location: f.location.value, type: f.type.value, start: dateOf(f, 'start'),
        end: f.current.checked ? null : dateOf(f, 'end'), current: f.current.checked, description: f.description.value, achievements: [0, 1, 2, 3, 4].map((i) => f['ach' + i].value).filter((a) => a.trim()) };
      case 'education': return { school: f.school.value, degree: f.degree.value, field: f.field.value, startYear: num(f.startYear.value), endYear: num(f.endYear.value), description: f.description.value };
      case 'licence': return { name: f.name.value, issuer: f.issuer.value, issued: dateOf(f, 'issued'), expires: dateOf(f, 'expires'), url: f.url.value };
      case 'project': return { title: f.title.value, url: f.url.value, description: f.description.value };
      default: return { date: dateOf(f, 'date'), title: f.title.value, text: f.text.value };
    }
  }
  // Drafts: what is typed in an open form, kept in this browser (cleared once saved or cancelled).
  const draftKey = (f) => `wc_profile_draft_${f.dataset.section}_${f.dataset.id || 'new'}`;
  const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not available */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* not available */ } } };
  function restoreDraft(f) {
    const d = store.get(draftKey(f));
    if (!d) return;
    Object.entries(d).forEach(([k, v]) => { const el = f.elements[k]; if (!el || el.type === 'file') return; if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = v; });
    f.querySelector('.ps-draft').hidden = false;
  }
  function keepDraft(f) {
    const d = {};
    Array.from(f.elements).forEach((el) => { if (el.name && el.type !== 'file') d[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
    store.set(draftKey(f), d);
  }

  // ---- The page part ------------------------------------------------------------------------------------------------------------------
  const levelLabel = (key) => t('ps.level.' + data.visibility[key]);
  function listCard([key, section]) {
    const items = itemsOf(section === 'licence' ? 'licences' : key);
    return `<details class="settings-card ps-card" data-key="${key}" data-section="${section}"${items.length ? ' open' : ''}>
      <summary><span class="ps-card-title">${esc(t('ps.s.' + key))}</span> <span class="muted small">${items.length ? `${items.length} · ` : ''}${esc(levelLabel(key))}</span></summary>
      ${data.adminHidden[key] ? `<p class="pay-notice failed small">${esc(fill('ps.hiddenByAdmin', { reason: data.adminHidden[key] }))}</p>` : ''}
      <ol class="ps-items" data-section="${section}">${items.map((it) => itemLine(section, it)).join('')}</ol>
      <div class="ps-form-slot"></div>
      <button type="button" class="btn btn-outline btn-sm ps-add">${esc(t('ps.add.' + key))}</button>
    </details>`;
  }
  function draw() {
    const s = data.strength;
    const mentor = user.role === 'mentor' || user.role === 'both';
    root.innerHTML = `
      <section class="settings-card ps-strength" aria-labelledby="psStrengthTitle">
        <h2 id="psStrengthTitle" class="earn-h">${esc(t('ps.strength'))}</h2>
        <div class="ps-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.percent}" aria-labelledby="psStrengthTitle"><span style="width:${s.percent}%"></span></div>
        <p class="muted small">${esc(fill('ps.strengthText', { n: s.percent }))}${s.next ? ' ' + esc(t('ps.tip.' + s.next)) : ''}</p>
        ${mentor ? `<p class="small"><button type="button" class="linklike" id="psFromApp">${esc(t('ps.fromApplication'))}</button></p>` : ''}
      </section>
      ${data.profileHidden ? `<p class="pay-notice failed">${esc(fill('ps.profileHidden', { reason: data.profileHidden.reason || '' }))}</p>` : ''}
      <details class="settings-card ps-card" id="psWho"><summary><span class="ps-card-title">${esc(t('ps.who'))}</span></summary>
        <p class="hint">${esc(t('ps.whoHint'))}</p>
        <div class="ps-who-grid">${ALL.map((k) => `<label><span>${esc(t('ps.s.' + k))}</span><select data-vis="${k}">${LEVELS.map((l) => `<option value="${l}"${data.visibility[k] === l ? ' selected' : ''}>${esc(t('ps.level.' + l))}</option>`).join('')}</select></label>`).join('')}</div>
      </details>
      ${LISTS.map(listCard).join('')}
      <details class="settings-card ps-card" data-key="skills"${(data.skills || []).length ? ' open' : ''}><summary><span class="ps-card-title">${esc(t('ps.s.skills'))}</span> <span class="muted small">${esc(levelLabel('skills'))}</span></summary>
        <form id="psSkills" novalidate>
          ${field(t('ps.f.skills'), `<textarea name="skills" rows="3" maxlength="1300">${esc((data.skills || []).join(', '))}</textarea>`, t('ps.f.skillsHint'))}
          <fieldset><legend class="small">${esc(t('ps.f.topSkills'))}</legend><div class="ps-top">${(data.skills || []).map((sk) => `<label class="check-chip"><input type="checkbox" value="${esc(sk)}"${(data.topSkills || []).includes(sk) ? ' checked' : ''}><span>${esc(sk)}</span></label>`).join('') || `<span class="muted small">${esc(t('ps.f.topSkillsEmpty'))}</span>`}</div></fieldset>
          <p class="form-error" role="alert"></p><button type="submit" class="btn btn-primary btn-sm">${esc(t('ps.save'))}</button></form></details>
      <details class="settings-card ps-card" data-key="languages"><summary><span class="ps-card-title">${esc(t('ps.s.languageLevels'))}</span></summary>
        ${(user.languages || []).length ? `<form id="psLevels" novalidate><div class="ps-who-grid">${user.languages.map((code) => {
          const cur = ((data.languages || []).find((l) => l.code === code) || {}).level || '';
          return `<label><span>${esc(t('lang.' + code))}</span><select name="${code}"><option value="">—</option>${editor.levels.map((l) => `<option value="${l}"${cur === l ? ' selected' : ''}>${esc(t('ps.langLevel.' + l))}</option>`).join('')}</select></label>`;
        }).join('')}</div><p class="form-error" role="alert"></p><button type="submit" class="btn btn-primary btn-sm">${esc(t('ps.save'))}</button></form>` : `<p class="muted small">${esc(t('ps.noLanguages'))}</p>`}
      </details>
      <details class="settings-card ps-card" data-key="links"><summary><span class="ps-card-title">${esc(t('ps.s.moreLinks'))}</span> <span class="muted small">${esc(levelLabel('links'))}</span></summary>
        <form id="psLinks" novalidate>${editor.links.map((k) => field(t('ps.link.' + k), input(k, ((data.links || {})[k]) || '', 300, 'url'))).join('')}
          <p class="form-error" role="alert"></p><button type="submit" class="btn btn-primary btn-sm">${esc(t('ps.save'))}</button></form></details>`;
    wire();
  }

  async function reload() { data = (await WisecallAPI.apiFetch('/me/profile/sections')).sections; draw(); }

  function openForm(card, item) {
    const slot = card.querySelector('.ps-form-slot');
    slot.innerHTML = formHtml(card.dataset.section, item || {});
    const f = slot.querySelector('form');
    restoreDraft(f);
    card.querySelector('.ps-add').hidden = true;
    f.addEventListener('input', () => keepDraft(f));
    f.querySelector('.ps-cancel').addEventListener('click', () => { store.del(draftKey(f)); slot.innerHTML = ''; card.querySelector('.ps-add').hidden = false; });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = f.querySelector('.form-error');
      err.textContent = '';
      try {
        const body = { data: formData(f) };
        if (f.dataset.id) await WisecallAPI.apiFetch(`/me/profile/items/${encodeURIComponent(f.dataset.id)}`, { method: 'PUT', body });
        else await WisecallAPI.apiFetch('/me/profile/items', { method: 'POST', body: { section: f.dataset.section, ...body } });
        store.del(draftKey(f));
        WisecallNav.showToast(t('toast.saved'));
        await reload();
      } catch (e) { err.textContent = errText(e); }
    });
    const file = f.querySelector('input[type="file"]');
    if (file) file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      try { await WisecallAPI.uploadFile(`/me/profile/items/${encodeURIComponent(f.dataset.id)}/image`, file.files[0]); WisecallNav.showToast(t('toast.saved')); await reload(); }
      catch (e) { f.querySelector('.form-error').textContent = t(e.code === 'file_too_large' ? 'profile.photo.err.size' : 'profile.photo.err.invalid'); }
    });
    const delImg = f.querySelector('.ps-image-del');
    if (delImg) delImg.addEventListener('click', async () => { await WisecallAPI.apiFetch(`/me/profile/items/${encodeURIComponent(f.dataset.id)}/image`, { method: 'DELETE' }); await reload(); });
    f.querySelector('input, select, textarea').focus();
  }

  async function saveOrder(list) {
    const ids = Array.from(list.querySelectorAll('.ps-item')).map((li) => li.dataset.id);
    try { await WisecallAPI.apiFetch('/me/profile/order', { method: 'POST', body: { section: list.dataset.section, ids } }); }
    catch (e) { WisecallNav.showToast(t('toast.error')); await reload(); }
  }

  function wire() {
    root.querySelectorAll('select[data-vis]').forEach((sel) => sel.addEventListener('change', async () => {
      try { await WisecallAPI.apiFetch('/me/profile/visibility', { method: 'PUT', body: { section: sel.dataset.vis, level: sel.value } }); WisecallNav.showToast(t('toast.saved')); data.visibility[sel.dataset.vis] = sel.value; }
      catch (e) { WisecallNav.showToast(t('toast.error')); }
    }));
    root.querySelectorAll('.ps-card[data-section]').forEach((card) => {
      const section = card.dataset.section;
      const list = card.querySelector('.ps-items');
      const find = (id) => itemsOf(section === 'licence' ? 'licences' : card.dataset.key).find((i) => i.id === id);
      card.querySelector('.ps-add').addEventListener('click', () => openForm(card, null));
      list.addEventListener('click', async (ev) => {
        const li = ev.target.closest('.ps-item');
        if (!li) return;
        if (ev.target.closest('.ps-edit')) openForm(card, find(li.dataset.id));
        if (ev.target.closest('.ps-del')) {
          if (!(await WisecallDialog.confirm({ message: t('ps.deleteConfirm'), confirmText: t('ps.delete'), danger: true }))) return;
          try { await WisecallAPI.apiFetch(`/me/profile/items/${encodeURIComponent(li.dataset.id)}`, { method: 'DELETE' }); await reload(); } catch (e) { WisecallNav.showToast(t('toast.error')); }
        }
        const up = ev.target.closest('.ps-up');
        const down = ev.target.closest('.ps-down');
        if (up && li.previousElementSibling) { list.insertBefore(li, li.previousElementSibling); await saveOrder(list); li.querySelector('.ps-up').focus(); }
        if (down && li.nextElementSibling) { list.insertBefore(li.nextElementSibling, li); await saveOrder(list); li.querySelector('.ps-down').focus(); }
      });
      // Dragging (mouse and touch-pads; the buttons do the same for keyboards and phones).
      let dragged = null;
      list.addEventListener('dragstart', (ev) => { dragged = ev.target.closest('.ps-item'); if (dragged) { dragged.classList.add('is-dragging'); ev.dataTransfer.effectAllowed = 'move'; } });
      list.addEventListener('dragover', (ev) => {
        if (!dragged) return;
        ev.preventDefault();
        const over = ev.target.closest('.ps-item');
        if (!over || over === dragged) return;
        const r = over.getBoundingClientRect();
        list.insertBefore(dragged, ev.clientY > r.top + r.height / 2 ? over.nextElementSibling : over);
      });
      list.addEventListener('dragend', async () => { if (!dragged) return; dragged.classList.remove('is-dragging'); dragged = null; await saveOrder(list); });
    });
    const skills = document.getElementById('psSkills');
    skills.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const list = skills.skills.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      const top = Array.from(skills.querySelectorAll('.ps-top input:checked')).map((i) => i.value).filter((v) => list.includes(v));
      try { await WisecallAPI.apiFetch('/me/profile/skills', { method: 'PUT', body: { skills: list, topSkills: top } }); WisecallNav.showToast(t('toast.saved')); await reload(); }
      catch (e) { skills.querySelector('.form-error').textContent = errText(e); }
    });
    skills.addEventListener('change', (ev) => {
      if (!ev.target.closest('.ps-top')) return;
      const on = skills.querySelectorAll('.ps-top input:checked');
      if (on.length > 3) { ev.target.checked = false; skills.querySelector('.form-error').textContent = fill('ps.err.too_many_top_skills', { max: 3 }); }
    });
    const levels = document.getElementById('psLevels');
    if (levels) levels.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const out = {};
      Array.from(levels.querySelectorAll('select')).forEach((s) => { if (s.value) out[s.name] = s.value; });
      try { await WisecallAPI.apiFetch('/me/profile/language-levels', { method: 'PUT', body: { levels: out } }); WisecallNav.showToast(t('toast.saved')); await reload(); }
      catch (e) { levels.querySelector('.form-error').textContent = errText(e); }
    });
    const links = document.getElementById('psLinks');
    links.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const out = {};
      editor.links.forEach((k) => { out[k] = links[k].value.trim(); });
      try { await WisecallAPI.apiFetch('/me/profile/links', { method: 'PUT', body: { links: out } }); WisecallNav.showToast(t('toast.saved')); await reload(); }
      catch (e) { links.querySelector('.form-error').textContent = errText(e); }
    });
    const fromApp = document.getElementById('psFromApp');
    if (fromApp) fromApp.addEventListener('click', async () => {
      try { const r = await WisecallAPI.apiFetch('/me/profile/from-application', { method: 'POST' }); WisecallNav.showToast(t(r.added ? 'ps.fromApplicationDone' : 'ps.fromApplicationNothing')); await reload(); }
      catch (e) { WisecallNav.showToast(t('toast.error')); }
    });
  }

  async function init(currentUser) {
    user = currentUser;
    root = document.getElementById('profileSections');
    if (!root) return;
    try {
      const r = await WisecallAPI.apiFetch('/me/profile/sections');
      data = r.sections;
      editor = r.editor;
      draw();
    } catch (e) { root.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; }
    document.addEventListener('wisecall:lang-changed', () => { if (data) draw(); });
  }

  return { init, duration };
})();
