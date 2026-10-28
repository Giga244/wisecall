// The home page's "our mentors" (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 4): approved mentors who chose to be shown, with
// their photo, name, field, university or company and "Founding mentor"; the number of verified mentors once there are 5 or more.
(function () {
  const section = document.getElementById('homeMentors');
  if (!section) return;
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ka = () => WisecallI18n.getLang() === 'ka';
  WisecallAPI.apiFetch('/home-mentors').then((r) => {
    const list = (r && r.mentors) || [];
    if (!list.length) return;
    const prefix = ka() ? '/ka' : '';
    document.getElementById('homeMentorsList').innerHTML = list.map((m) => {
      const where = m.university ? (ka() ? m.university.ka : m.university.en) : m.organisation;
      return `<li><a class="home-mentor" href="${prefix}/u/${encodeURIComponent(m.username)}">
        ${WisecallAPI.avatar(m)}
        <span class="home-mentor-name">${esc(m.name)}</span>
        <span class="home-mentor-field muted small">${esc(WisecallI18n.fieldName(m))}</span>
        ${where ? `<span class="home-mentor-where small">${esc(where)}</span>` : ''}
        ${m.founding ? `<span class="chip-tag">${esc(t('badge.founding'))}</span>` : ''}
      </a></li>`;
    }).join('');
    const count = document.getElementById('homeMentorsCount');
    if (r.verifiedCount) { count.textContent = t('home.mentors.count').replace('{n}', r.verifiedCount); count.hidden = false; }
    section.hidden = false;
  }).catch(() => {});
})();
