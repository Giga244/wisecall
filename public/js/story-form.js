// "My path" and what goes with it (docs/CLAUDE-CODE-MENTOR-STORY.md), one form for step 2 of the application (public/js/apply.js) and for
// Settings -> My details (public/js/settings-details.js): three short blocks (where I started, how I coped, where I am now), up to 3
// starting-point tags, "შენ შესახებ" (the profile's About, required, 150 to 2000 characters), and, all optional, a sample question with a short sample answer, three "I can help with" lines and up to 3 work links.
// The server decides every rule (server/mentorStory.js); this asks, counts and explains. Every example is labelled "Example".
//   WisecallStoryForm.html(values, { limits, startTags, prefix, oldStory, open })  -> the fields (inside the page's own <form>)
//   WisecallStoryForm.wire(root)            counters, "at most 3" for the tags
//   WisecallStoryForm.read(root)            -> what to send
//   WisecallStoryForm.pathProblem(values, limits, { oldStoryOk }) -> null | { field, code }   (before "Next": all three blocks, or none with an old story)
//   WisecallStoryForm.aboutProblem(values, limits) -> null | { code, left }; aboutError(root, text, { focus }); aboutText(problem, limits)
//   WisecallStoryForm.pathProblems(values, limits) -> [{ field, code, left }] (each block's own reason); problemText(p, limits)
//   WisecallStoryForm.fieldError(root, field, text, { focus }) / clearErrors(root): the line under a field; restore(root, values): typed text back
//   WisecallStoryForm.merge(current, base, draft) -> { values, changed }: which fields of a draft go back over what the server has
//   WisecallStoryForm.errorText(error)      -> words for a server answer (error.code, error.data.field)
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const size = (text) => (window.WisecallTextRules ? WisecallTextRules.size(text) : [...String(text || '').trim().replace(/\s+/g, ' ')].length);
  const PATH = [['pathStart', 'start'], ['pathHow', 'how'], ['pathNow', 'now']];

  function html(values, { limits, startTags = [], prefix = 'st', oldStory = '', open = false, aboutOptional = false } = {}) {
    const v = values || {};
    const L = limits;
    const block = ([key, name]) => `
      <div class="apply-field story-field">
        <label for="${prefix}-${key}">${esc(t(`story.${name}.label`))}</label>
        <textarea id="${prefix}-${key}" name="${key}" rows="4" data-story-count data-min="${L.pathMin}" data-max="${L.pathMax}" aria-describedby="${prefix}-${key}-count ${prefix}-${key}-err ${prefix}-${key}-ex">${esc(v[key] || '')}</textarea>
        <p class="apply-count story-count" id="${prefix}-${key}-count" aria-live="polite"></p>
        <p class="apply-field-error" id="${prefix}-${key}-err" data-field-error="${key}" role="alert" hidden></p>
        <p class="hint story-example" id="${prefix}-${key}-ex"><span class="story-example-label">${esc(t('story.example'))}</span> ${esc(t(`story.${name}.ex`))}</p>
      </div>`;
    // (short boxes that wrap and grow like the others: a point is never cut off at the side of a phone; a line break in one is a space)
    // (each line has its own count and limit, like the other boxes: a line over it says so under itself, and nothing typed is ever cut)
    const pointMin = L.pointMin || 3, pointMax = L.pointMax || 200;
    const points = [0, 1, 2].map((i) => `<textarea id="${prefix}-helpPoint-${i}" name="helpPoint" rows="1" class="story-point" data-story-count data-plain data-min="${pointMin}" data-max="${pointMax}" placeholder="${esc(t('story.example'))} ${esc(t(`story.help.ex${i + 1}`))}" aria-label="${esc(fill('story.help.n', { n: i + 1 }))}" aria-describedby="${prefix}-helpPoint-${i}-count">${esc((v.helpPoints || [])[i] || '')}</textarea>
              <p class="apply-count story-count story-point-count" id="${prefix}-helpPoint-${i}-count" aria-live="polite"></p>`).join('');
    const links = [0, 1, 2].map((i) => `<input type="url" name="workLink" inputmode="url" value="${esc((v.workLinks || [])[i] || '')}" placeholder="https://" aria-label="${esc(fill('story.links.n', { n: i + 1 }))}">`).join('');
    // "შენ შესახებ" / "About you": the whole career in the mentor's own words; the profile's About. Required, 150 to 2000 characters (an
    // application sent before has it as optional: aboutOptional). No length cap in the box (nothing typed is ever cut): the count says how
    // many more are needed, and when it is over; the server says so too. What is wrong with it is said right under it (data-about-error).
    const aboutMin = L.aboutMin || 150;
    const aboutMax = L.aboutMax || 2000;
    const about = `
      <div class="apply-field story-about">
        <label for="${prefix}-about">${esc(t('story.about.label'))}${aboutOptional ? ` <span class="hint">${esc(t('story.about.optional'))}</span>` : ''}</label>
        <p class="hint" id="${prefix}-about-hint">${esc(t('story.about.hint'))}</p>
        <textarea id="${prefix}-about" name="about" rows="6" data-about-count data-min="${aboutMin}" data-max="${aboutMax}" aria-describedby="${prefix}-about-hint ${prefix}-about-count ${prefix}-about-err ${prefix}-about-ex"${aboutOptional ? '' : ' aria-required="true"'}>${esc(v.about || '')}</textarea>
        <p class="apply-count story-count" id="${prefix}-about-count" aria-live="polite"></p>
        <p class="apply-field-error" id="${prefix}-about-err" data-about-error hidden></p>
        <p class="hint story-example" id="${prefix}-about-ex"><span class="story-example-label">${esc(t('story.example'))}</span> ${esc(t('story.about.ex'))}</p>
      </div>`;
    return `
      <div class="story-form" data-story-form>
        ${PATH.map(block).join('')}
        ${about}
        ${oldStory ? `<details class="apply-more story-old"><summary>${esc(t('story.old.title'))}</summary>
          <p class="hint">${esc(t('story.old.note'))}</p><p class="story-old-text">${esc(oldStory)}</p></details>` : ''}
        <fieldset class="apply-field story-tags" data-max-tags="${L.tagsMax}">
          <legend>${esc(t('story.tags.title'))}</legend>
          <span class="hint">${esc(t('story.tags.hint'))}</span>
          <div class="story-tag-list" role="group" aria-label="${esc(t('story.tags.title'))}">
            ${startTags.map((x) => `<button type="button" class="chip apply-chip story-tag" data-start-tag="${esc(x.id)}" aria-pressed="${(v.startTags || []).includes(x.id)}">${esc(t('start.' + x.id))}</button>`).join('')}
          </div>
          <p class="hint story-tags-max" data-tags-max hidden role="status">${esc(fill('story.tags.max', { max: L.tagsMax }))}</p>
        </fieldset>
        <!-- (optional, and in sight: each part is its own row that opens; one that already has something in it is open) -->
        <section class="story-more" aria-labelledby="${prefix}-more">
          <h2 class="story-more-title" id="${prefix}-more">${esc(t('story.more'))}</h2>
          <p class="hint story-more-hint">${esc(t('story.more.hint'))}</p>
          <details class="story-opt" data-opt="sample"${open || v.sampleQuestion || v.sampleReply ? ' open' : ''}>
            <summary><span class="story-opt-name">${esc(t('profile.sample.label'))}</span><span class="story-opt-what">${esc(t('story.opt.sample'))}</span></summary>
            <div class="apply-field">
              <label for="${prefix}-sampleQuestion">${esc(t('story.sample.q'))}</label>
              <textarea id="${prefix}-sampleQuestion" name="sampleQuestion" rows="1" class="story-point" data-story-count data-plain data-min="${L.questionMin || 10}" data-max="${L.questionMax || 160}" aria-describedby="${prefix}-sampleQuestion-count ${prefix}-sq-ex">${esc(v.sampleQuestion || '')}</textarea>
              <p class="apply-count story-count" id="${prefix}-sampleQuestion-count" aria-live="polite"></p>
              <span class="hint story-example" id="${prefix}-sq-ex"><span class="story-example-label">${esc(t('story.example'))}</span> ${esc(t('story.sample.q.ex'))}</span>
              <p class="apply-field-error" data-field-error="sampleQuestion" role="alert" hidden></p>
            </div>
            <div class="apply-field">
              <label for="${prefix}-sampleReply">${esc(fill('story.sample.a', { min: L.replyMin, max: L.replyMax }))}</label>
              <textarea id="${prefix}-sampleReply" name="sampleReply" rows="4" data-story-count data-min="${L.replyMin}" data-max="${L.replyMax}" aria-describedby="${prefix}-sampleReply-count ${prefix}-sa-hint">${esc(v.sampleReply || '')}</textarea>
              <p class="apply-count story-count" id="${prefix}-sampleReply-count" aria-live="polite"></p>
              <p class="apply-field-error" data-field-error="sampleReply" role="alert" hidden></p>
              <span class="hint" id="${prefix}-sa-hint">${esc(t('story.sample.hint'))}</span>
            </div>
          </details>
          <details class="story-opt" data-opt="help"${open || (v.helpPoints || []).length ? ' open' : ''}>
            <summary><span class="story-opt-name">${esc(t('story.help.title'))}</span><span class="story-opt-what">${esc(fill('story.help.hint', { max: pointMax }))}</span></summary>
            <fieldset class="apply-field story-points">
              <legend class="sr-only">${esc(t('story.help.title'))}</legend>
              ${points}
              <p class="apply-field-error" data-field-error="helpPoints" role="alert" hidden></p>
            </fieldset>
          </details>
          <details class="story-opt" data-opt="links"${open || (v.workLinks || []).length ? ' open' : ''}>
            <summary><span class="story-opt-name">${esc(t('story.links.title'))}</span><span class="story-opt-what">${esc(t('story.links.hint'))}</span></summary>
            <fieldset class="apply-field story-links">
              <legend class="sr-only">${esc(t('story.links.title'))}</legend>
              ${links}
              <p class="apply-field-error" data-field-error="workLinks" role="alert" hidden></p>
            </fieldset>
          </details>
        </section>
      </div>`;
  }

  function wire(root) {
    const form = root.querySelector('[data-story-form]');
    if (!form) return;
    form.querySelectorAll('[data-story-count]').forEach((area) => {
      const out = form.querySelector(`#${CSS.escape(area.id)}-count`);
      const draw = () => {
        const n = size(area.value);
        const min = Number(area.dataset.min), max = Number(area.dataset.max);
        // (a one-line box, data-plain, is counted as the server stores it: spaces and line breaks in a row are one space)
        const over = (area.hasAttribute('data-plain') ? n : [...area.value.trim()].length) > max;
        // (long enough but one letter or a few words over and over: it would not count, and the count says so; public/js/text-rules.js.
        // Not for the short one-line boxes, which the server does not check for that.)
        const repeated = !area.hasAttribute('data-plain') && n >= min && Boolean(window.WisecallTextRules) && WisecallTextRules.looksRepeated(area.value);
        out.textContent = !area.value.trim() ? fill('story.count.empty', { min, max }) : fill(over ? 'story.count.over' : (repeated ? 'apply.story.countRepeated' : (n >= min ? 'story.count.ok' : 'story.count')), { n, min, max });
        out.classList.toggle('is-ok', Boolean(area.value.trim()) && n >= min && !over && !repeated);
        out.classList.toggle('is-over', over);
      };
      area.addEventListener('input', draw);
      draw();
    });
    // About: "150 more characters needed" until it is enough, then "n characters ✓"; over the limit it says so (nothing is cut). Typing
    // clears what was said under it.
    form.querySelectorAll('[data-about-count]').forEach((area) => {
      const out = form.querySelector(`#${CSS.escape(area.id)}-count`);
      const min = Number(area.dataset.min), max = Number(area.dataset.max);
      const draw = () => {
        const n = size(area.value);
        const over = [...area.value.trim()].length > max;
        const repeated = n >= min && Boolean(window.WisecallTextRules) && WisecallTextRules.looksRepeated(area.value);
        out.textContent = over ? fill('story.count.over', { n: [...area.value.trim()].length, max })
          : (n < min ? fill('story.about.need', { left: min - n, min }) : fill(repeated ? 'apply.story.countRepeated' : 'story.count.ok', { n, max }));
        out.classList.toggle('is-ok', n >= min && !over && !repeated);
        out.classList.toggle('is-over', over);
      };
      area.addEventListener('input', () => { draw(); aboutError(form, ''); });
      draw();
    });
    // (what was said under a field goes once it is changed)
    form.addEventListener('input', (ev) => {
      const name = ev.target && ev.target.name;
      if (!name || ev.isTrusted === false) return;
      const field = { helpPoint: 'helpPoints', workLink: 'workLinks' }[name] || name;
      if (field !== 'about') fieldError(form, field, '');
    });
    // The boxes grow with what is written in them (nothing scrolls inside a box): now, as the mentor types, and when a closed part opens.
    const grow = (area) => { if (!area.offsetParent) return; area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; };
    form.querySelectorAll('textarea').forEach((area) => { area.classList.add('story-grow'); area.addEventListener('input', () => grow(area)); grow(area); });
    form.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', () => d.querySelectorAll('textarea').forEach(grow)));
    window.addEventListener('resize', () => form.querySelectorAll('textarea').forEach(grow));
    const maxTags = () => Number(form.querySelector('.story-tags').dataset.maxTags) || 3;
    form.addEventListener('click', (ev) => {
      const tag = ev.target.closest('[data-start-tag]');
      if (!tag) return;
      const on = tag.getAttribute('aria-pressed') === 'true';
      const chosen = form.querySelectorAll('[data-start-tag][aria-pressed="true"]').length;
      const note = form.querySelector('[data-tags-max]');
      if (!on && chosen >= maxTags()) { note.hidden = false; return; }
      note.hidden = true;
      tag.setAttribute('aria-pressed', String(!on));
    });
  }

  function read(root) {
    const form = root.querySelector('[data-story-form]');
    const val = (name) => (form.querySelector(`[name="${name}"]`) || { value: '' }).value;
    return {
      pathStart: val('pathStart'), pathHow: val('pathHow'), pathNow: val('pathNow'), about: val('about'),
      startTags: [...form.querySelectorAll('[data-start-tag][aria-pressed="true"]')].map((b) => b.dataset.startTag),
      sampleQuestion: val('sampleQuestion'), sampleReply: val('sampleReply'),
      helpPoints: [...form.querySelectorAll('[name="helpPoint"]')].map((i) => i.value).filter((x) => x.trim()),
      workLinks: [...form.querySelectorAll('[name="workLink"]')].map((i) => i.value).filter((x) => x.trim())
    };
  }

  // Before "Next": the three blocks, each long enough; or none of them while an old story still counts.
  function pathProblem(values, limits, { oldStoryOk = false } = {}) {
    const filled = PATH.filter(([key]) => String(values[key] || '').trim());
    if (!filled.length && oldStoryOk) return null;
    for (const [key] of PATH) {
      if (!String(values[key] || '').trim()) return { field: key, code: filled.length ? 'path_incomplete' : 'path_short' };
      if (size(values[key]) < limits.pathMin) return { field: key, code: 'path_short' };
      if (window.WisecallTextRules && WisecallTextRules.looksRepeated(values[key])) return { field: key, code: 'path_repeated' };
    }
    return null;
  }

  // ---- What is wrong, under the field it is about --------------------------------------------------------------------------------------
  // The input(s) of a field name (the links and the "I can help with" lines are several boxes with one name).
  const inputsOf = (form, field) => [...form.querySelectorAll(`[name="${({ helpPoints: 'helpPoint', workLinks: 'workLink' }[field] || field)}"]`)];
  // The line under a field (empty text: none), the field marked; with focus: opened (when it is in a closed part), in view and in focus.
  function fieldError(root, field, text, { focus = false } = {}) {
    const form = root.querySelector('[data-story-form]') || root;
    if (field === 'about') return aboutError(root, text, { focus });
    const line = form.querySelector(`[data-field-error="${field}"]`);
    if (!line) return false;
    line.textContent = text || '';
    line.hidden = !text;
    const inputs = inputsOf(form, field);
    inputs.forEach((i) => i.setAttribute('aria-invalid', text ? 'true' : 'false'));
    if (text && focus) {
      const more = line.closest('details');
      if (more) more.open = true;
      // (the box that is over its limit, when it is that; else the first empty one)
      const overMax = (i) => i.dataset.max && size(i.value) > Number(i.dataset.max);
      const target = inputs.find(overMax) || inputs.find((i) => !i.value.trim()) || inputs[0] || line;
      if (target.scrollIntoView) target.scrollIntoView({ block: 'center' });
      if (target.focus) target.focus({ preventScroll: true });
    }
    return true;
  }
  function clearErrors(root) {
    const form = root.querySelector('[data-story-form]') || root;
    form.querySelectorAll('[data-field-error]').forEach((l) => { l.textContent = ''; l.hidden = true; });
    form.querySelectorAll('[aria-invalid="true"]').forEach((i) => i.setAttribute('aria-invalid', 'false'));
    aboutError(root, '');
  }
  // Every "My path" block that does not count yet, each with its own reason: [{ field, code, left }]. None filled in is fine (the path is
  // then simply not shown); one or two filled in asks for the others.
  function pathProblems(values, limits) {
    const min = (limits && limits.pathMin) || 40;
    const filled = PATH.filter(([key]) => String(values[key] || '').trim());
    if (!filled.length) return [];
    const out = [];
    for (const [key] of PATH) {
      const text = String(values[key] || '');
      if (!text.trim()) out.push({ field: key, code: 'path_incomplete' });
      else if (size(text) < min) out.push({ field: key, code: 'path_short', left: min - size(text) });
      else if (window.WisecallTextRules && WisecallTextRules.looksRepeated(text)) out.push({ field: key, code: 'path_repeated' });
    }
    return out;
  }
  // The words for one of those, for the line under its field.
  const problemText = (p, limits) => fill({ path_short: 'story.err.blockShort', path_incomplete: 'story.err.blockEmpty', path_repeated: 'apply.err.storyRepeated' }[p.code] || 'toast.error',
    { min: (limits && limits.pathMin) || 40, left: p.left || 0 });
  // What read() gave, put back into the form (after the page was drawn again): nothing typed is lost.
  function restore(root, values) {
    const form = root.querySelector('[data-story-form]');
    if (!form || !values) return;
    const set = (name, v) => { const el = form.querySelector(`[name="${name}"]`); if (el && typeof v === 'string') { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    ['pathStart', 'pathHow', 'pathNow', 'about', 'sampleQuestion', 'sampleReply'].forEach((k) => set(k, values[k]));
    const many = (name, list) => form.querySelectorAll(`[name="${name}"]`).forEach((el, i) => { el.value = (list || [])[i] || ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    many('helpPoint', values.helpPoints);
    many('workLink', values.workLinks);
    if (Array.isArray(values.startTags)) form.querySelectorAll('[data-start-tag]').forEach((b) => b.setAttribute('aria-pressed', String(values.startTags.includes(b.dataset.startTag))));
  }

  // A draft over what the server has now, field by field: a field of the draft goes back when it differs from the server's and the
  // server still has what it had when the draft was typed (base). A field saved since (here, on another device, or by a save that took
  // the rest of the form but refused one field) is newer than the draft and stays. -> { values, changed }
  const DRAFT_FIELDS = ['pathStart', 'pathHow', 'pathNow', 'about', 'sampleQuestion', 'sampleReply', 'startTags', 'helpPoints', 'workLinks'];
  function merge(current, base, draft) {
    const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
    const values = { ...current };
    let changed = false;
    for (const f of DRAFT_FIELDS) {
      if (!draft || draft[f] === undefined || same(draft[f], current[f])) continue;
      if (base && !same(base[f], current[f])) continue;
      values[f] = draft[f];
      changed = true;
    }
    return { values, changed };
  }

  // "შენ შესახებ" before "Next" and before sending: at least 150 characters of real writing. -> null | { code, left }
  function aboutProblem(values, limits) {
    const min = (limits && limits.aboutMin) || 150;
    const text = String(values.about || '');
    const n = size(text);
    if (n < min) return { code: 'about_short', left: min - n };
    if (window.WisecallTextRules && WisecallTextRules.looksRepeated(text)) return { code: 'about_repeated' };
    return null;
  }
  // The line right under the About box (empty text: none), the box marked; in view and in focus when there is something to say.
  function aboutError(root, text, { focus = false } = {}) {
    const el = root.querySelector('[data-about-error]');
    const area = root.querySelector('[data-story-form] [name="about"]');
    if (el) { el.textContent = text || ''; el.hidden = !text; }
    if (area) area.setAttribute('aria-invalid', text ? 'true' : 'false');
    if (text && focus && area) { if (area.scrollIntoView) area.scrollIntoView({ block: 'center' }); area.focus({ preventScroll: true }); }
  }
  // The words for an About that does not count yet (how many characters it still needs).
  const aboutText = (p, limits) => fill(p.code === 'about_repeated' ? 'story.err.aboutRepeated' : 'story.err.aboutShort', { min: (limits && limits.aboutMin) || 150, left: p.left || 0 });

  const ERRORS = {
    path_short: 'story.err.path_short', path_incomplete: 'story.err.path_incomplete', path_repeated: 'apply.err.storyRepeated',
    contact_details: 'story.err.contact', offensive: 'story.err.offensive', invalid_start_tags: 'toast.error', too_many_start_tags: 'story.tags.max',
    sample_question_short: 'story.err.sample_question', sample_reply_short: 'story.err.sample_reply', help_point_short: 'story.err.help_point',
    too_many_help_points: 'story.err.help_point', invalid_link: 'story.err.link', too_many_links: 'story.err.link',
    pathStart_too_long: 'story.err.too_long', pathHow_too_long: 'story.err.too_long', pathNow_too_long: 'story.err.too_long', sampleQuestion_too_long: 'story.err.too_long',
    sampleReply_too_long: 'story.err.too_long', helpPoints_too_long: 'story.err.too_long', fieldSuggestion_too_long: 'story.err.too_long', about_too_long: 'story.err.aboutLong',
    about_short: 'story.err.aboutNeed', about_repeated: 'story.err.aboutRepeated'
  };
  const knows = (code) => Object.prototype.hasOwnProperty.call(ERRORS, code);
  function errorText(e, limits) {
    const field = e && e.data && e.data.field;
    if (e.code === 'contact_details' && field === 'workLinks') return t('story.err.linkContact');
    const L = limits || {};
    if (e.code === 'about_short' || e.code === 'about_repeated') return fill(ERRORS[e.code], { min: L.aboutMin || 150 });
    // (too long: the limit of that field, in the words)
    if (/_too_long$/.test(e.code || '') && e.code !== 'about_too_long') return fill('story.err.too_long', { max: L[MAX_OF[field]] || DEFAULT_MAX[field] || '' });
    return fill(ERRORS[e.code] || 'toast.error', { min: L.pathMin || 40, max: L.tagsMax || 3 });
  }
  // (which limit a field's "too long" is about: server/mentorStory.js LIMITS)
  const MAX_OF = { pathStart: 'pathMax', pathHow: 'pathMax', pathNow: 'pathMax', sampleQuestion: 'questionMax', sampleReply: 'replyMax', helpPoints: 'pointMax', fieldSuggestion: 'suggestionMax' };
  const DEFAULT_MAX = { pathStart: 400, pathHow: 400, pathNow: 400, sampleQuestion: 160, sampleReply: 600, helpPoints: 200, fieldSuggestion: 60 };
  // The input a server answer is about (to focus it).
  function fieldOf(root, e) {
    const field = e && e.data && e.data.field;
    const name = { helpPoints: 'helpPoint', workLinks: 'workLink' }[field] || field;
    return name ? root.querySelector(`[data-story-form] [name="${name}"]`) : null;
  }

  window.WisecallStoryForm = { html, wire, read, merge, pathProblem, pathProblems, problemText, fieldError, clearErrors, restore, aboutProblem, aboutError, aboutText, errorText, knows, fieldOf };
})();
