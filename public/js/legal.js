(async function () {
  await WisecallI18n.initI18n();
  const kind = document.body.dataset.legal; // "terms" or "privacy"
  const root = document.getElementById('legalBody');
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let supportEmail = null;

  // The public support address is added where the text says how to reach us: the last
  // section of the Terms (Contact) and the first of the Privacy Policy (who is responsible). Nothing is
  // added when no address is configured.
  function contactLine() {
    if (!supportEmail) return '';
    const [before, after] = WisecallI18n.t('legal.contactLine').split('{email}');
    return `<p>${esc(before || '')}<a href="mailto:${esc(supportEmail)}">${esc(supportEmail)}</a>${esc(after || '')}</p>`;
  }

  // The Terms name who runs Wisecall (LEGAL_NAME, LEGAL_ID, LEGAL_ADDRESS), each part only when it is set; nothing before registration.
  let legal = {};
  function operatorLine() {
    const t = WisecallI18n.t;
    if (!legal.name) return '';
    const parts = [legal.name, legal.id && t('legal.operator.id').replace('{id}', legal.id), legal.address].filter(Boolean).join(', ');
    return `<p class="legal-operator">${esc(t('legal.operator').replace('{details}', parts))}</p>`;
  }

  function render() {
    const t = WisecallI18n.t;
    const sections = t(`legal.${kind}.sections`);
    const title = t(`legal.${kind}.title`);
    document.title = title.includes('Wisecall') ? title : `${title} — Wisecall`;
    const withContact = kind === 'terms' ? (sections || []).length - 1 : (kind === 'privacy' ? 0 : -1);
    root.innerHTML = Array.isArray(sections) ? sections.map((s, i) => `
      <section class="legal-section"${s.id ? ` id="${esc(s.id)}"` : ''}>
        <h2>${esc(s.h)}</h2>
        ${s.p.map(p => `<p>${esc(p)}</p>`).join('')}
        ${i === 0 && kind === 'terms' ? operatorLine() : ''}
        ${i === withContact ? contactLine() : ''}
      </section>`).join('') : '';
  }
  // About: the founder, when the site is set up with one (FOUNDER_* settings); every value is set as text.
  let founder = null;
  function renderFounder() {
    const box = document.getElementById('founderBox');
    if (!box) return;
    if (!founder) { box.hidden = true; return; }
    const lang = WisecallI18n.getLang();
    // (outside production with no founder set: the placeholder, marked as one)
    const t = WisecallI18n.t;
    if (founder.placeholder) founder = { ...founder, name: t('about.founder.placeholderName'), role: t('about.founder.placeholderRole'), story: { [lang]: t('about.founder.placeholderStory') } };
    const story = (founder.story && (founder.story[lang] || founder.story.en)) || '';
    box.innerHTML = `<h2 id="founderTitle">${esc(WisecallI18n.t('about.founder.title'))}</h2>
      <div class="founder">${founder.photo ? `<img class="founder-photo" src="${esc(founder.photo)}" alt="" width="120" height="120" decoding="async">` : ''}
        <div><p class="founder-name"><strong>${esc(founder.name)}</strong>${founder.role ? `<br><span class="muted">${esc(founder.role)}</span>` : ''}</p>
        ${story.split(/\n{2,}/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('')}</div></div>`;
    box.hidden = false;
  }
  render();
  // The sections are drawn by this script, so a link to one of them (/privacy.html#automated-review) is scrolled to once it exists.
  if (window.location.hash) { const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1))); if (target) target.scrollIntoView(); }
  document.addEventListener('wisecall:lang-changed', () => { render(); renderFounder(); });
  WisecallI18n.getConfig().then((cfg) => { supportEmail = cfg.contactEmail || null; legal = cfg.legal || {}; founder = cfg.founder || null; render(); renderFounder(); });
})();