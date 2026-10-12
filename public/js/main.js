// The home page: the expert list with search, sort and field filters, and what it shows when nobody
// is listed yet. (The other sections are static markup; see home.js for the strip, FAQ and waiting list.)
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
  let activeNiche = 'all';
  let searchTerm = '';
  // Mentors the server found for the search (it also matches their specialty tags, which are not sent to the page): ids, or null.
  let serverMatches = null;
  let sortMode = 'rating';

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function sortList(list) {
    const sorted = [...list];
    if (sortMode === 'priceAsc') sorted.sort((a, b) => a.price - b.price);
    else if (sortMode === 'priceDesc') sorted.sort((a, b) => b.price - a.price);
    else if (sortMode === 'newest') sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else sorted.sort((a, b) => (b.ratingAvg || 0) - (a.ratingAvg || 0) || (b.reviewCount || 0) - (a.reviewCount || 0));
    return sorted;
  }

  // The chips: "All", and every field somebody listed works in (plus the chosen one, even when nobody is there yet).
  const knownNiche = (key) => key === 'other' || WisecallI18n.niches().some((n) => n.key === key);
  function drawChips() {
    const used = new Set(allExperts.map((e) => e.niche));
    const keys = WisecallI18n.niches().map((n) => n.key).concat('other').filter((k) => used.has(k) || k === activeNiche);
    filters.innerHTML = [`<button type="button" class="chip" data-niche="all">${escapeHtml(t('niche.all'))}</button>`,
      ...keys.map((k) => `<button type="button" class="chip" data-niche="${escapeHtml(k)}">${escapeHtml(t('niche.' + k))}</button>`)].join('');
  }

  // The chips (and the strip's links) choose a field; the address shows it (?niche=) so it can be shared.
  function setNiche(niche, opts) {
    activeNiche = knownNiche(niche) ? niche : 'all';
    drawChips();
    filters.querySelectorAll('.chip').forEach(c => {
      const on = c.dataset.niche === activeNiche;
      c.classList.toggle('active', on);
      c.setAttribute('aria-pressed', String(on));
    });
    if (!opts || opts.push !== false) {
      const url = new URL(window.location.href);
      if (activeNiche === 'all') url.searchParams.delete('niche'); else url.searchParams.set('niche', activeNiche);
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    render();
  }

  // Shown when there is nobody to list: a picture, what to do, a way to be told later, and an invitation to mentors.
  function emptyState(kind) {
    const field = activeNiche === 'all' ? null : t('niche.' + activeNiche);
    const title = kind === 'all' ? t('experts.emptyAll.title') : t('experts.emptyNiche.title').replace('{field}', field);
    const body = kind === 'all' ? t('experts.emptyAll.body') : t('experts.emptyNiche.body');
    return waitCard(`<h3 class="wl-title">${escapeHtml(title)}</h3><p class="wl-sub">${escapeHtml(body)}</p>`, activeNiche === 'all' ? 'any' : activeNiche);
  }

  // One card: the illustration and a short text (on the left from a tablet up), the waiting-list form (on the right), and under the card
  // a plain link for mentors. Used before launch ("Wisecall opens soon") and after it when nobody is listed (in a field).
  function waitCard(text, field, extraClass = '') {
    return `
      <div class="wl-card${extraClass}">
        <div class="wl-intro">${WisecallHome.emptyArt}<div class="wl-text">${text}</div></div>
        <div class="wl-form">${WisecallWaitlist.html(field)}</div>
      </div>
      <p class="wl-mentor"><a class="arrow-link" href="${becomeHref}">${t('wait.mentorCta')}</a></p>`;
  }

  // Before launch nobody can ask a question, so Browse shows the waiting list instead of the experts.
  const prelaunch = WisecallI18n.launchMode() === 'prelaunch';
  let prelaunchLang = null;
  function launchingSoon() {
    const field = activeNiche === 'all' ? 'any' : activeNiche;
    const form = grid.querySelector('.waitlist-form');
    // Choosing a field in the tiles only changes the field; what the visitor has typed (or the "you're on the list" note) stays.
    if (prelaunchLang === WisecallI18n.getLang() && (form || grid.querySelector('.waitlist-done'))) { if (form) form.niche.value = field; return; }
    prelaunchLang = WisecallI18n.getLang();
    // (one title: the section's "Wisecall opens soon"; in the card a short line, and from a tablet up one more sentence)
    grid.innerHTML = waitCard(`<p class="wl-lead">${escapeHtml(t('experts.prelaunch.panelTitle'))}</p><p class="wl-sub">${escapeHtml(t('experts.prelaunch.body'))}</p>`, field, ' prelaunch-panel');
    WisecallWaitlist.wire(grid);
  }

  // "8 experts" under the search, the number of filters in use on the Filters button, and the sheet's own button.
  let shown = 0;
  function summary() {
    const active = (activeNiche !== 'all' ? 1 : 0) + (sortMode !== 'rating' ? 1 : 0);
    filtersCount.hidden = active === 0;
    filtersCount.textContent = String(active);
    filtersBtn.setAttribute('aria-label', active ? `${t('experts.filters')} (${active})` : t('experts.filters'));
    resultCount.textContent = loaded ? t(shown === 1 ? 'experts.count.one' : 'experts.count').replace('{n}', shown) : '';
    filtersApply.textContent = t(shown === 1 ? 'experts.showResults.one' : 'experts.showResults').replace('{n}', shown);
  }

  let loaded = false;
  function render() {
    grid.setAttribute('aria-busy', String(!prelaunch && !loaded));
    if (prelaunch) { launchingSoon(); return; }
    if (!loaded) { grid.innerHTML = loadingHtml; summary(); return; }
    let list = activeNiche === 'all' ? allExperts : allExperts.filter(e => e.niche === activeNiche);
    if (searchTerm) {
      const needle = searchTerm.toLowerCase();
      const has = (s) => Boolean(s) && String(s).toLowerCase().includes(needle);
      list = list.filter(e => has(e.name) || has(e.roleTitle) || has(e.bio) || has(e.customNiche)
        || (e.niche && has(t('niche.' + e.niche))) || Boolean(serverMatches && serverMatches.has(e.id)));
    }
    list = sortList(list);
    shown = list.length;
    summary();

    if (allExperts.length === 0) {
      grid.innerHTML = emptyState('all');
      WisecallWaitlist.wire(grid);
      return;
    }
    if (list.length === 0) {
      const inField = activeNiche === 'all' ? allExperts : allExperts.filter(e => e.niche === activeNiche);
      if (searchTerm && inField.length) {
        grid.innerHTML = `<p class="muted">${t('experts.noMatch')}</p>
          <p><a class="btn btn-outline btn-sm" href="/find-a-mentor.html?field=${encodeURIComponent(searchTerm)}${activeNiche !== 'all' ? '&niche=' + encodeURIComponent(activeNiche) : ''}">${t('rq.cta')}</a></p>`;
      } else {
        grid.innerHTML = emptyState('niche');
        WisecallWaitlist.wire(grid);
      }
      return;
    }
    const perQ = t('expert.perQuestion');
    const askLabel = t('expert.ask');
    const reviewsLabel = t('expert.reviewsShort');
    grid.innerHTML = list.map(e => `
      <a class="expert-card" href="/u/${encodeURIComponent(e.username)}">
        <div class="card-top">
          ${WisecallAPI.avatar(e)}
          <div>
            <div class="card-name">${escapeHtml(e.name)} ${(e.reviewCount || 0) < 3 ? `<span class="badge badge-paid">${t('expert.newMentor')}</span>` : ''}</div>
            <div class="card-role">${escapeHtml(e.roleTitle || '')}${e.niche ? ` · ${escapeHtml(WisecallI18n.fieldName(e))}` : ''}</div>
            ${e.profile && (e.profile.currentPosition || e.profile.yearsOfExperience) ? `<div class="card-role small">${e.profile.currentPosition ? escapeHtml(t('experts.card.at').replace('{title}', e.profile.currentPosition.title).replace('{organisation}', e.profile.currentPosition.organisation)) : ''}${e.profile.currentPosition && e.profile.yearsOfExperience ? ' · ' : ''}${e.profile.yearsOfExperience ? escapeHtml(t('experts.card.years').replace('{n}', e.profile.yearsOfExperience)) : ''}</div>` : ''}
          </div>
        </div>
        ${e.profile && e.profile.headline ? `<div class="card-headline">${escapeHtml(e.profile.headline)}</div>` : ''}
        <div class="card-bio">${escapeHtml(e.bio || '')}</div>
        ${e.profile && (e.profile.topSkills || []).length ? `<div class="card-skills">${e.profile.topSkills.map((k) => `<span class="tag">${escapeHtml(k)}</span>`).join(' ')}</div>` : ''}
        ${WisecallBadges.row(e.badges)}
        <div class="card-bottom">
          <span class="rating">${e.ratingAvg ? `★ ${e.ratingAvg} (${e.reviewCount} ${reviewsLabel})` : t('expert.noReviewsYet')}</span>
          <span class="price">${WisecallAPI.formatPrice(e.price)}<span> ${perQ}</span></span>
        </div>
        <span class="btn btn-primary btn-sm btn-block">${askLabel}</span>
      </a>
    `).join('');
  }

  filters.addEventListener('click', ev => {
    const btn = ev.target.closest('.chip');
    if (btn) setNiche(btn.dataset.niche);
  });

  // The strip under the hero: choose the field without reloading the page, then scroll to the list.
  document.addEventListener('click', ev => {
    const link = ev.target.closest('[data-niche-link]');
    if (!link || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
    ev.preventDefault();
    setNiche(link.dataset.nicheLink);
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
    sortMode = 'rating';
    sortSelect.value = 'rating';
    setNiche('all');
  });

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      searchTerm = searchInput.value.trim();
      serverMatches = null;
      render();
      if (!searchTerm || prelaunch) return;
      const asked = searchTerm;
      try {
        const data = await WisecallAPI.apiFetch('/experts?q=' + encodeURIComponent(asked));
        if (asked !== searchTerm) return; // (the visitor typed on meanwhile)
        serverMatches = new Set(data.experts.map((e) => e.id));
        render();
      } catch (e) { /* the page's own matching still works */ }
    }, 150);
  });

  sortSelect.addEventListener('change', () => {
    sortMode = sortSelect.value;
    render();
  });

  document.addEventListener('wisecall:lang-changed', () => { setNiche(activeNiche, { push: false }); });

  setNiche(new URLSearchParams(window.location.search).get('niche') || 'all', { push: false });
  if (!prelaunch) {
    try {
      const data = await WisecallAPI.apiFetch('/experts');
      allExperts = data.experts;
      loaded = true;
      setNiche(activeNiche, { push: false }); // (the chips now know which fields have mentors)
    } catch (e) {
      grid.setAttribute('aria-busy', 'false');
      grid.innerHTML = `<p class="muted">${t('experts.loadError')}</p>`;
    }
  }
})();
