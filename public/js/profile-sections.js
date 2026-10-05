// The optional profile sections on /u/<username> (drawn by profile.js): Experience grouped by organisation with the time there, Education,
// Licences, Projects, Journey (a vertical timeline), Skills, Languages, Links — only sections that have content and that the server let
// this viewer see. Everything is self-reported unless it carries the "Verified" mark an admin gave it.
window.WisecallProfileView = (function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const monthName = (m) => WisecallI18n.formatDate(new Date(Date.UTC(2020, m - 1, 15)), { month: 'short' });
  const dateText = (d) => (d ? (d.month ? `${monthName(d.month)} ${d.year}` : String(d.year)) : '');
  function duration(n) {
    const y = Math.floor(n / 12);
    const m = n % 12;
    return [y ? fill(y === 1 ? 'ps.dur.yr' : 'ps.dur.yrs', { n: y }) : '', m ? fill(m === 1 ? 'ps.dur.mo' : 'ps.dur.mos', { n: m }) : ''].filter(Boolean).join(' ') || fill('ps.dur.mo', { n: 1 });
  }
  const monthsOf = (start, end) => {
    const now = new Date();
    const a = start.year * 12 + ((start.month || 1) - 1);
    const b = end ? end.year * 12 + ((end.month || 12) - 1) : now.getUTCFullYear() * 12 + now.getUTCMonth();
    return Math.max(1, b - a + 1);
  };
  const verified = (it) => (it.verified ? ` <span class="tag tag-verified ps-verified" title="${esc(t('ps.verifiedTitle'))}">✓ ${esc(t('ps.verified'))}</span>` : '');
  const linkTag = (url, label) => `<a class="plain-link" href="${esc(url)}" target="_blank" rel="nofollow ugc noopener noreferrer">${esc(label || new URL(url).hostname.replace(/^www\./, ''))}</a>`;
  const section = (id, title, body) => `<section class="profile-section ps-section" aria-labelledby="${id}"><h2 id="${id}">${esc(title)}</h2>${body}</section>`;

  function experience(groups) {
    return `<ol class="ps-exp">${groups.map((g) => `<li class="ps-exp-org">
      <p class="ps-org"><strong>${esc(g.organisation)}</strong>${g.items.length > 1 ? ` <span class="muted small">· ${esc(duration(g.months))}</span>` : ''}</p>
      <ol class="ps-exp-roles">${g.items.map((it) => `<li>
        <p><strong>${esc(it.title)}</strong>${verified(it)}<br>
          <span class="muted small">${esc(t('ps.type.' + it.type))} · ${esc(dateText(it.start))} – ${esc(it.current ? t('ps.present') : dateText(it.end || it.start))} · ${esc(duration(monthsOf(it.start, it.current ? null : (it.end || it.start))))}${it.location ? ' · ' + esc(it.location) : ''}</span></p>
        ${it.description ? `<p class="ps-desc">${esc(it.description).replace(/\n/g, '<br>')}</p>` : ''}
        ${(it.achievements || []).length ? `<ul class="ps-ach">${it.achievements.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      </li>`).join('')}</ol></li>`).join('')}</ol>`;
  }

  function html(s) {
    if (!s || s.hidden) return '';
    const parts = [];
    if ((s.experience || []).length) parts.push(section('psExp', t('ps.s.experience'), experience(s.experience)));
    if ((s.education || []).length) parts.push(section('psEdu', t('ps.s.education'), `<ul class="ps-list">${s.education.map((e) => `<li><strong>${esc(e.school)}</strong>${verified(e)}
      ${[e.degree, e.field].filter(Boolean).length ? `<br>${esc([e.degree, e.field].filter(Boolean).join(', '))}` : ''}
      ${e.startYear || e.endYear ? `<br><span class="muted small">${esc([e.startYear, e.endYear].filter(Boolean).join(' – '))}</span>` : ''}
      ${e.description ? `<p class="ps-desc">${esc(e.description)}</p>` : ''}</li>`).join('')}</ul>`));
    if ((s.licences || []).length) parts.push(section('psLic', t('ps.s.licences'), `<ul class="ps-list">${s.licences.map((l) => `<li><strong>${esc(l.name)}</strong>${verified(l)}<br>
      <span class="muted small">${esc(l.issuer)} · ${esc(dateText(l.issued))}${l.expires ? ' – ' + esc(dateText(l.expires)) : ''}</span>${l.url ? `<br>${linkTag(l.url, t('ps.credential'))}` : ''}</li>`).join('')}</ul>`));
    if ((s.projects || []).length) parts.push(section('psProj', t('ps.s.projects'), `<ul class="ps-projects">${s.projects.map((p) => `<li>
      ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" width="96" height="96" loading="lazy">` : ''}
      <div><strong>${esc(p.title)}</strong>${p.url ? `<br>${linkTag(p.url)}` : ''}${p.description ? `<p class="ps-desc">${esc(p.description)}</p>` : ''}</div></li>`).join('')}</ul>`));
    if ((s.journey || []).length) parts.push(section('psJourney', t('ps.s.journey'), `<ol class="ps-timeline">${s.journey.map((j) => `<li>
      <span class="ps-when">${esc(dateText(j.date))}</span><p><strong>${esc(j.title)}</strong>${j.text ? `<br><span class="small">${esc(j.text)}</span>` : ''}</p></li>`).join('')}</ol>`));
    if ((s.skills || []).length) parts.push(section('psSkills', t('ps.s.skills'), `<p class="ps-chips">${s.skills.map((k) => `<span class="tag${(s.topSkills || []).includes(k) ? ' tag-niche' : ''}">${esc(k)}</span>`).join(' ')}</p>`));
    if ((s.languages || []).length && s.languages.some((l) => l.level)) parts.push(section('psLang', t('ps.s.languages'), `<ul class="ps-list ps-langs">${s.languages.map((l) => `<li>${esc(t('lang.' + l.code))}${l.level ? ` <span class="muted small">· ${esc(t('ps.langLevel.' + l.level))}</span>` : ''}</li>`).join('')}</ul>`));
    const links = s.links ? ['github', 'behance', 'instagram', 'youtube'].filter((k) => s.links[k]) : [];
    if (links.length) parts.push(section('psLinks', t('ps.s.moreLinks'), `<p class="profile-links">${links.map((k) => linkTag(s.links[k], t('ps.link.' + k))).join(' ')}</p>`));
    if (!parts.length) return '';
    parts.push(`<p class="muted small ps-self">${esc(t('ps.selfReported'))}</p>`);
    // (one block, placed right after About by the page's grid)
    return `<div class="ps-wrap">${parts.join('')}</div>`;
  }

  // The top skills, for the header.
  const topSkills = (s) => (s && (s.topSkills || []).length ? `<p class="ps-chips ps-top-skills">${s.topSkills.map((k) => `<span class="tag tag-niche">${esc(k)}</span>`).join(' ')}</p>` : '');

  return { html, topSkills, duration, dateText };
})();
