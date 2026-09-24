(async function () {
  await SagelyI18n.initI18n();
  await SagelyNav.initNav();

  const grid = document.getElementById('expertGrid');
  const filters = document.getElementById('filters');
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');
  let allExperts = [];
  let activeNiche = 'all';
  let searchTerm = '';
  let sortMode = 'rating';

  function initials(name) {
    return name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  }

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

  function render() {
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

    if (list.length === 0) {
      grid.innerHTML = `<p class="muted">${SagelyI18n.t('experts.empty')}</p>`;
      return;
    }
    const perQ = SagelyI18n.t('expert.perQuestion');
    const askLabel = SagelyI18n.t('expert.ask');
    const reviewsLabel = SagelyI18n.t('expert.reviewsShort');
    grid.innerHTML = list.map(e => `
      <a class="expert-card" href="/expert.html?id=${e.id}">
        <div class="card-top">
          <div class="avatar" style="background:${e.color || '#6d4de0'}">${initials(e.name)}</div>
          <div>
            <div class="card-name">${escapeHtml(e.name)} ${(e.reviewCount || 0) < 3 ? `<span class="badge badge-paid">${SagelyI18n.t('expert.newMentor')}</span>` : ''}</div>
            <div class="card-role">${escapeHtml(e.roleTitle || '')}</div>
          </div>
        </div>
        <div class="card-bio">${escapeHtml(e.bio || '')}</div>
        <div class="card-bottom">
          <span class="rating">${e.ratingAvg ? `★ ${e.ratingAvg} (${e.reviewCount} ${reviewsLabel})` : SagelyI18n.t('expert.noReviewsYet')}</span>
          <span class="price">$${e.price}<span> ${perQ}</span></span>
        </div>
        <span class="btn btn-primary btn-sm btn-block">${askLabel}</span>
      </a>
    `).join('');
  }

  filters.addEventListener('click', ev => {
    const btn = ev.target.closest('.chip');
    if (!btn) return;
    filters.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    activeNiche = btn.dataset.niche;
    render();
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

  let lastStats = null;
  document.addEventListener('sagely:lang-changed', () => {
    render();
    if (lastStats) renderHeroStats(lastStats);
  });

  try {
    const data = await SagelyAPI.apiFetch('/experts');
    allExperts = data.experts;
    render();
  } catch (e) {
    grid.innerHTML = `<p class="muted">${SagelyI18n.t('experts.loadError')}</p>`;
  }

  try {
    lastStats = await SagelyAPI.apiFetch('/stats');
    renderHeroStats(lastStats);
  } catch (e) { /* stats are optional */ }

  function renderHeroStats(stats) {
    const el = document.getElementById('heroStats');
    if (!el) return;
    if (stats.mentorCount === 0) {
      el.innerHTML = `<div class="hero-cta-banner">${SagelyI18n.t('hero.beFirst')} <a href="/signup.html">${SagelyI18n.t('hero.become')}</a></div>`;
      return;
    }
    el.innerHTML = `
      <div class="hero-stats">
        <div><strong>${stats.mentorCount}</strong><span>${SagelyI18n.t('hero.stat.mentors')}</span></div>
        <div><strong>${stats.nicheCount}</strong><span>${SagelyI18n.t('hero.stat.niches')}</span></div>
        <div><strong>${stats.answeredCount}</strong><span>${SagelyI18n.t('hero.stat.answers')}</span></div>
      </div>
    `;
  }
})();
