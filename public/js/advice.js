// /advice/<niche>: a page per field, for people who search for advice in that field. The server fills in the English title,
// description and mentor list (for search engines and link previews); this script draws it in the visitor's language, with the
// mentors' badges and ratings, and the waiting-list form when nobody is listed yet.
(async function () {
  await WisecallI18n.initI18n();
  await WisecallNav.initNav();
  const t = WisecallI18n.t;
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = (document.querySelector('meta[name="wisecall-niche"]') || {}).content;
  const grid = document.getElementById('adviceGrid');
  let experts = null;

  const nicheOf = () => (WisecallI18n.niches().find((n) => n.key === key) || null);

  function card(e) {
    return `
      <a class="expert-card" href="/u/${encodeURIComponent(e.username)}">
        <div class="card-top">
          ${WisecallAPI.avatar(e)}
          <div>
            <div class="card-name">${esc(e.name)} ${(e.reviewCount || 0) < 3 ? `<span class="badge badge-paid">${t('expert.newMentor')}</span>` : ''}</div>
            <div class="card-role">${esc(e.roleTitle || '')}</div>
          </div>
        </div>
        <div class="card-bio">${esc(e.bio || '')}</div>
        ${WisecallBadges.row(e.badges)}
        <div class="card-bottom">
          <span class="rating">${e.ratingAvg ? `★ ${e.ratingAvg} (${e.reviewCount} ${t('expert.reviewsShort')})` : t('expert.noReviewsYet')}</span>
          <span class="price${e.price === 0 ? ' is-free' : ''}">${WisecallAPI.formatPrice(e.price)}${e.price === 0 ? '' : `<span> ${t('expert.perQuestion')}</span>`}</span>
        </div>
        <span class="btn btn-primary btn-sm btn-block">${t('expert.ask')}</span>
      </a>`;
  }

  function draw() {
    const n = nicheOf();
    if (!n) return;
    const name = WisecallI18n.nicheName(key);
    const fill = (k) => t(k).split('{niche}').join(name);
    document.getElementById('adviceCrumb').textContent = name;
    document.getElementById('adviceTitle').textContent = fill('adv.h1');
    document.getElementById('adviceIntro').textContent = fill('adv.intro');
    document.getElementById('adviceListTitle').textContent = fill('adv.listTitle');
    document.getElementById('adviceIcon').innerHTML = WisecallNicheIcons.svg(n.icon, 34);
    const reg = document.getElementById('adviceRegulated');
    reg.hidden = !n.regulated;
    reg.textContent = n.regulated ? fill('adv.regulated') : '';
    document.title = `${fill('adv.h1')} — Wisecall`;

    if (experts) {
      if (experts.length) grid.innerHTML = experts.map(card).join('');
      else {
        grid.innerHTML = `<div class="wl-card wl-card-plain"><div class="wl-intro"><div class="wl-text"><p class="wl-lead">${esc(fill(prelaunch ? 'adv.prelaunch' : 'adv.empty'))}</p></div></div><div class="wl-form">${WisecallWaitlist.html(key)}</div></div>`;
        WisecallWaitlist.wire(grid);
      }
    }

    const others = WisecallI18n.niches().filter((x) => x.key !== key);
    document.getElementById('adviceOther').innerHTML = others.map((x) => `
      <li><a class="niche-chip" href="/advice/${encodeURIComponent(x.key)}">${WisecallNicheIcons.svg(x.icon)}<span>${esc(WisecallI18n.nicheName(x.key))}</span></a></li>`).join('');
  }

  // Before launch nobody can be asked yet: the page offers the waiting list instead (like Browse experts).
  const prelaunch = WisecallI18n.launchMode() === 'prelaunch';
  if (prelaunch) experts = [];
  else {
    try {
      const data = await WisecallAPI.apiFetch(`/experts?niche=${encodeURIComponent(key)}`);
      experts = data.experts || [];
    } catch (e) { experts = null; } // (the list the server wrote into the page stays)
  }
  draw();
  document.addEventListener('wisecall:lang-changed', draw);
})();
