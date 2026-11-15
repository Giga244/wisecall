// "Find your mentor" (docs/CLAUDE-CODE-MENTOR-MATCH.md, stage 1): a few questions, then the verified mentors who fit best, each with a
// short reason built only from what really matched. Free, no account, no AI. The server decides who fits (server/matching.js, weights in
// server/matchConfig.js); this page asks, waits a moment, and shows.
//   The form: one page on a computer; three steps with a progress bar on a phone (1 the field, 2 where you are and where you start from,
//   3 what worries you most). Only the field and "where are you now" are required.
//   The results: up to 3 real mentors. Fewer than 3 (or none): only the real ones, then "more mentors of your field soon" with a way to
//   be told by email. Never a made-up or placeholder mentor.
(async function () {
  // (the request form's own links show that form instead: public/js/find-mentor.js; the same rule, decided at once)
  if (['request', 'field', 'niche', 'confirmed', 'removed'].some((k) => new URLSearchParams(location.search).has(k))) return;
  await WisecallI18n.initI18n();
  await WisecallNav.initNav();
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const nameIn = (x) => (x ? WisecallI18n.nameIn(x) : '');
  const root = document.getElementById('matchApp');
  const params = new URLSearchParams(location.search);
  const STAGES = ['school', 'university', 'switching', 'working'];
  const SHOWN_FIELDS = 8;   // (fields shown before "+ more")
  const SHOWN_DIRS = 8;
  const MAX_TAGS = 3, MAX_DIRS = 3, MAX_WORRY = 500;
  const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phone = window.matchMedia('(max-width: 699px)');

  let catalog = null;
  try { catalog = await WisecallAPI.apiFetch('/categories'); } catch (e) { root.innerHTML = `<div class="match-card"><p class="form-error" role="alert">${esc(t('toast.error'))}</p></div>`; return; }
  const fieldById = (id) => catalog.fields.find((f) => f.id === id);
  const chipById = (id) => { for (const f of catalog.fields) { const c = f.chips.find((x) => x.id === id); if (c) return c; } return null; };

  // What the student has answered so far.
  const st = { fieldId: null, directions: [], stage: null, startTags: [], worry: '' };
  const start = params.get('f'); // (?f=<field>: from the experts page's banner, the field the student was looking at)
  if (start && fieldById(start)) st.fieldId = start;
  let step = 0;            // (phones: 0, 1, 2)
  let view = 'form';       // form | searching | results
  let result = null;
  let allFields = false, allDirs = false;
  let query = '', hits = [], hitsFor = '', hitTimer = null;
  let error = { step: null, text: '' };

  // ---- The form -------------------------------------------------------------------------------------------------------------------------
  const norm = (v) => String(v || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
  function fieldStep() {
    const q = norm(query);
    const byName = q ? catalog.fields.filter((f) => norm(`${f.ka} ${f.en}`).includes(q)) : catalog.fields;
    // (the chosen field first; then the fields with mentors; a phone shows a few and "+ more")
    const ordered = q ? byName : [...catalog.fields].sort((a, b) => (b.id === st.fieldId) - (a.id === st.fieldId) || (b.count > 0) - (a.count > 0));
    const shown = q || allFields ? ordered : ordered.slice(0, SHOWN_FIELDS);
    const field = st.fieldId ? fieldById(st.fieldId) : null;
    const dirs = field ? field.chips.filter((c) => !c.other && (!c.moved || st.directions.includes(c.id))) : [];
    const dirsShown = allDirs ? dirs : dirs.filter((c, i) => i < SHOWN_DIRS || st.directions.includes(c.id));
    return `
      <section class="match-q" aria-labelledby="mqField">
        <h2 id="mqField">${esc(t('match.q.field'))}</h2>
        <div class="match-search"><label for="matchSearch" class="sr-only">${esc(t('match.search'))}</label>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="matchSearch" value="${esc(query)}" placeholder="${esc(t('match.search'))}" autocomplete="off" enterkeyhint="search"></div>
        ${q && hitsFor === q && hits.length ? `<div class="match-chips match-hits" role="group" aria-label="${esc(t('fp.hits'))}">${hits.map((c) => `<button type="button" class="chip match-chip" data-hit="${esc(c.id)}" data-hit-field="${esc(c.field)}">${esc(nameIn(c))} <span class="match-hit-field">· ${esc(nameIn(fieldById(c.field)))}</span></button>`).join('')}</div>` : ''}
        <div class="match-chips" role="group" aria-labelledby="mqField">
          ${shown.map((f) => `<button type="button" class="chip match-chip" data-field="${esc(f.id)}" aria-pressed="${f.id === st.fieldId}">${esc(nameIn(f))}</button>`).join('')}
          ${!q && !allFields && ordered.length > shown.length ? `<button type="button" class="chip match-chip match-more" data-all-fields>${esc(t('match.moreFields'))}</button>` : ''}
        </div>
        ${q && !shown.length && !(hitsFor === q && hits.length) ? `<p class="hint">${esc(t('match.search.none'))}</p>` : ''}
        ${field && dirs.length ? `
          <div class="match-sub">
            <h3 id="mqDirs">${esc(t('match.q.directions'))} <span class="match-optional">${esc(t('match.optional'))}</span></h3>
            <div class="match-chips" role="group" aria-labelledby="mqDirs">
              ${dirsShown.map((c) => `<button type="button" class="chip match-chip" data-direction="${esc(c.id)}" aria-pressed="${st.directions.includes(c.id)}">${esc(nameIn(c))}</button>`).join('')}
              ${!allDirs && dirs.length > dirsShown.length ? `<button type="button" class="chip match-chip match-more" data-all-dirs>${esc(fill('fp.more', { n: dirs.length - dirsShown.length }))}</button>` : ''}
            </div>
          </div>` : ''}
        <p class="form-error match-error" role="alert" data-error="0">${error.step === 0 ? esc(error.text) : ''}</p>
      </section>`;
  }
  function aboutStep() {
    return `
      <section class="match-q" aria-labelledby="mqStage">
        <h2 id="mqStage">${esc(t('match.q.stage'))}</h2>
        <div class="match-chips" role="radiogroup" aria-labelledby="mqStage">
          ${STAGES.map((k) => `<button type="button" class="chip match-chip" role="radio" data-stage="${k}" aria-checked="${st.stage === k}">${esc(t('match.stage.' + k))}</button>`).join('')}
        </div>
        <p class="form-error match-error" role="alert" data-error="1">${error.step === 1 ? esc(error.text) : ''}</p>
      </section>
      <section class="match-q" aria-labelledby="mqStart">
        <h2 id="mqStart">${esc(t('match.q.start'))} <span class="match-optional">${esc(t('match.optional'))}</span></h2>
        <p class="hint match-hint">${esc(fill('match.q.start.hint', { max: MAX_TAGS }))}</p>
        <div class="match-chips" role="group" aria-labelledby="mqStart">
          ${(catalog.matchTags || []).map((id) => `<button type="button" class="chip match-chip" data-tag="${esc(id)}" aria-pressed="${st.startTags.includes(id)}">${esc(t('match.tag.' + id))}</button>`).join('')}
        </div>
      </section>`;
  }
  function worryStep() {
    return `
      <section class="match-q" aria-labelledby="mqWorry">
        <h2 id="mqWorry"><label for="matchWorry">${esc(t('match.q.worry'))}</label> <span class="match-optional">${esc(t('match.optional'))}</span></h2>
        <textarea id="matchWorry" rows="4" aria-describedby="matchWorryCount matchPrivacy" placeholder="${esc(t('match.q.worry.placeholder'))}">${esc(st.worry)}</textarea>
        <p class="match-count" id="matchWorryCount" aria-live="polite"></p>
        <p class="match-privacy" id="matchPrivacy"><span aria-hidden="true">🔒</span> ${esc(t('match.privacy'))}</p>
        <p class="form-error match-error" role="alert" data-error="2">${error.step === 2 ? esc(error.text) : ''}</p>
      </section>`;
  }
  function formHtml() {
    const steps = [fieldStep(), aboutStep(), worryStep()];
    return `
      <form class="match-card match-form" id="matchForm" novalidate data-step="${step}">
        <div class="match-progress" role="progressbar" aria-valuemin="1" aria-valuemax="3" aria-valuenow="${step + 1}" aria-label="${esc(fill('match.step', { n: step + 1, of: 3 }))}">
          ${[0, 1, 2].map((i) => `<i class="${i <= step ? 'is-on' : ''}"></i>`).join('')}
        </div>
        <h1 tabindex="-1">${esc(t('match.title'))}</h1>
        <p class="match-lead">${esc(t('match.lead'))}</p>
        ${steps.map((html, i) => `<div class="match-step${i === step ? ' is-current' : ''}" data-step-part="${i}">${html}</div>`).join('')}
        <div class="match-nav">
          <button type="button" class="btn btn-outline btn-lg match-back" data-back${step === 0 ? ' hidden' : ''}>${esc(t('apply.back'))}</button>
          <button type="button" class="btn btn-primary btn-lg match-next" data-next${step === 2 ? ' hidden' : ''}>${esc(t('match.next'))}</button>
          <button type="submit" class="btn btn-primary btn-lg btn-arrow match-submit"${step === 2 ? '' : ' data-last-only'}>${esc(t('match.submit'))}</button>
        </div>
        <p class="match-free">${esc(t('match.free'))}</p>
      </form>`;
  }

  // ---- Searching, and the results -----------------------------------------------------------------------------------------------------------
  function searchingHtml() {
    const field = fieldById(st.fieldId);
    return `
      <div class="match-card match-searching" role="status">
        <span class="match-jikhva" aria-hidden="true"></span>
        <h1>${esc(t('match.searching'))}</h1>
        <p class="match-lead">${esc(t('match.searching.sub'))}</p>
        <ul class="match-checks">
          <li>${CHECK}<span>${esc(fill('match.searching.field', { field: nameIn(field) }))}</span></li>
          ${st.startTags.length ? `<li>${CHECK}<span>${esc(fill('match.searching.start', { tags: st.startTags.map((id) => t('match.tag.' + id)).join(', ') }))}</span></li>` : ''}
        </ul>
      </div>`;
  }
  // The starting points the student is living now, as the mentor did: said as "like you" ("შენსავით რეგიონიდანაა"). A grant and study
  // abroad the student only wants so far: for those the line says what the mentor did, never "like you".
  const SAME = ['region', 'worked', 'selftaught', 'firstgen'];
  // "Why them": only from what the server says matched (why), in this order: what they share with the student's own start, what they did
  // that the student is after, the directions they share, how their start or work fits where the student is now; with none of those,
  // that they work in the field. At most two sentences.
  function whyText(m) {
    const w = m.why || {};
    const parts = [];
    const join = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} ${t('match.and')} ${list[list.length - 1]}` : list[0]);
    const did = (ids) => fill('match.why.also', { what: join(ids.map((id) => t('match.did.' + id))) });
    const same = (w.tags || []).filter((id) => SAME.includes(id));
    const wanted = (w.tags || []).filter((id) => !SAME.includes(id));
    // (the stage is said only when the server says it matched: why.stage)
    const stageTag = w.stage && w.stage.tag ? w.stage.tag : null;
    if (same.length) parts.push(fill('match.why.like', { list: join(same.map((id) => t('match.like.' + id))) }));
    // (one "they themselves…" sentence: what the student is after, and with it the sign that fits the student's stage)
    if (wanted.length) parts.push(did([...wanted, ...(stageTag ? [stageTag] : [])]));
    if ((w.directions || []).length) parts.push(fill('match.why.directions', { list: w.directions.map((id) => nameIn(chipById(id))).filter(Boolean).join(', ') }));
    if (stageTag && !wanted.length) parts.push(did([stageTag]));
    if (!stageTag && w.stage && w.stage.kind) parts.push(t('match.why.kind.' + w.stage.kind));
    if (!parts.length) parts.push(fill('match.why.field', { field: nameIn(fieldById(w.field || st.fieldId)) }));
    return parts.slice(0, 2).join(' ');
  }
  function cardHtml(m, i) {
    const prelaunch = WisecallI18n.launchMode() === 'prelaunch';
    const w = m.why || {};
    // (up to 2 tags: the ones the student shares first)
    const tags = [...(w.tags || []), ...(m.trust ? m.trust.startTags : []).filter((id) => !(w.tags || []).includes(id))].slice(0, 2);
    const role = [m.roleTitle].filter(Boolean).join('');
    const href = `/u/${encodeURIComponent(m.username)}`;
    return `
      <li class="match-mentor">
        <div class="match-mentor-top">
          ${WisecallAPI.avatar(m, { size: 56 })}
          <div class="match-mentor-who">
            <a class="match-mentor-name" href="${href}">${esc(m.name)}</a>
            ${role ? `<p class="match-mentor-role">${esc(role)}</p>` : ''}
            <p class="verified-mark">${CHECK}${esc(t('expert.verifiedShort'))}</p>
          </div>
          <span class="match-rank" aria-label="${esc(fill('match.rank', { n: i + 1 }))}">#${i + 1}</span>
        </div>
        <p class="match-why"><strong>${esc(t('match.why'))}</strong> ${esc(whyText(m))}</p>
        ${tags.length || (m.trust && m.trust.hasSample) ? `<div class="match-tags">${tags.map((id) => `<span class="tag tag-start">${esc(t('start.' + id))}</span>`).join('')}${m.trust && m.trust.hasSample ? `<span class="tag tag-sample">${esc(t('experts.card.sample'))}</span>` : ''}</div>` : ''}
        <div class="match-mentor-foot">
          <span class="match-price${m.price === 0 ? ' is-free' : ''}">${WisecallAPI.formatPrice(m.price)}${m.price === 0 ? '' : ` <small>${esc(t('expert.perQuestion'))}</small>`}</span>
          ${prelaunch
            ? `<button type="button" class="btn btn-primary" data-subscribe="matchWait${i}">${esc(t('expert.subscribeCta'))}</button>`
            : `<a class="btn btn-primary" href="${href}">${esc(t('expert.askCta'))}</a>`}
        </div>
        ${prelaunch ? `<div class="match-wait" id="matchWait${i}" hidden></div>` : ''}
      </li>`;
  }
  function resultsHtml() {
    const list = result.mentors;
    const field = fieldById(result.fieldId);
    const top = 3;
    // ("started like you" only when a shown mentor shares a start the student is living now; "walked the path you are starting" when
    // they share what the student is after; otherwise only that they work in the field)
    const likeYou = list.some((m) => (m.why.tags || []).some((id) => SAME.includes(id)));
    const samePath = list.some((m) => (m.why.tags || []).length);
    const head = !list.length ? fill('match.none.title', { field: nameIn(field) })
      : t(`match.results.${likeYou ? 'like' : (samePath ? 'path' : 'field')}${list.length === 1 ? '.one' : ''}`);
    return `
      <div class="match-results">
        <div class="match-banner${list.length ? '' : ' is-empty'}">
          <span class="match-banner-jikhva" aria-hidden="true"></span>
          <h1 tabindex="-1">${esc(head)}</h1>
        </div>
        ${list.length ? `<ol class="match-list">${list.map(cardHtml).join('')}</ol>` : ''}
        ${list.length < top ? `
          <section class="match-few" aria-labelledby="matchFewTitle">
            <span class="match-few-jikhva" aria-hidden="true"></span>
            <h2 id="matchFewTitle">${esc(t('match.few.title'))}</h2>
            <p>${esc(t(list.length ? (list.length === 1 ? 'match.few.body.one' : 'match.few.body') : 'match.few.body.none').replace('{n}', list.length))}</p>
            <div class="match-notify">${WisecallWaitlist.html(result.fieldId, { submit: t('match.notify'), icon: 'mail' })}</div>
            <p class="hint match-real">${esc(t('match.real'))}</p>
          </section>` : ''}
        <p class="match-all">${esc(t('match.all.q'))} <a href="/experts.html?field=${encodeURIComponent(result.fieldId)}">${esc(t('match.all'))}</a></p>
        <p class="match-again"><button type="button" class="linklike" data-again>${esc(t('match.again'))}</button></p>
      </div>`;
  }

  // ---- Drawing and wiring ---------------------------------------------------------------------------------------------------------------
  function draw({ focus = false } = {}) {
    const active = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : null;
    const caret = active === 'matchSearch' ? document.activeElement.selectionStart : null;
    root.innerHTML = view === 'form' ? formHtml() : (view === 'searching' ? searchingHtml() : resultsHtml());
    if (view === 'form') {
      const worry = root.querySelector('#matchWorry');
      if (worry) { growWorry(worry); countWorry(worry); }
      if (active === 'matchSearch') { const box = root.querySelector('#matchSearch'); box.focus(); try { box.setSelectionRange(caret, caret); } catch (e) { /* no caret */ } }
      else if (active === 'matchWorry' && worry) worry.focus();
    }
    if (view === 'results') WisecallWaitlist.wire(root);
    if (focus) { const h = root.querySelector('h1'); if (h) { h.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'auto' }); } }
  }
  function growWorry(area) { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; }
  function countWorry(area) {
    const out = root.querySelector('#matchWorryCount');
    const n = [...area.value.trim()].length;
    out.textContent = n ? fill(n > MAX_WORRY ? 'match.worry.over' : 'match.worry.count', { n, max: MAX_WORRY }) : '';
    out.classList.toggle('is-over', n > MAX_WORRY);
  }
  function findHits() {
    clearTimeout(hitTimer);
    const q = norm(query);
    if (q.length < 2) { hits = []; hitsFor = q; return; }
    hitTimer = setTimeout(async () => {
      try {
        const r = await WisecallAPI.apiFetch('/categories/search?q=' + encodeURIComponent(q));
        if (norm(query) !== q) return;
        hits = (r.chips || []).filter((c) => { const x = chipById(c.id); return x && !x.other && !x.moved; }).slice(0, 5);
        hitsFor = q;
        if (view === 'form') draw();
      } catch (e) { /* the fields by name still work */ }
    }, 250);
  }
  const setError = (i, text) => { error = { step: i, text }; };
  // What a step still needs (phones go step by step; a computer checks everything at "show").
  function problemOf(i) {
    if (i === 0 && !st.fieldId) return t('match.err.field');
    if (i === 1 && !st.stage) return t('match.err.stage');
    if (i === 2 && [...st.worry.trim()].length > MAX_WORRY) return fill('match.worry.over', { n: [...st.worry.trim()].length, max: MAX_WORRY });
    return '';
  }

  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.field) { if (st.fieldId !== b.dataset.field) { st.fieldId = b.dataset.field; st.directions = []; allDirs = false; } query = ''; hits = []; setError(null, ''); draw(); return; }
    if (b.dataset.hit) {
      st.fieldId = b.dataset.hitField;
      st.directions = st.directions.filter((d) => d.split('.')[0] === st.fieldId);
      if (!st.directions.includes(b.dataset.hit) && st.directions.length < MAX_DIRS) st.directions.push(b.dataset.hit);
      query = ''; hits = []; setError(null, ''); draw(); return;
    }
    if (b.hasAttribute('data-all-fields')) { allFields = true; draw(); return; }
    if (b.hasAttribute('data-all-dirs')) { allDirs = true; draw(); return; }
    if (b.dataset.direction) {
      const id = b.dataset.direction;
      if (st.directions.includes(id)) st.directions = st.directions.filter((x) => x !== id);
      else if (st.directions.length < MAX_DIRS) st.directions.push(id);
      else { setError(0, fill('match.err.directions', { max: MAX_DIRS })); draw(); return; }
      setError(null, ''); draw(); return;
    }
    if (b.dataset.stage) { st.stage = b.dataset.stage; setError(null, ''); draw(); return; }
    if (b.dataset.tag) {
      const id = b.dataset.tag;
      if (st.startTags.includes(id)) st.startTags = st.startTags.filter((x) => x !== id);
      else if (st.startTags.length < MAX_TAGS) st.startTags.push(id);
      draw(); return;
    }
    if (b.hasAttribute('data-next')) {
      const problem = problemOf(step);
      if (problem) { setError(step, problem); draw(); return; }
      setError(null, ''); step = Math.min(2, step + 1); draw({ focus: true }); return;
    }
    if (b.hasAttribute('data-back')) { setError(null, ''); step = Math.max(0, step - 1); draw({ focus: true }); return; }
    if (b.dataset.subscribe) {
      // (before launch nobody can ask yet: the card's button gives way to the waiting list, the same form as on a mentor's own page)
      const box = document.getElementById(b.dataset.subscribe);
      box.innerHTML = `<p class="match-wait-note">${esc(t('expert.prelaunch.wait'))}</p>${WisecallWaitlist.html(result.fieldId, { submit: t('expert.subscribeCta') })}`;
      WisecallWaitlist.wire(box);
      box.hidden = false;
      b.hidden = true;
      const email = box.querySelector('input[type="email"]');
      if (email) email.focus({ preventScroll: true });
      box.scrollIntoView({ block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' });
      return;
    }
    if (b.hasAttribute('data-again')) { view = 'form'; step = 0; result = null; draw({ focus: true }); }
  });
  root.addEventListener('input', (ev) => {
    if (ev.target.id === 'matchSearch') { query = ev.target.value; findHits(); draw(); return; }
    if (ev.target.id === 'matchWorry') {
      st.worry = ev.target.value; growWorry(ev.target); countWorry(ev.target);
      // (what was refused is being changed: its line goes)
      if (error.step === 2) { setError(null, ''); const line = root.querySelector('[data-error="2"]'); if (line) line.textContent = ''; }
    }
  });
  root.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'matchForm') return;
    ev.preventDefault();
    // (a phone is on the last step; a computer shows every question at once: the first one that is missing is said under it)
    for (const i of [0, 1, 2]) {
      const problem = problemOf(i);
      if (problem) { setError(i, problem); step = i; draw(); const el = root.querySelector(`[data-error="${i}"]`); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: reduce() ? 'auto' : 'smooth' }); return; }
    }
    setError(null, '');
    view = 'searching';
    draw({ focus: true });
    // (a short "looking…": at least 0.8 s so it is not a flash, and never longer than the answer itself takes; none with reduced motion)
    const began = Date.now();
    const least = reduce() ? 0 : 800;
    try {
      const r = await WisecallAPI.apiFetch('/match', { method: 'POST', body: { fieldId: st.fieldId, directions: st.directions, stage: st.stage, startTags: st.startTags, worry: st.worry.trim() } });
      const wait = Math.max(0, least - (Date.now() - began));
      if (wait) await new Promise((done) => setTimeout(done, wait));
      result = r;
      view = 'results';
      draw({ focus: true });
    } catch (e) {
      view = 'form';
      const text = e.code === 'contact_details' ? t('match.err.contact') : (e.code === 'worry_too_long' ? fill('match.worry.over', { n: [...st.worry.trim()].length, max: MAX_WORRY }) : (e.code === 'too_many_requests' ? t('match.err.tooMany') : t('toast.error')));
      const at = { fieldId: 0, directions: 0, stage: 1, startTags: 1, worry: 2 }[(e.data || {}).field];
      step = at === undefined ? 2 : at;
      setError(step, text);
      draw({ focus: false });
      const el = root.querySelector(`[data-error="${step}"]`);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  });
  document.addEventListener('wisecall:lang-changed', () => draw());
  phone.addEventListener('change', () => { if (view === 'form') draw(); });

  draw();
})();
