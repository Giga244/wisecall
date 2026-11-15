// Admin: "სტატიები", the articles of "რჩევები" (docs/CLAUDE-CODE-SEO.md 5). The list, and one form: a title, a short intro and the text in
// Georgian (and, if wanted, in English), the author's name, the date and the category. A new article is a draft; it becomes public only
// when Publish is pressed here (the server decides: server/articles.js). Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const api = (p, o) => WisecallAPI.apiFetch('/admin/articles' + p, o);
  let box = null, limits = null;

  // The address of an article's page in the language it is written in (Georgian first).
  const pageOf = (a) => `${a.langs.includes('ka') || !a.langs.includes('en') ? '/ka' : ''}/advice-articles/${a.slug}`;
  const problemText = (code) => {
    const lang = code.slice(0, 2);
    const key = /^(ka|en)_/.test(code) ? code.slice(3) : code;
    const min = { title_short: limits.titleMin, intro_short: limits.introMin, body_short: limits.bodyMin }[key];
    return fill('admin.art.problem.' + key, { lang: /^(ka|en)_/.test(code) ? t('admin.art.lang.' + lang) : '', min: min || '' });
  };
  const errorText = (e) => {
    if (e.code === 'not_ready') return t('admin.art.err.not_ready');
    if (e.code === 'too_long') return fill('admin.art.err.too_long', { field: t('admin.art.field.' + String((e.data || {}).field || '').replace(/^(ka|en)\./, '')), max: (e.data || {}).max || '' });
    return ['title_required', 'invalid_category', 'invalid_date', 'invalid_slug', 'slug_taken', 'slug_locked', 'published', 'not_found'].includes(e.code) ? t('admin.art.err.' + e.code) : t('toast.error');
  };

  // ---- The list -------------------------------------------------------------------------------------------------------------------------
  function row(a) {
    const published = a.status === 'published';
    return `
      <div class="booking-card art-row" data-id="${esc(a.id)}">
        <div class="mv-step-head"><strong class="art-row-title">${esc(a.title)}</strong><span class="badge ${published ? 'badge-paid' : 'badge-pending_payment'}">${esc(t(published ? 'admin.art.published' : 'admin.art.draft'))}</span></div>
        <p class="muted small">${[a.langs.map((l) => l.toUpperCase()).join(' + ') || t('admin.art.noLang'), a.authorName, a.date ? WisecallI18n.formatDate(a.date + 'T12:00:00', { day: 'numeric', month: 'short', year: 'numeric' }) : ''].filter(Boolean).map(esc).join(' · ')}</p>
        <p class="muted small art-row-url">/advice-articles/${esc(a.slug)}</p>
        <div class="review-actions art-actions">
          <button type="button" class="btn btn-outline btn-sm" data-edit>${esc(t('admin.art.edit'))}</button>
          <a class="btn btn-outline btn-sm" href="${esc(pageOf(a))}" target="_blank" rel="noopener">${esc(t(published ? 'admin.art.view' : 'admin.art.preview'))}</a>
          ${published ? `<button type="button" class="btn btn-outline btn-sm" data-unpublish>${esc(t('admin.art.unpublish'))}</button>` : `<button type="button" class="btn btn-outline btn-sm" data-delete>${esc(t('admin.art.delete'))}</button>`}
        </div>
      </div>`;
  }
  async function list() {
    box.innerHTML = `<p class="muted">${esc(t('admin.loading'))}</p>`;
    const data = await api('');
    limits = data.limits;
    box.innerHTML = `
      <div class="art-head"><h2 class="nf-title">${esc(t('admin.art.title'))}</h2><button type="button" class="btn btn-primary btn-sm" data-new>${esc(t('admin.art.new'))}</button></div>
      <p class="muted small art-note">${esc(t('admin.art.note'))}</p>
      ${data.articles.length ? data.articles.map(row).join('') : `<p class="muted art-empty">${esc(t('admin.art.empty'))}</p>`}`;
    box.querySelector('[data-new]').addEventListener('click', () => form(null));
    box.querySelectorAll('.art-row').forEach((el) => {
      const id = el.dataset.id;
      el.querySelector('[data-edit]').addEventListener('click', async () => { try { form((await api('/' + id)).article); } catch (e) { WisecallNav.showToast(errorText(e)); } });
      const un = el.querySelector('[data-unpublish]');
      if (un) un.addEventListener('click', async () => {
        if (!(await WisecallDialog.confirm({ message: t('admin.art.unpublishConfirm'), confirmText: t('admin.art.unpublish') }))) return;
        try { await api(`/${id}/unpublish`, { method: 'POST' }); WisecallNav.showToast(t('admin.art.unpublished')); } catch (e) { WisecallNav.showToast(errorText(e)); }
        list();
      });
      const del = el.querySelector('[data-delete]');
      if (del) del.addEventListener('click', async () => {
        if (!(await WisecallDialog.confirm({ message: t('admin.art.deleteConfirm'), confirmText: t('admin.art.delete'), danger: true }))) return;
        try { await api('/' + id, { method: 'DELETE' }); WisecallNav.showToast(t('admin.art.deleted')); } catch (e) { WisecallNav.showToast(errorText(e)); }
        list();
      });
    });
  }

  // ---- The form -------------------------------------------------------------------------------------------------------------------------
  // One language's three boxes. (The boxes have no length cap: a text that is too long is said by the server, never cut.)
  function langFields(lang, v) {
    const id = (n) => `art-${lang}-${n}`;
    return `
        <label for="${id('title')}"><span>${esc(t('admin.art.field.title'))}</span><input id="${id('title')}" name="${lang}Title" value="${esc(v.title)}" autocomplete="off" lang="${lang}"></label>
        <p class="hint art-count" data-count="${lang}Title" data-good="60"></p>
        <label for="${id('intro')}"><span>${esc(t('admin.art.field.intro'))}</span><textarea id="${id('intro')}" name="${lang}Intro" rows="2" lang="${lang}">${esc(v.intro)}</textarea></label>
        <p class="hint art-count" data-count="${lang}Intro" data-good="160"></p>
        <label for="${id('body')}"><span>${esc(t('admin.art.field.body'))}</span><textarea id="${id('body')}" name="${lang}Body" rows="10" lang="${lang}" aria-describedby="${id('body')}-hint">${esc(v.body)}</textarea></label>
        <p class="hint" id="${id('body')}-hint">${esc(t('admin.art.bodyHint'))}</p>`;
  }
  function form(a) {
    const isNew = !a;
    a = a || { ka: { title: '', intro: '', body: '' }, en: { title: '', intro: '', body: '' }, authorName: '', date: '', category: '', slug: '', status: 'draft', langs: [], problems: [], everPublished: false };
    const published = a.status === 'published';
    const fields = WisecallI18n.fields();
    const enOpen = Boolean(a.en.title || a.en.intro || a.en.body);
    box.innerHTML = `
      <form class="art-form" novalidate>
        <p><button type="button" class="linklike" data-back>${esc(t('admin.art.back'))}</button></p>
        <h2 class="nf-title">${esc(t(isNew ? 'admin.art.newTitle' : 'admin.art.editTitle'))}</h2>
        <p class="art-status"><span class="badge ${published ? 'badge-paid' : 'badge-pending_payment'}">${esc(t(published ? 'admin.art.published' : 'admin.art.draft'))}</span> <span class="muted small">${esc(t(published ? 'admin.art.publishedNote' : 'admin.art.draftNote'))}</span></p>
        <fieldset class="art-lang"><legend>${esc(t('admin.art.lang.ka'))}</legend>${langFields('ka', a.ka)}</fieldset>
        <details class="art-lang art-en"${enOpen ? ' open' : ''}><summary>${esc(t('admin.art.enOptional'))}</summary>${langFields('en', a.en)}</details>
        <label for="art-author"><span>${esc(t('admin.art.field.authorName'))}</span><input id="art-author" name="authorName" value="${esc(a.authorName)}" autocomplete="off" aria-describedby="art-author-hint"></label>
        <p class="hint" id="art-author-hint">${esc(t('admin.art.authorHint'))}</p>
        <div class="art-two">
          <div><label for="art-date"><span>${esc(t('admin.art.field.date'))}</span><input id="art-date" name="date" type="date" value="${esc(a.date || '')}" aria-describedby="art-date-hint"></label>
            <p class="hint" id="art-date-hint">${esc(t('admin.art.dateHint'))}</p></div>
          <label for="art-category"><span>${esc(t('admin.art.field.category'))}</span><select id="art-category" name="category"><option value="">${esc(t('admin.art.general'))}</option>${fields.map((f) => `<option value="${esc(f.id)}"${f.id === a.category ? ' selected' : ''}>${esc(WisecallI18n.nameIn(f))}</option>`).join('')}</select></label>
        </div>
        <label for="art-slug"><span>${esc(t('admin.art.field.slug'))}</span><span class="art-slug"><span class="art-slug-prefix" aria-hidden="true">/advice-articles/</span><input id="art-slug" name="slug" value="${esc(a.slug)}" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="url"${a.everPublished ? ' readonly' : ''} placeholder="${esc(t('admin.art.slugAuto'))}" aria-describedby="art-slug-hint"></span></label>
        <p class="hint" id="art-slug-hint">${esc(t(a.everPublished ? 'admin.art.slugLocked' : 'admin.art.slugHint'))}</p>
        <div class="art-problems" data-problems></div>
        <p class="form-error art-error" role="alert"></p>
        <div class="art-buttons">
          <button type="submit" class="btn btn-primary" data-save>${esc(t(published ? 'admin.art.saveLive' : 'admin.art.save'))}</button>
          ${published ? '' : `<button type="button" class="btn btn-outline" data-publish>${esc(t('admin.art.publish'))}</button>`}
          <a class="btn btn-outline" data-view target="_blank" rel="noopener"${isNew ? ' hidden' : ''} href="${isNew ? '#' : esc(pageOf(a))}">${esc(t(published ? 'admin.art.view' : 'admin.art.preview'))}</a>
        </div>
        <p class="hint art-preview-note"${isNew ? ' hidden' : ''}>${esc(t('admin.art.previewNote'))}</p>
      </form>`;
    const f = box.querySelector('form');
    const error = f.querySelector('.art-error');
    let current = isNew ? null : a;

    const grow = (area) => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; };
    const count = () => f.querySelectorAll('[data-count]').forEach((p) => {
      const n = [...f.elements[p.dataset.count].value.trim()].length;
      p.textContent = n ? fill('admin.art.count', { n, good: p.dataset.good }) : fill('admin.art.countEmpty', { good: p.dataset.good });
      p.classList.toggle('is-over', n > Number(p.dataset.good));
    });
    f.querySelectorAll('textarea').forEach(grow);
    count();
    f.addEventListener('input', (ev) => { if (ev.target.tagName === 'TEXTAREA') grow(ev.target); count(); error.textContent = ''; });
    // (the English boxes are measured when they are opened: a closed <details> has no height)
    f.querySelector('.art-en').addEventListener('toggle', () => f.querySelectorAll('.art-en textarea').forEach(grow));
    const showProblems = (list) => {
      const el = f.querySelector('[data-problems]');
      el.innerHTML = list && list.length ? `<p class="small"><strong>${esc(t('admin.art.problemsTitle'))}</strong></p><ul>${list.map((c) => `<li>${esc(problemText(c))}</li>`).join('')}</ul>` : '';
    };
    if (!published && !isNew) showProblems(a.problems);

    const read = () => ({
      ka: { title: f.elements.kaTitle.value, intro: f.elements.kaIntro.value, body: f.elements.kaBody.value },
      en: { title: f.elements.enTitle.value, intro: f.elements.enIntro.value, body: f.elements.enBody.value },
      authorName: f.elements.authorName.value, date: f.elements.date.value, category: f.elements.category.value, slug: f.elements.slug.value
    });
    // Saves what is in the boxes; -> the saved article, or null (the reason is said under the form).
    async function save() {
      error.textContent = '';
      try {
        const r = current ? await api('/' + current.id, { method: 'PATCH', body: read() }) : await api('', { method: 'POST', body: read() });
        current = r.article;
        f.elements.slug.value = current.slug;
        const view = f.querySelector('[data-view]');
        view.href = pageOf(current);
        view.hidden = false;
        f.querySelector('.art-preview-note').hidden = false;
        if (current.status !== 'published') showProblems(current.problems);
        return current;
      } catch (e) {
        error.textContent = errorText(e);
        if (e.code === 'not_ready') showProblems((e.data || {}).problems);
        const name = { 'ka.title': 'kaTitle', 'ka.intro': 'kaIntro', 'ka.body': 'kaBody', 'en.title': 'enTitle', 'en.intro': 'enIntro', 'en.body': 'enBody', authorName: 'authorName', date: 'date', category: 'category', slug: 'slug' }[(e.data || {}).field];
        if (name) { if (name.startsWith('en')) f.querySelector('.art-en').open = true; f.elements[name].focus(); }
        return null;
      }
    }
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = f.querySelector('[data-save]');
      b.disabled = true;
      const saved = await save();
      b.disabled = false;
      if (saved) WisecallNav.showToast(t(saved.status === 'published' ? 'admin.art.savedLive' : 'admin.art.saved'));
    });
    const pub = f.querySelector('[data-publish]');
    if (pub) pub.addEventListener('click', async () => {
      pub.disabled = true;
      const saved = await save();
      if (!saved) { pub.disabled = false; return; }
      if (saved.problems.length) { error.textContent = t('admin.art.err.not_ready'); pub.disabled = false; return; }
      if (!(await WisecallDialog.confirm({ message: t('admin.art.publishConfirm'), confirmText: t('admin.art.publish') }))) { pub.disabled = false; return; }
      try {
        const r = await api(`/${saved.id}/publish`, { method: 'POST' });
        WisecallNav.showToast(t('admin.art.publishedToast'));
        form(r.article);
      } catch (e) {
        error.textContent = errorText(e);
        if (e.code === 'not_ready') showProblems((e.data || {}).problems);
        pub.disabled = false;
      }
    });
    f.querySelector('[data-back]').addEventListener('click', () => list());
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function render(container) {
    box = container;
    await list();
  }

  window.AdminArticles = { render };
})();
