// The home page: the expert list with search, sort and field filters, and what it shows when nobody
// is listed yet. (The other sections are static markup; see home.js for the strip, FAQ and waiting list.)
(async function () {
  await WisecallI18n.initI18n();
  const currentUser = await WisecallNav.initNav();
  // Logged-in visitors go straight to Settings; logged-out ones sign up first and land there afterwards.
  const becomeHref = currentUser ? '/settings.html' : '/signup.html?redirect=/settings.html';
  document.querySelectorAll('.become-link').forEach(a => { a.href = becomeHref; });
  WisecallHome.drawStrip();

  const grid = document.getElementById('expertGrid');
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

  // The chips (and the strip's links) choose a field; the address shows it (?niche=) so it can be shared.
  function setNiche(niche, opts) {
    activeNiche = WisecallHome.NICHES.includes(niche) ? niche : 'all';
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
    return `
      <div class="empty-state empty-rich">
        ${WisecallHome.emptyArt}
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
        <a class="btn btn-primary" href="${becomeHref}">${t('wait.mentorCta')}</a>
        <div class="empty-wait">${WisecallWaitlist.html(activeNiche === 'all' ? 'any' : activeNiche)}</div>
      </div>`;
  }

  // Before launch nobody can ask a question, so Browse shows the waiting list instead of the experts.
  const prelaunch = WisecallI18n.launchMode() === 'prelaunch';
  let prelaunchLang = null;
  function launchingSoon() {
    const field = activeNiche === 'all' ? 'any' : activeNiche;
    const form = grid.querySelector('.waitlist-form');
    // Choosing a field in the strip only changes the field; what the visitor has typed stays.
    if (form && prelaunchLang === WisecallI18n.getLang()) { form.niche.value = field; return; }
    prelaunchLang = WisecallI18n.getLang();
    grid.innerHTML = `
      <div class="empty-state empty-rich prelaunch-panel">
        ${WisecallHome.emptyArt}
        <h3>${escapeHtml(t('experts.prelaunch.panelTitle'))}</h3>
        <p>${escapeHtml(t('experts.prelaunch.body'))}</p>
        <div class="empty-wait">${WisecallWaitlist.html(field)}</div>
        <a class="btn btn-outline" href="${becomeHref}">${t('wait.mentorCta')}</a>
      </div>`;
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
    if (prelaunch) { launchingSoon(); return; }
    if (!loaded) { grid.innerHTML = `<p class="muted">${t('experts.loading')}</p>`; summary(); return; }
    let list = activeNiche === 'all' ? allExperts : allExperts.filter(e => e.niche === activeNiche);
    if (searchTerm) {
      const needle = searchTerm.toLowerCase();
      list = list.filter(e =>
        (e.name && e.name.toLowerCase().includes(needle)) ||
        (e.roleTitle && e.roleTitle.toLowerCase().includes(needle)) ||
        (e.bio && e.bio.toLowerCase().includes(needle))
      );
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
        grid.innerHTML = `<p class="muted">${t('experts.noMatch')}</p>`;
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
            <div class="card-role">${escapeHtml(e.roleTitle || '')}${e.niche ? ` · ${escapeHtml(t('niche.' + e.niche))}` : ''}</div>
          </div>
        </div>
        <div class="card-bio">${escapeHtml(e.bio || '')}</div>
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
    searchTimer = setTimeout(() => {
      searchTerm = searchInput.value.trim();
      render();
    }, 150);
  });

  sortSelect.addEventListener('change', () => {
    sortMode = sortSelect.value;
    render();
  });

  document.addEventListener('wisecall:lang-changed', render);

  setNiche(new URLSearchParams(window.location.search).get('niche') || 'all', { push: false });
  if (!prelaunch) {
    try {
      const data = await WisecallAPI.apiFetch('/experts');
      allExperts = data.experts;
      loaded = true;
      render();
    } catch (e) {
      grid.innerHTML = `<p class="muted">${t('experts.loadError')}</p>`;
    }
  }

  const legend = document.getElementById('badgeLegend');
  const drawLegend = () => { if (legend) legend.innerHTML = WisecallBadges.legend(); };
  drawLegend();
  document.addEventListener('wisecall:lang-changed', drawLegend);
})();
