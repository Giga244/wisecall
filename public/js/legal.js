(async function () {
  await SagelyI18n.initI18n();
  const kind = document.body.dataset.legal; // "terms" or "privacy"
  const root = document.getElementById('legalBody');
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function render() {
    const t = SagelyI18n.t;
    const sections = t(`legal.${kind}.sections`);
    document.title = `${t(`legal.${kind}.title`)} — Wisecall`;
    root.innerHTML = Array.isArray(sections) ? sections.map(s => `
      <section class="legal-section">
        <h2>${esc(s.h)}</h2>
        ${s.p.map(p => `<p>${esc(p)}</p>`).join('')}
      </section>`).join('') : '';
  }
  render();
  document.addEventListener('sagely:lang-changed', render);
})();