(async function () {
  await WisecallI18n.initI18n();
  const kind = document.body.dataset.legal; // "terms" or "privacy"
  const root = document.getElementById('legalBody');
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let supportEmail = null;

  // The public support address (SUPPORT_EMAIL) is added where the text says how to reach us: the last
  // section of the Terms (Contact) and the first of the Privacy Policy (who is responsible). Nothing is
  // added when no address is configured.
  function contactLine() {
    if (!supportEmail) return '';
    const [before, after] = WisecallI18n.t('legal.contactLine').split('{email}');
    return `<p>${esc(before || '')}<a href="mailto:${esc(supportEmail)}">${esc(supportEmail)}</a>${esc(after || '')}</p>`;
  }

  function render() {
    const t = WisecallI18n.t;
    const sections = t(`legal.${kind}.sections`);
    const title = t(`legal.${kind}.title`);
    document.title = title.includes('Wisecall') ? title : `${title} — Wisecall`;
    const withContact = kind === 'terms' ? (sections || []).length - 1 : (kind === 'privacy' ? 0 : -1);
    root.innerHTML = Array.isArray(sections) ? sections.map((s, i) => `
      <section class="legal-section">
        <h2>${esc(s.h)}</h2>
        ${s.p.map(p => `<p>${esc(p)}</p>`).join('')}
        ${i === withContact ? contactLine() : ''}
      </section>`).join('') : '';
  }
  render();
  document.addEventListener('wisecall:lang-changed', render);
  WisecallI18n.getConfig().then((cfg) => { supportEmail = cfg.contactEmail || null; render(); });
})();