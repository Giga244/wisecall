// Browse experts (/experts.html, docs/CLAUDE-CODE-NEW-HOME.md): the expert list with search, sort and field filters, and what it shows when
// nobody is listed yet. Open to everybody, signed in or not, before launch too (asking is what waits for the launch, on the profile).
// (The field tiles are drawn by home.js; the waiting-list form, for a field with nobody yet, by waitlist.js.)
(async function () {
  await WisecallI18n.initI18n();
  await WisecallNav.initNav();
  // "Apply as a mentor" opens the mentors' page (what they get, how to apply; its button signs up or opens Settings).
  const becomeHref = '/become-a-mentor.html';
  WisecallHome.drawStrip();

  const grid = document.getElementById('expertGrid');
  const loadingHtml = grid.innerHTML; // (the skeleton the page arrives with: shown again whenever the list is not there yet)
  const filters = document.getElementById('filters');
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');
  const t = WisecallI18n.t;
  const filtersBtn = document.getElementById('filtersBtn');
  const filtersCount = document.getElementById('filtersCount');
  const resultCount = document.getElementById('resultCount');
  const filtersApply = document.getElementById('filtersApply');
  let allExperts = [];
  let activeField = 'all';
  let activeChip = null;
  const startParams = new URLSearchParams(window.location.search);
  let paidOnly = startParams.get('paid') === '1';
  let activeCountry = startParams.get('country') || '';
  let activeYears = startParams.get('years') || '';
  // "Where they started": a starting-point tag mentors set themselves (docs/CLAUDE-CODE-MENTOR-STORY.md), so a student finds one who started like them.
  // (several can be chosen: a mentor with any of them is shown)
  const activeStarts = new Set((startParams.get('start') || '').split(',').filter(Boolean));
  // (the tags are drawn at once, before the list and the catalog arrive, so the cards below do not move when they do: the server's list is
  // server/mentorStory.js START_TAGS, and tests/mentor-story.test.js keeps the two the same)
  const START_IDS = ['region', 'grant', 'worked', 'selftaught', 'switched', 'abroad', 'firstgen'];
  let searchTerm = '';
  // Mentors the server found for the search (it also matches their specialty tags, which are not sent to the page): ids, or null.
  let serverMatches = null;
  // "Recommended" is the list's own order; "Top rated" is offered only once a mentor has a real rating (never a sort by ratings nobody gave).
  let sortMode = 'recommended';
  const anyRatings = () => allExperts.some((e) => (e.reviewCount || 0) > 0 && e.ratingAvg);
  function syncSort() {
    const opt = sortSelect.querySelector('option[value="rating"]');
    if (opt) { opt.hidden = !anyRatings(); opt.disabled = !anyRatings(); }
    if (sortMode === 'rating' && !anyRatings()) sortMode = 'recommended';
    sortSelect.value = sortMode;
  }
  // "Free": only mentors who answer for free (?free=1), on top of the field.
  let freeOnly = new URLSearchParams(window.location.search).get('free') === '1';

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function sortList(list) {
    const sorted = [...list];
    if (sortMode === 'priceAsc') sorted.sort((a, b) => a.price - b.price);
    else if (sortMode === 'priceDesc') sorted.sort((a, b) => b.price - a.price);
    else if (sortMode === 'newest') sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sortMode === 'rating') sorted.sort((a, b) => (b.ratingAvg || 0) - (a.ratingAvg || 0) || (b.reviewCount || 0) - (a.reviewCount || 0));
    else {
      // Recommended: real ratings first (when there are any), then the profiles that tell a student more (their path, a sample answer),
      // then the newest. Nothing here is a number the site made up.
      const told = (e) => (e.trust ? (e.trust.hasPath ? 1 : 0) + (e.trust.hasSample ? 1 : 0) : 0);
      sorted.sort((a, b) => (b.ratingAvg || 0) - (a.ratingAvg || 0) || (b.reviewCount || 0) - (a.reviewCount || 0) || told(b) - told(a) || new Date(b.createdAt) - new Date(a.createdAt));
    }
    return sorted;
  }

  // ---- The fields, their chips, and the filters -----------------------------------------------------------------------------------------
  // A mentor is in their main field and their (up to two) extra ones; one whose old category could not be mapped is under "Other", and search finds them too.
  let catalog = null; // /api/categories: the names of the chips and the lists for the filters
  const fieldChips = document.getElementById('fieldChips');
  const searchChips = document.getElementById('searchChips');
  const fieldsOf = (e) => [e.fieldId, ...(e.extraFields || [])].filter(Boolean);
  const inField = (e, id) => (id === 'other' ? !e.fieldId : fieldsOf(e).includes(id));
  const inChip = (e, id) => (e.directions || []).includes(id);
  const nameIn = WisecallI18n.nameIn;
  const chipById = (id) => { for (const f of (catalog ? catalog.fields : [])) { const c = f.chips.find((x) => x.id === id); if (c) return c; } return null; };
  const knownField = (id) => id === 'other' || WisecallI18n.fields().some((f) => f.id === id);
  // What the list shows apart from the field and the chip: free or paid, a country, the years of experience.
  const passesFilters = (e) => (!freeOnly || e.price === 0) && (!paidOnly || e.price > 0) && (!activeCountry || e.country === activeCountry) && (!activeYears || e.yearsBand === activeYears)
    && (!activeStarts.size || Boolean(e.trust && e.trust.startTags.some((id) => activeStarts.has(id))));
  // What the search box asks for (the list and the field chips' counts both use it).
  const matchesSearch = (e) => {
    if (!searchTerm) return true;
    const needle = searchTerm.toLowerCase();
    const has = (s) => Boolean(s) && String(s).toLowerCase().includes(needle);
    return has(e.name) || has(e.roleTitle) || has(e.bio) || has(e.customNiche)
      || [e.niche, ...(e.extraNiches || [])].some((k) => k && has(t('niche.' + k))) || Boolean(serverMatches && serverMatches.has(e.id));
  };

  function drawChips() {
    const options = (list, chosen, none) => `<option value="">${escapeHtml(none)}</option>${list.map((x) => `<option value="${escapeHtml(x.id)}"${x.id === chosen ? ' selected' : ''}>${escapeHtml(nameIn(x))}</option>`).join('')}`;
    // Each group with its own label (in the sheet on a phone they are stacked, full width; on a computer they are one row).
    filters.innerHTML = `
      <div class="filter-group filter-price" role="group" aria-labelledby="filterPriceLabel">
        <p class="filter-label" id="filterPriceLabel">${escapeHtml(t('browse.filter.price'))}</p>
        <div class="filter-chips">
          <button type="button" class="chip chip-free${freeOnly ? ' active' : ''}" data-free aria-pressed="${freeOnly}">${escapeHtml(t('experts.filter.free'))}</button>
          <button type="button" class="chip${paidOnly ? ' active' : ''}" data-paid aria-pressed="${paidOnly}">${escapeHtml(t('browse.filter.paid'))}</button>
        </div>
      </div>
      <div class="filter-group filter-select">
        <label class="filter-label" for="filterCountry">${escapeHtml(t('browse.filter.country'))}</label>
        <select id="filterCountry" data-filter="country">${options(catalog ? catalog.countries : [], activeCountry, t('browse.filter.country'))}</select>
      </div>
      <div class="filter-group filter-select">
        <label class="filter-label" for="filterYears">${escapeHtml(t('browse.filter.years'))}</label>
        <select id="filterYears" data-filter="years">${options(catalog ? catalog.years : [], activeYears, t('browse.filter.years'))}</select>
      </div>
      <div class="filter-group filter-start" role="group" aria-labelledby="filterStartLabel">
        <p class="filter-label" id="filterStartLabel">${escapeHtml(t('browse.filter.start'))}</p>
        <div class="filter-chips">
          ${(catalog && catalog.startTags ? catalog.startTags : START_IDS.map((id) => ({ id }))).map((x) => `<button type="button" class="chip chip-start${activeStarts.has(x.id) ? ' active' : ''}" data-start="${escapeHtml(x.id)}" aria-pressed="${activeStarts.has(x.id)}">${escapeHtml(t('start.' + x.id))}</button>`).join('')}
        </div>
      </div>`;
    const count = (test) => allExperts.filter((e) => matchesSearch(e) && test(e)).length;
    const button = (attrs, label, n, on) => `<button type="button" class="chip${on ? ' active' : ''}" ${attrs} aria-pressed="${Boolean(on)}">${label}${n === null ? '' : ` <span class="chip-count">${n}</span>`}</button>`;
    if (activeField === 'all') {
      // The 16 fields: one with nobody yet says "soon".
      // ("soon": nobody in the field at all, whatever is typed in the search)
      const list = WisecallI18n.fields().map((f) => { const n = count((e) => inField(e, f.id)); const any = allExperts.some((e) => inField(e, f.id)); return button(`data-field="${escapeHtml(f.id)}"`, `<span aria-hidden="true">${f.icon}</span> ${escapeHtml(nameIn(f))}`, any ? n : null, false) .replace('</button>', any ? '</button>' : ` <span class="chip-soon">${escapeHtml(t('browse.soon'))}</span></button>`); });
      if (allExperts.some((e) => !e.fieldId)) list.push(button('data-field="other"', escapeHtml(t('niche.other')), count((e) => !e.fieldId), false));
      fieldChips.innerHTML = list.join('');
    } else {
      // The chosen field, and its chips that have somebody (a chip with nobody is not shown).
      const f = catalog && catalog.fields.find((x) => x.id === activeField);
      const chips = f ? f.chips.map((c) => ({ c, n: count((e) => inChip(e, c.id)) })).filter((x) => x.n) : [];
      const name = activeField === 'other' ? t('niche.other') : nameIn(WisecallI18n.fields().find((x) => x.id === activeField));
      fieldChips.innerHTML = [button('data-field="all"', `← ${escapeHtml(t('browse.allFields'))}`, null, false), button(`data-field="${escapeHtml(activeField)}"`, escapeHtml(name), null, !activeChip),
        ...chips.map(({ c, n }) => button(`data-chip="${escapeHtml(c.id)}"`, escapeHtml(nameIn(c)), n, c.id === activeChip))].join('');
    }
  }

  // The fields and chips choose what is listed; the address shows it (?field=, ?chip=) so it can be shared. (?niche= from older links means its field.)
  function setField(field, chip, opts) {
    activeField = knownField(field) ? field : 'all';
    activeChip = chip && activeField !== 'all' ? chip : null;
    drawChips();
    // ("Help me choose" starts from the field the student is looking at)
    const matchLink = document.getElementById('browseMatchLink');
    if (matchLink) {
      const to = '/match' + (activeField !== 'all' && activeField !== 'other' ? `?f=${encodeURIComponent(activeField)}` : '');
      matchLink.setAttribute('href', WisecallI18n.getLang() === 'ka' ? WisecallI18n.kaHref(to) : to);
    }
    if (!opts || opts.push !== false) {
      const url = new URL(window.location.href);
      url.searchParams.delete('niche');
      const put = (k, v) => { if (v) url.searchParams.set(k, v); else url.searchParams.delete(k); };
      put('field', activeField === 'all' ? null : activeField);
      put('chip', activeChip);
      put('free', freeOnly ? '1' : null);
      put('paid', paidOnly ? '1' : null);
      put('country', activeCountry);
      put('years', activeYears);
      put('start', [...activeStarts].join(','));
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    render();
  }

  // Shown when there is nobody to list: a picture, what to do, a way to be told later, and an invitation to mentors.
  function emptyState(kind) {
    const f = WisecallI18n.fields().find((x) => x.id === activeField);
    if (kind !== 'all' && f) {
      // A field with nobody yet: "soon", and the one button that puts an email on this field's list.
      return waitCard(`<p class="field-soon"><span class="chip-soon">${escapeHtml(t('browse.soon'))}</span></p><h3 class="wl-title">${escapeHtml(nameIn(f))}</h3><p class="wl-sub">${escapeHtml(t('browse.soon.body'))}</p>`, f.id, '', t('browse.notify'));
    }
    const title = kind === 'all' ? t('experts.emptyAll.title') : t('experts.emptyNiche.title').replace('{field}', t('niche.other'));
    const body = kind === 'all' ? t('experts.emptyAll.body') : t('experts.emptyNiche.body');
    return waitCard(`<h3 class="wl-title">${escapeHtml(title)}</h3><p class="wl-sub">${escapeHtml(body)}</p>`, 'any');
  }

  // One card: the illustration and a short text (on the left from a tablet up), the waiting-list form (on the right), and under the card
  // a plain link for mentors. Used before launch ("Wisecall opens soon") and after it when nobody is listed (in a field).
  function waitCard(text, field, extraClass = '', submit) {
    return `
      <div class="wl-card${extraClass}">
        <div class="wl-intro">${WisecallHome.emptyArt}<div class="wl-text">${text}</div></div>
        <div class="wl-form">${WisecallWaitlist.html(field, submit ? { submit } : {})}</div>
      </div>
      <p class="wl-mentor"><a class="arrow-link" href="${becomeHref}">${t('wait.mentorCta')}</a></p>`;
  }


  // "8 experts" under the search, the number of filters in use on the Filters button, and the sheet's own button.
  let shown = 0;
  function summary() {
    const active = (sortMode !== 'recommended' ? 1 : 0) + (freeOnly ? 1 : 0) + (paidOnly ? 1 : 0) + (activeCountry ? 1 : 0) + (activeYears ? 1 : 0) + activeStarts.size;
    filtersCount.hidden = active === 0;
    filtersCount.textContent = String(active);
    filtersBtn.setAttribute('aria-label', active ? `${t('experts.filters')} (${active})` : t('experts.filters'));
    resultCount.textContent = loaded ? t(shown === 1 ? 'experts.count.one' : 'experts.count').replace('{n}', shown) : '';
    filtersApply.textContent = t(shown === 1 ? 'experts.showResults.one' : 'experts.showResults').replace('{n}', shown);
  }

  let loaded = false;
  function render() {
    grid.setAttribute('aria-busy', String(!loaded));
    if (!loaded) { grid.innerHTML = loadingHtml; summary(); return; }
    let list = activeField === 'all' ? allExperts : allExperts.filter((e) => inField(e, activeField));
    if (activeChip) list = list.filter((e) => inChip(e, activeChip));
    list = list.filter(passesFilters);
    list = list.filter(matchesSearch);
    list = sortList(list);
    shown = list.length;
    summary();

    if (allExperts.length === 0) {
      grid.innerHTML = emptyState('all');
      WisecallWaitlist.wire(grid);
      return;
    }
    if (list.length === 0) {
      const here = activeField === 'all' ? allExperts : allExperts.filter((e) => inField(e, activeField));
      if (here.length) {
        // (somebody is in this field: it is the search or the filters that found nobody)
        grid.innerHTML = `<p class="muted">${t('experts.noMatch')}</p>
          ${searchTerm ? `<p><a class="btn btn-outline btn-sm" href="/find-a-mentor.html?field=${encodeURIComponent(searchTerm)}">${t('rq.cta')}</a></p>` : ''}`;
      } else {
        grid.innerHTML = emptyState('niche');
        WisecallWaitlist.wire(grid);
      }
      return;
    }
    // (the card itself: public/js/expert-card.js, the same one the card previews show)
    grid.innerHTML = list.map((e) => WisecallExpertCard.html(e, {
      href: `/u/${encodeURIComponent(e.username)}${activeChip && inChip(e, activeChip) ? `?chip=${encodeURIComponent(activeChip)}` : ''}`,
      directions: (e.directions || []).slice(0, 3).map(chipById).filter((c) => c && !c.other).map((c) => nameIn(c))
    })).join('');
  }

  filters.addEventListener('click', ev => {
    const btn = ev.target.closest('.chip');
    if (btn && btn.hasAttribute('data-free')) { freeOnly = !freeOnly; if (freeOnly) paidOnly = false; setField(activeField, activeChip); return; }
    if (btn && btn.hasAttribute('data-paid')) { paidOnly = !paidOnly; if (paidOnly) freeOnly = false; setField(activeField, activeChip); return; }
    if (btn && btn.dataset.start) { if (activeStarts.has(btn.dataset.start)) activeStarts.delete(btn.dataset.start); else activeStarts.add(btn.dataset.start); setField(activeField, activeChip); }
  });
  filters.addEventListener('change', (ev) => {
    if (ev.target.dataset.filter === 'country') activeCountry = ev.target.value;
    if (ev.target.dataset.filter === 'years') activeYears = ev.target.value;
    setField(activeField, activeChip);
  });
  const chipsClick = (ev) => {
    const btn = ev.target.closest('.chip');
    if (!btn) return;
    if (btn.dataset.chip) {
      // (from the search's chips: the chip is what is shown now, without the words that led to it)
      if (btn.closest('#searchChips')) { searchInput.value = ''; searchTerm = ''; serverMatches = null; searchChips.hidden = true; }
      setField(btn.dataset.fieldOf || activeField, btn.dataset.chip);
    } else if (btn.dataset.field) setField(btn.dataset.field, null);
  };
  fieldChips.addEventListener('click', chipsClick);
  searchChips.addEventListener('click', chipsClick);
  // What the words name, as chips to open (only those with somebody in them).
  function drawSearchChips(found) {
    const list = found ? [...found.chips.filter((c) => c.count).map((c) => `<button type="button" class="chip" data-chip="${escapeHtml(c.id)}" data-field-of="${escapeHtml(c.field)}">${escapeHtml(nameIn(c))} <span class="chip-count">${c.count}</span></button>`),
      ...found.fields.filter((f) => f.count).map((f) => `<button type="button" class="chip" data-field="${escapeHtml(f.id)}">${escapeHtml(nameIn(f))} <span class="chip-count">${f.count}</span></button>`)] : [];
    searchChips.hidden = !list.length;
    searchChips.innerHTML = list.join('');
  }

  // The field tiles: choose the field without reloading the page, then scroll to the list.
  document.addEventListener('click', ev => {
    const link = ev.target.closest('[data-field-link]');
    if (!link || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
    ev.preventDefault();
    setField(link.dataset.fieldLink, null);
    document.getElementById('experts').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });

  // Phones: the sort and field controls live in a bottom sheet behind a Filters button. From 640px they sit on the page.
  const sheet = WisecallSheet.create(document.getElementById('filtersSheet'));
  const phone = window.matchMedia('(max-width: 639px)');
  function placeControls() {
    if (phone.matches) {
      document.getElementById('sheetSort').appendChild(sortSelect);
      document.getElementById('sheetFilters').appendChild(filters);
    } else {
      document.getElementById('sortSlot').appendChild(sortSelect);
      document.getElementById('filtersSlot').appendChild(filters);
      sheet.close(false);
    }
  }
  phone.addEventListener('change', placeControls);
  placeControls();
  filtersBtn.addEventListener('click', () => sheet.open(filtersBtn));
  document.getElementById('filtersClear').addEventListener('click', () => {
    sortMode = 'recommended';
    sortSelect.value = 'recommended';
    freeOnly = false;
    paidOnly = false;
    activeCountry = '';
    activeYears = '';
    activeStarts.clear();
    setField(activeField, activeChip);
  });

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      searchTerm = searchInput.value.trim();
      serverMatches = null;
      drawChips();
      render();
      if (!searchTerm) drawSearchChips(null);
      if (!searchTerm) return;
      const asked = searchTerm;
      try {
        const [data, found] = await Promise.all([WisecallAPI.apiFetch('/experts?q=' + encodeURIComponent(asked)), WisecallAPI.apiFetch('/categories/search?q=' + encodeURIComponent(asked))]);
        if (asked !== searchTerm) return; // (the visitor typed on meanwhile)
        serverMatches = new Set(data.experts.map((e) => e.id));
        drawSearchChips(found);
        drawChips();
        render();
      } catch (e) { /* the page's own matching still works */ }
    }, 150);
  });

  sortSelect.addEventListener('change', () => {
    sortMode = sortSelect.value;
    render();
  });

  document.addEventListener('wisecall:lang-changed', () => { setField(activeField, activeChip, { push: false }); });

  const oldLink = startParams.get('niche');
  setField(startParams.get('field') || (oldLink === 'other' ? 'other' : WisecallI18n.fieldOfNiche(oldLink)) || 'all', startParams.get('chip'), { push: false });
  try {
    const [data, list] = await Promise.all([WisecallAPI.apiFetch('/experts'), WisecallAPI.apiFetch('/categories')]);
    allExperts = data.experts;
    catalog = list;
    loaded = true;
    syncSort();
    setField(activeField, activeChip, { push: false }); // (the chips now know which fields have mentors)
  } catch (e) {
    grid.setAttribute('aria-busy', 'false');
    grid.innerHTML = `<p class="muted">${t('experts.loadError')}</p>`;
  }
  // The home page's search sends its words here (?q=): they go into the search box, as if typed.
  const asked = (startParams.get('q') || '').trim().slice(0, 200);
  if (asked) { searchInput.value = asked; searchInput.dispatchEvent(new Event('input', { bubbles: true })); }
})();
