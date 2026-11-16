// "My path" and what goes with it (docs/CLAUDE-CODE-MENTOR-STORY.md), one form for step 2 of the application (public/js/apply.js) and for
// Settings -> My details (public/js/settings-details.js): three short blocks (where I started, how I coped, where I am now), up to 3
// starting-point tags, "შენ შესახებ" (the profile's About, optional, up to 2000 characters), and, all optional, a sample question with a short sample answer, three "I can help with" lines and up to 3 work links.
// The server decides every rule (server/mentorStory.js); this asks, counts and explains. Every example is labelled "Example".
//   WisecallStoryForm.html(values, { limits, startTags, prefix, oldStory, open })  -> the fields (inside the page's own <form>)
//   WisecallStoryForm.wire(root)            counters, "at most 3" for the tags
//   WisecallStoryForm.read(root)            -> what to send
//   WisecallStoryForm.pathProblem(values, limits, { oldStoryOk }) -> null | { field, code }   (before "Next": all three blocks, or none with an old story)
//   WisecallStoryForm.errorText(error)      -> words for a server answer (error.code, error.data.field)
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const size = (text) => (window.WisecallTextRules ? WisecallTextRules.size(text) : [...String(text || '').trim().replace(/\s+/g, ' ')].length);
  const PATH = [['pathStart', 'start'], ['pathHow', 'how'], ['pathNow', 'now']];

  function html(values, { limits, startTags = [], prefix = 'st', oldStory = '', open = false } = {}) {
    const v = values || {};
    const L = limits;
    const block = ([key, name]) => `
      <div class="apply-field story-field">
        <label for="${prefix}-${key}">${esc(t(`story.${name}.label`))}</label>
        <textarea id="${prefix}-${key}" name="${key}" rows="4" data-story-count data-min="${L.pathMin}" data-max="${L.pathMax}" aria-describedby="${prefix}-${key}-count ${prefix}-${key}-ex">${esc(v[key] || '')}</textarea>
        <p class="apply-count story-count" id="${prefix}-${key}-count" aria-live="polite"></p>
        <p class="hint story-example" id="${prefix}-${key}-ex"><span class="story-example-label">${esc(t('story.example'))}</span> ${esc(t(`story.${name}.ex`))}</p>
      </div>`;
    // (short boxes that wrap and grow like the others: a point is never cut off at the side of a phone; a line break in one is a space)
    const points = [0, 1, 2].map((i) => `<textarea name="helpPoint" rows="1" class="story-point" placeholder="${esc(t('story.example'))} ${esc(t(`story.help.ex${i + 1}`))}" aria-label="${esc(fill('story.help.n', { n: i + 1 }))}">${esc((v.helpPoints || [])[i] || '')}</textarea>`).join('');
    const links = [0, 1, 2].map((i) => `<input type="url" name="workLink" inputmode="url" value="${esc((v.workLinks || [])[i] || '')}" placeholder="https://" aria-label="${esc(fill('story.links.n', { n: i + 1 }))}">`).join('');
    // "შენ შესახებ" / "About you": optional, the whole career in the mentor's own words; the profile's About. No length cap in the box
    // (nothing typed is ever cut): the count says when it is over, and the server says so too.
    const aboutMax = L.aboutMax || 2000;
    const about = `
      <div class="apply-field story-about">
        <label for="${prefix}-about">${esc(t('story.about.label'))} <span class="hint">${esc(t('story.about.optional'))}</span></label>
        <p class="hint" id="${prefix}-about-hint">${esc(t('story.about.hint'))}</p>
        <textarea id="${prefix}-about" name="about" rows="6" data-about-count data-max="${aboutMax}" aria-describedby="${prefix}-about-hint ${prefix}-about-count ${prefix}-about-ex">${esc(v.about || '')}</textarea>
        <p class="apply-count story-count" id="${prefix}-about-count" aria-live="polite"></p>
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
              <textarea id="${prefix}-sampleQuestion" name="sampleQuestion" rows="1" class="story-point" aria-describedby="${prefix}-sq-ex">${esc(v.sampleQuestion || '')}</textarea>
              <span class="hint story-example" id="${prefix}-sq-ex"><span class="story-example-label">${esc(t('story.example'))}</span> ${esc(t('story.sample.q.ex'))}</span>
            </div>
            <div class="apply-field">
              <label for="${prefix}-sampleReply">${esc(fill('story.sample.a', { min: L.replyMin, max: L.replyMax }))}</label>
              <textarea id="${prefix}-sampleReply" name="sampleReply" rows="4" data-story-count data-min="${L.replyMin}" data-max="${L.replyMax}" aria-describedby="${prefix}-sampleReply-count ${prefix}-sa-hint">${esc(v.sampleReply || '')}</textarea>
              <p class="apply-count story-count" id="${prefix}-sampleReply-count" aria-live="polite"></p>
              <span class="hint" id="${prefix}-sa-hint">${esc(t('story.sample.hint'))}</span>
            </div>
          </details>
          <details class="story-opt" data-opt="help"${open || (v.helpPoints || []).length ? ' open' : ''}>
            <summary><span class="story-opt-name">${esc(t('story.help.title'))}</span><span class="story-opt-what">${esc(t('story.help.hint'))}</span></summary>
            <fieldset class="apply-field story-points">
              <legend class="sr-only">${esc(t('story.help.title'))}</legend>
              ${points}
            </fieldset>
          </details>
          <details class="story-opt" data-opt="links"${open || (v.workLinks || []).length ? ' open' : ''}>
            <summary><span class="story-opt-name">${esc(t('story.links.title'))}</span><span class="story-opt-what">${esc(t('story.links.hint'))}</span></summary>
            <fieldset class="apply-field story-links">
              <legend class="sr-only">${esc(t('story.links.title'))}</legend>
              ${links}
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
        const over = [...area.value.trim()].length > max;
        // (long enough but one letter or a few words over and over: it would not count, and the count says so; public/js/text-rules.js)
        const repeated = n >= min && Boolean(window.WisecallTextRules) && WisecallTextRules.looksRepeated(area.value);
        out.textContent = !area.value.trim() ? fill('story.count.empty', { min, max }) : fill(over ? 'story.count.over' : (repeated ? 'apply.story.countRepeated' : (n >= min ? 'story.count.ok' : 'story.count')), { n, min, max });
        out.classList.toggle('is-ok', Boolean(area.value.trim()) && n >= min && !over && !repeated);
        out.classList.toggle('is-over', over);
      };
      area.addEventListener('input', draw);
      draw();
    });
    // About: "n / 2000"; over the limit it says so (nothing is cut).
    form.querySelectorAll('[data-about-count]').forEach((area) => {
      const out = form.querySelector(`#${CSS.escape(area.id)}-count`);
      const max = Number(area.dataset.max);
      const draw = () => {
        const n = [...area.value.trim()].length;
        out.textContent = fill('profile.bio.count', { n, max });
        out.classList.toggle('is-over', n > max);
      };
      area.addEventListener('input', draw);
      draw();
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

  const ERRORS = {
    path_short: 'story.err.path_short', path_incomplete: 'story.err.path_incomplete', path_repeated: 'apply.err.storyRepeated',
    contact_details: 'story.err.contact', offensive: 'story.err.offensive', invalid_start_tags: 'toast.error', too_many_start_tags: 'story.tags.max',
    sample_question_short: 'story.err.sample_question', sample_reply_short: 'story.err.sample_reply', help_point_short: 'story.err.help_point',
    too_many_help_points: 'story.err.help_point', invalid_link: 'story.err.link', too_many_links: 'story.err.link',
    pathStart_too_long: 'story.err.too_long', pathHow_too_long: 'story.err.too_long', pathNow_too_long: 'story.err.too_long', sampleQuestion_too_long: 'story.err.too_long',
    sampleReply_too_long: 'story.err.too_long', helpPoints_too_long: 'story.err.too_long', fieldSuggestion_too_long: 'story.err.too_long', about_too_long: 'story.err.aboutLong'
  };
  const knows = (code) => Object.prototype.hasOwnProperty.call(ERRORS, code);
  function errorText(e, limits) {
    const field = e && e.data && e.data.field;
    if (e.code === 'contact_details' && field === 'workLinks') return t('story.err.linkContact');
    const L = limits || {};
    return fill(ERRORS[e.code] || 'toast.error', { min: L.pathMin || 40, max: L.tagsMax || 3 });
  }
  // The input a server answer is about (to focus it).
  function fieldOf(root, e) {
    const field = e && e.data && e.data.field;
    const name = { helpPoints: 'helpPoint', workLinks: 'workLink' }[field] || field;
    return name ? root.querySelector(`[data-story-form] [name="${name}"]`) : null;
  }

  window.WisecallStoryForm = { html, wire, read, pathProblem, errorText, knows, fieldOf };
})();
