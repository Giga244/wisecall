// Trust badges shown on mentor cards and profiles. The server only sends a badge for a check the mentor
// has really passed (see server/verification/badges.js); this file only draws them.
(function () {
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Small line icons, drawn in the text colour.
  const ICONS = {
    id: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    license: '<circle cx="12" cy="9" r="5"/><path d="M9 13.5L8 21l4-2 4 2-1-7.5"/>',
    experience: '<path d="M4 6h10M4 11h7M4 16h6"/><path d="M14 16l2.5 2.5L21 13"/>',
    workEmail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 8l8 5 8-5"/>',
    diploma: '<path d="M3 9l9-4 9 4-9 4-9-4z"/><path d="M7 11v4.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V11"/><path d="M21 9v5"/>',
    interview: '<rect x="3" y="6" width="12" height="12" rx="3"/><path d="M15 10l6-3v10l-6-3"/>'
  };
  const icon = (key) => `<svg class="trust-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key] || ''}</svg>`;

  const KEYS = ['id', 'experience', 'license', 'workEmail', 'diploma', 'interview'];
  const label = (key) => WisecallI18n.t('badge.' + key);
  const dateOf = (d) => WisecallI18n.formatDate(d, { dateStyle: 'medium' });
  const tip = (b) => WisecallI18n.t('badge.' + b.key + '.tip').replace('{date}', dateOf(b.date));

  function known(badges) {
    return (badges || []).filter((b) => KEYS.includes(b.key)).sort((a, b) => KEYS.indexOf(a.key) - KEYS.indexOf(b.key));
  }

  // Compact row for a card that is itself a link: icon + short label, tip as a hover title.
  function row(badges) {
    const list = known(badges);
    if (!list.length) return '';
    return `<div class="trust-row">${list.map((b) => `<span class="trust-badge" title="${esc(tip(b))}">${icon(b.key)}<span>${esc(label(b.key))}</span></span>`).join('')}</div>`;
  }

  // Full version for the profile page: focusable, with the explanation shown on hover or focus.
  function full(badges) {
    const list = known(badges);
    if (!list.length) return '';
    return `<ul class="trust-list" aria-label="${esc(WisecallI18n.t('badge.title'))}">${list.map((b) => `
      <li><span class="trust-badge trust-badge-lg" tabindex="0" aria-describedby="tip-${b.key}">${icon(b.key)}<span>${esc(label(b.key))}</span>
        <span class="trust-tip" role="tooltip" id="tip-${b.key}">${esc(tip(b))}</span></span></li>`).join('')}</ul>
      <ul class="trust-explain">${list.map((b) => `<li><strong>${esc(label(b.key))}</strong> ${esc(tip(b))}</li>`).join('')}</ul>`;
  }

  // Every badge a new mentor can earn, for pages that explain how verification works.
  function legend() {
    return `<ul class="trust-list" aria-label="${esc(WisecallI18n.t('badge.title'))}">${KEYS.filter((k) => k !== 'interview').map((key) => `
      <li><span class="trust-badge trust-badge-lg">${icon(key)}<span>${esc(label(key))}</span></span></li>`).join('')}</ul>`;
  }

  window.WisecallBadges = { row, full, legend };
})();
