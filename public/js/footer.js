// Adds the same footer (with the legal links) to every page. Loaded right after i18n.js so the
// footer exists before the translations are applied and is translated with the rest of the page.
(function () {
  const old = document.querySelector('footer.footer');
  if (old) old.remove();
  const f = document.createElement('footer');
  f.className = 'footer';
  f.innerHTML = `
    <div class="container footer-inner">
      <div class="footer-brand">
        <div class="logo">Wisecall<span class="dot">.</span></div>
        <p data-i18n="footer.tagline">Real advice, from people who've done it.</p>
      </div>
      <nav class="footer-links" aria-label="Legal">
        <a href="/terms.html" data-i18n="footer.terms">Terms</a>
        <a href="/privacy.html" data-i18n="footer.privacy">Privacy</a>
      </nav>
    </div>`;
  document.body.appendChild(f);
  // Keep it below the toast/scripts; pages put their scripts at the end of <body>.
})();