// The home page's "Meet our experts" (docs/CLAUDE-CODE-NEW-HOME.md 2.3): up to three approved mentors who chose to be shown on the home page
// (/api/home-mentors: verified, opted in, not hidden), each with their photo or initials, full name, role, field, "verified", "First mentor"
// when they are one, the price and a link to the profile. The server sends the section open, with skeleton cards, when there is someone
// to show (server/pages.js); it is hidden again if the list comes back empty or does not load.
(function () {
  const section = document.getElementById('homeMentors');
  if (!section) return;
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ka = () => WisecallI18n.getLang() === 'ka';
  const SHOWN = 3;
  let list = [];
  function draw() {
    if (!list.length) { section.hidden = true; return; }
    const prefix = ka() ? '/ka' : '';
    const fieldOf = (m) => {
      const f = WisecallI18n.fields().find((x) => x.id === m.fieldId);
      return f ? { icon: f.icon, name: WisecallI18n.nameIn(f.short || f) } : { icon: '', name: WisecallI18n.fieldName(m) };
    };
    document.getElementById('homeMentorsList').innerHTML = list.slice(0, SHOWN).map((m) => {
      const f = fieldOf(m);
      const href = `${prefix}/u/${encodeURIComponent(m.username)}`;
      return `<li class="lexpert">
        ${WisecallAPI.avatar(m, { cls: 'lexpert-avatar', size: 56 })}
        <h3 class="lexpert-name"><a href="${href}">${esc(m.name)}</a></h3>
        ${m.roleTitle ? `<p class="lexpert-role">${esc(m.roleTitle)}</p>` : ''}
        ${m.bio ? `<div class="lexpert-about"><p class="lexpert-bio" data-clamp>${esc(m.bio)}</p><a class="lmore lexpert-more" href="${href}" data-clamp-more hidden>${esc(t('experts.card.more'))}</a></div>` : ''}
        <p class="lexpert-tags">${f.name ? `<span class="chip-tag">${f.icon ? `<span aria-hidden="true">${f.icon}</span> ` : ''}${esc(f.name)}</span>` : ''}${m.founding ? `<span class="chip-tag">${esc(t('badge.founding'))}</span>` : ''}</p>
        <p class="lexpert-verified">✓ ${esc(t('home2.qa.verified'))}</p>
        <p class="lexpert-foot"><strong>${esc(WisecallAPI.formatPrice(m.price))}</strong><a class="lmore" href="${href}" aria-label="${esc(t('home2.experts.profileOf').replace('{name}', m.name))}">${esc(t('home2.experts.profile'))}</a></p>
      </li>`;
    }).join('');
    document.getElementById('homeMentorsList').removeAttribute('aria-busy');
    if (window.WisecallClamp) WisecallClamp.watch(section);
    section.hidden = false;
  }
  WisecallAPI.apiFetch('/home-mentors').then((r) => {
    list = ((r && r.mentors) || []).filter((m) => m.username);
    WisecallI18n.ready.then(draw);
  }).catch(() => { section.hidden = true; });
  document.addEventListener('wisecall:lang-changed', draw);
})();
