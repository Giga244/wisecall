// The field and directions picker (docs/CLAUDE-CODE-NEW-CATEGORIES.md; mockups docs/redesign/directions-picker-phone.png and -desktop.png), one for
// the apply form (public/js/apply.js) and the details page (public/js/settings-details.js). Two cards: the main field (a search box, the fields as
// chips, "+ N more", then up to two more fields) and the directions (1 to 5, "+ write your own", a hint). Side by side on a computer, stacked on a
// phone. The rule: at least 1 direction and at most 5 (server/verification/experience.js and server/mentorEdit.js keep the same).
//
//   const picker = WisecallFieldPicker.create(area, { catalog, pick, t, fill, onChange });
//   pick: { main, extras: [], directions: [], other: {} } is changed in place; onChange(kind) after every change ('field', 'direction', 'other').
//   picker.draw() redraws (after pick was changed from outside); picker.valid() -> at least one direction; picker.showError(on).
(function () {
  const MIN = 1;
  // The 14 categories of docs/CLAUDE-CODE-NEW-CATEGORIES.md carry a small "New" tag until this day (60 days after they were released). To stop
  // showing it earlier, set a past date; to remove it for good, delete these two lines and the tag in fieldChip() below.
  const NEW_UNTIL = '2027-01-13';
  const NEW_FIELDS = ['econ', 'social', 'hum', 'avia', 'sea', 'vet', 'public', 'security', 'logistics', 'beauty', 'fashion', 'perform', 'allied'];
  const COLLAPSED = 9; // (fields shown before "+ N more")
  const DIRS_SHORT = 8; // (on a phone, directions shown per field before "+ კიდევ N"; a computer shows them all: the CSS)

  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (v) => String(v || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
  const isNew = (id) => NEW_FIELDS.includes(id) && new Date() < new Date(NEW_UNTIL + 'T00:00:00');

  function create(area, { catalog, pick, t, fill, onChange = () => {} }) {
    const nameIn = (x) => WisecallI18n.nameIn(x);
    const fieldById = (id) => catalog.fields.find((x) => x.id === id);
    const maxDirections = catalog.limits.directions;
    const maxExtras = catalog.limits.extraFields;
    let query = '';
    let open = false;     // the whole list shown ("+ N more" pressed)
    let adding = false;   // the next field tapped is an extra one ("+ add")
    const dirsOpen = new Set(); // fields whose directions are all shown on a phone ("+ კიდევ N" pressed)
    let errorOn = false;  // the min-1 error is shown (after a try to save, or when the last direction was taken away)

    const chosenFields = () => [pick.main, ...pick.extras].filter(Boolean);
    const fieldChip = (x) => {
      const on = adding ? pick.extras.includes(x.id) : x.id === pick.main;
      return `<button type="button" class="chip fp-field pick-field" data-field="${esc(x.id)}" aria-pressed="${on}"${adding && x.id === pick.main ? ' disabled' : ''}>`
        + `<span>${esc(nameIn(x))}</span>${isNew(x.id) ? `<span class="fp-new">${esc(t('fp.new'))}</span>` : ''}</button>`;
    };

    function fieldsCard() {
      const q = norm(query);
      const all = catalog.fields;
      const matches = q ? all.filter((x) => norm(`${x.ka} ${x.en}`).includes(q)) : all;
      // (collapsed: the chosen ones first, then the first few of the list, then, while they are new, some of the new fields, then the rest)
      const mineFirst = all.filter((x) => chosenFields().includes(x.id));
      const others = all.filter((x) => !chosenFields().includes(x.id));
      const fresh = others.filter((x) => isNew(x.id));
      const head = others.filter((x) => !isNew(x.id)).slice(0, Math.max(0, COLLAPSED - mineFirst.length - Math.min(3, fresh.length)));
      const ordered = q || open ? matches : [...mineFirst, ...head, ...fresh, ...others.filter((x) => !head.includes(x) && !fresh.includes(x))];
      const shown = q || open ? ordered : ordered.slice(0, COLLAPSED);
      const rest = matches.length - shown.length;
      return `<section class="fp-card fp-fields" aria-labelledby="fpMainTitle">
        <h3 id="fpMainTitle">${esc(t(adding ? 'fp.extra.choose' : 'fp.main.title'))}</h3>
        <p class="fp-hint">${esc(t(adding ? 'fp.extra.chooseHint' : 'fp.main.hint'))}</p>
        <div class="fp-search"><label for="fpSearch" class="sr-only">${esc(t('pick.search'))}</label>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="fpSearch" data-pick-search value="${esc(query)}" placeholder="${esc(t('pick.search'))}" autocomplete="off" enterkeyhint="search"></div>
        <div class="fp-chips pick-fields" role="group" aria-labelledby="fpMainTitle">${shown.map(fieldChip).join('')}
          ${rest > 0 ? `<button type="button" class="chip fp-more" data-fp-more>${esc(fill('fp.more', { n: rest }))}</button>` : ''}
          ${!q && open ? `<button type="button" class="chip fp-more" data-fp-less>${esc(t('fp.less'))}</button>` : ''}</div>
        ${matches.length ? '' : `<p class="fp-hint pick-none">${esc(t('pick.none'))}</p>`}
        <div class="fp-extra">
          <div class="fp-row"><h4>${esc(t('fp.extra.title'))}</h4><span class="fp-count">${pick.extras.length} / ${maxExtras}</span></div>
          <div class="fp-chips">${pick.extras.map((id) => `<button type="button" class="chip fp-extra-chip" data-remove-extra="${esc(id)}" aria-pressed="true" aria-label="${esc(fill('fp.extra.remove', { field: nameIn(fieldById(id)) }))}">${esc(nameIn(fieldById(id)))} <span aria-hidden="true">×</span></button>`).join('')}
            ${adding ? `<button type="button" class="chip fp-add" data-fp-adding aria-pressed="true">${esc(t('fp.extra.done'))}</button>`
              : (pick.main && pick.extras.length < maxExtras ? `<button type="button" class="chip fp-add" data-fp-adding aria-pressed="false">${esc(t('fp.extra.add'))}</button>` : '')}</div>
        </div>
      </section>`;
    }

    // (how many of a field's directions wait behind "+ კიდევ N" on a phone; chosen ones are always shown)
    const later = (id, chips) => (dirsOpen.has(id) ? 0 : chips.filter((c, i) => i >= DIRS_SHORT && !pick.directions.includes(c.id)).length);
    function directionsCard() {
      const n = pick.directions.length;
      const invalid = errorOn && pick.main && n < MIN;
      const groups = chosenFields().map((id) => {
        const f = fieldById(id);
        const chips = f.chips.filter((c) => !c.other && (!c.moved || pick.directions.includes(c.id)));
        const own = f.chips.find((c) => c.other);
        const ownOn = own && pick.directions.includes(own.id);
        return `<div class="fp-group pick-group">${chosenFields().length > 1 ? `<p class="fp-group-title">${esc(nameIn(f))}</p>` : ''}
          <div class="fp-chips pick-chips" role="group" aria-label="${esc(fill('pick.chips', { field: nameIn(f) }))}">
            ${chips.map((c, i) => `<button type="button" class="chip apply-chip fp-dir${!dirsOpen.has(id) && i >= DIRS_SHORT && !pick.directions.includes(c.id) ? ' fp-dir-later' : ''}" data-direction="${esc(c.id)}" aria-pressed="${pick.directions.includes(c.id)}">${esc(nameIn(c))}</button>`).join('')}
            ${later(id, chips) ? `<button type="button" class="chip fp-more fp-dirs-more" data-fp-dirs-more="${esc(id)}">${esc(fill('fp.more', { n: later(id, chips) }))}</button>` : ''}
            ${own ? `<button type="button" class="chip apply-chip fp-own" data-direction="${esc(own.id)}" aria-pressed="${ownOn}">${esc(t('fp.own'))}</button>` : ''}</div>
          ${ownOn ? `<input class="pick-other fp-other" type="text" maxlength="60" data-other="${esc(id)}" value="${esc(pick.other[id] || '')}" placeholder="${esc(t('pick.otherPlaceholder'))}" aria-label="${esc(t('pick.otherPlaceholder'))}">` : ''}
        </div>`;
      }).join('');
      return `<section class="fp-card fp-dirs${invalid ? ' is-invalid' : ''}" aria-labelledby="fpDirsTitle">
        <div class="fp-row"><h3 id="fpDirsTitle">${esc(t('fp.dirs.title'))}</h3><span class="fp-count pick-count" aria-live="polite">${n} / ${maxDirections}</span></div>
        <p class="fp-hint">${esc(t(pick.main ? 'fp.dirs.ask' : 'fp.dirs.first'))}</p>
        ${groups}
        <p class="fp-error" role="alert" id="fpDirsError"${invalid ? '' : ' hidden'}>${esc(t('fp.err.min'))}</p>
        ${pick.main ? `<p class="fp-tip">${esc(t('fp.dirs.hint'))}</p>` : ''}
      </section>`;
    }

    function draw() {
      const focused = document.activeElement && area.contains(document.activeElement) && document.activeElement.id === 'fpSearch';
      const caret = focused ? document.activeElement.selectionStart : null;
      area.innerHTML = `<div class="fp">${fieldsCard()}${directionsCard()}</div>`;
      if (focused) { const box = area.querySelector('#fpSearch'); box.focus(); try { box.setSelectionRange(caret, caret); } catch (e) { /* no caret */ } }
    }

    area.addEventListener('click', (ev) => {
      const target = ev.target.closest('button');
      if (!target || !area.contains(target)) return;
      if (target.matches('[data-fp-more]')) { open = true; draw(); return; }
      if (target.dataset.fpDirsMore) {
        const id = target.dataset.fpDirsMore;
        dirsOpen.add(id); draw();
        // (the keyboard goes on from the first direction that was behind the button)
        const next = area.querySelectorAll(`.fp-dir[data-direction^="${CSS.escape(id)}."]`)[DIRS_SHORT];
        if (next) next.focus();
        return;
      }
      if (target.matches('[data-fp-less]')) { open = false; draw(); return; }
      if (target.matches('[data-fp-adding]')) { adding = !adding; query = ''; open = adding; draw(); return; }
      if (target.dataset.removeExtra) {
        pick.extras = pick.extras.filter((x) => x !== target.dataset.removeExtra);
        pick.directions = pick.directions.filter((d) => chosenFields().includes(d.split('.')[0]));
        draw(); onChange('field'); return;
      }
      if (target.dataset.field) {
        const id = target.dataset.field;
        if (adding) {
          if (id === pick.main) return;
          if (pick.extras.includes(id)) pick.extras = pick.extras.filter((x) => x !== id);
          else if (pick.extras.length < maxExtras) pick.extras.push(id);
          else { onChange('too_many_fields'); return; }
          if (pick.extras.length >= maxExtras) adding = false;
        } else {
          if (id === pick.main) return;
          pick.extras = pick.extras.filter((x) => x !== id);
          pick.main = id;
        }
        query = '';
        open = adding; // (still adding: the whole list stays open)
        pick.directions = pick.directions.filter((d) => chosenFields().includes(d.split('.')[0]));
        if (pick.main && !pick.directions.length) errorOn = true; // (a field chosen by hand with none of its directions yet: say so at once)
        draw(); onChange('field'); return;
      }
      if (target.dataset.direction) {
        const id = target.dataset.direction;
        if (pick.directions.includes(id)) {
          pick.directions = pick.directions.filter((x) => x !== id);
          if (!pick.directions.length) errorOn = true; // (the last one taken away: say at once that one is needed)
        } else if (pick.directions.length < maxDirections) pick.directions.push(id);
        else { onChange('too_many_directions'); return; }
        draw(); onChange('direction');
      }
    });
    area.addEventListener('input', (ev) => {
      if (ev.target.matches('[data-pick-search]')) { query = ev.target.value; draw(); return; }
      if (ev.target.dataset.other) { pick.other[ev.target.dataset.other] = ev.target.value; onChange('other'); }
    });

    draw();
    return {
      draw,
      valid: () => pick.directions.length >= MIN && pick.directions.length <= maxDirections,
      showError(on) { errorOn = on; draw(); },
      MIN
    };
  }

  window.WisecallFieldPicker = { create, MIN, NEW_UNTIL, NEW_FIELDS };
})();
