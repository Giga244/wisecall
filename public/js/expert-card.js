// The expert card (docs/CLAUDE-CODE-CARD-CHECKS.md): one mentor as Browse experts shows them, and the same card as a preview in the mentor's
// own form (Settings → My details, the application) and in the admin's review. Its look: public/css/expert-card.css (inside .browse-page or a
// .card-preview).
//   WisecallExpertCard.html(e, { href, directions, preview })
//     e            a mentor as /api/experts sends one (name, photoUrl/color, roleTitle, niche, customNiche, practiceKind, profile, bio, trust,
//                  badges, price, ratingAvg, reviewCount)
//     href         where the card leads (a link); preview: a card that leads nowhere (a <div>, for the previews)
//     directions   the names of up to 3 directions (Browse knows the catalogue)
//   WisecallExpertCard.text(e)   the card's words: the start of the About; without one the "რაში დაგეხმარები" lines; never "ჩემი გზა"
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The role and the field say the same thing ("ვებ-დიზაინერი" and "ვებ-დიზაინი", "Product designer" and "Product design"): the card says it once.
  function sameThing(a, b) {
    const n = (v) => String(v || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
    const x = n(a), y = n(b);
    if (!x || !y) return false;
    const short = x.length <= y.length ? x : y, long = x.length <= y.length ? y : x;
    let i = 0;
    while (i < short.length && short[i] === long[i]) i += 1;
    return i >= Math.max(4, Math.ceil(short.length * 0.75));
  }

  // The card's text (docs/CLAUDE-CODE-CARD-ABOUT.md): the start of the mentor's "შესახებ" (About), two lines, "…" where it is cut; without
  // one, their "რაში დაგეხმარები" lines; without those, nothing (the headline says who they are). Never the words of "ჩემი გზა".
  function text(e) {
    if (e.bio && String(e.bio).trim()) return String(e.bio).trim();
    const help = ((e.trust && e.trust.helpPoints) || []).filter((x) => String(x || '').trim());
    return help.length ? help.join(' · ') : '';
  }

  function html(e, { href = '', directions = [], preview = false } = {}) {
    const field = WisecallI18n.fieldName(e);
    const role = [e.roleTitle, e.niche && !sameThing(e.roleTitle, field) ? field : ''].filter(Boolean).map(esc).join(' · ');
    const p = e.profile || {};
    const trust = e.trust || { startTags: [], hasSample: false };
    const words = text(e);
    const inner = `
        <div class="card-top">
          ${WisecallAPI.avatar(e)}
          <div>
            <div class="card-name">${esc(e.name)} ${(e.reviewCount || 0) < 3 ? `<span class="badge badge-paid">${t('expert.newMentor')}</span>` : ''}</div>
            <div class="card-role">${role}${e.practiceKind ? ` <span class="chip-tag kind-tag">${esc(t('profile.kind.' + e.practiceKind))}</span>` : ''}</div>
            ${p.currentPosition || p.yearsOfExperience ? `<div class="card-role small">${p.currentPosition ? esc(t('experts.card.at').replace('{title}', p.currentPosition.title).replace('{organisation}', p.currentPosition.organisation)) : ''}${p.currentPosition && p.yearsOfExperience ? ' · ' : ''}${p.yearsOfExperience ? esc(t('experts.card.years').replace('{n}', p.yearsOfExperience)) : ''}</div>` : ''}
          </div>
        </div>
        ${p.headline ? `<div class="card-headline">${esc(p.headline)}</div>` : ''}
        ${words ? `<div class="card-bio"><p class="card-bio-text">${esc(words)}</p></div>` : ''}
        ${(trust.startTags || []).length || trust.hasSample ? `<div class="card-start">${(trust.startTags || []).slice(0, 2).map((id) => `<span class="tag tag-start">${esc(t('start.' + id))}</span>`).join(' ')}${trust.hasSample ? ` <span class="tag tag-sample">${esc(t('experts.card.sample'))}</span>` : ''}</div>` : ''}
        ${(p.topSkills || []).length ? `<div class="card-skills">${p.topSkills.map((k) => `<span class="tag">${esc(k)}</span>`).join(' ')}</div>` : ''}
        ${directions.length ? `<div class="card-skills">${directions.slice(0, 3).map((n) => `<span class="tag">${esc(n)}</span>`).join(' ')}</div>` : ''}
        ${window.WisecallBadges ? WisecallBadges.row(e.badges) : ''}
        <span class="card-view">${esc(t('experts.card.view'))}</span>
        <div class="card-bottom">
          <span class="rating">${e.ratingAvg ? `★ ${e.ratingAvg} (${e.reviewCount} ${t('expert.reviewsShort')})` : t('expert.noReviewsYet')}</span>
          ${e.price === null || e.price === undefined ? '' : `<span class="price${e.price === 0 ? ' is-free' : ''}">${WisecallAPI.formatPrice(e.price)}${e.price === 0 ? '' : `<span> ${t('expert.perQuestion')}</span>`}</span>`}
        </div>
        <span class="btn btn-primary btn-sm btn-block">${t('expert.ask')}</span>`;
    // (a preview leads nowhere and is not read twice by a screen reader: the form next to it says the same)
    return preview ? `<div class="expert-card is-preview" aria-hidden="true">${inner}</div>` : `<a class="expert-card" href="${esc(href)}">${inner}</a>`;
  }

  window.WisecallExpertCard = { html, text, sameThing };
})();
