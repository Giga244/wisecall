// Adds the same footer to every page: logo and tagline, Product / Company / Legal links, the contact
// email and social links (only when they are set in the server's configuration), the language switch
// and the year. Loaded right after i18n.js so the footer exists before the translations are applied.
(function () {
  const old = document.querySelector('footer.footer');
  if (old) old.remove();

  const f = document.createElement('footer');
  f.className = 'footer';
  f.innerHTML = `
    <div class="container">
      <div class="footer-top">
        <div class="footer-brand">
          <a class="logo" href="/index.html">${window.WisecallBrand ? WisecallBrand.logoHtml({ full: true }) : 'Wisecall'}</a>
          <p data-i18n="footer.tagline">Real advice, from people who've done it.</p>
          <p class="footer-contact" id="footerContact" hidden><a href="" id="footerContactLink"></a></p>
          <ul class="footer-social" id="footerSocial" hidden></ul>
        </div>
        <nav class="footer-col" aria-labelledby="footProduct">
          <h2 id="footProduct" data-i18n="footer.product">Product</h2>
          <ul>
            <li><a href="/index.html#experts" data-i18n="nav.browse">Browse experts</a></li>
            <li><a href="/index.html#how" data-i18n="nav.how">How it works</a></li>
            <li><a href="/faq.html#faq-payments" data-i18n="footer.pricing">Pricing</a></li>
            <li><a href="/become-a-mentor.html" data-i18n="footer.forMentors">For mentors</a></li>
          </ul>
        </nav>
        <nav class="footer-col" aria-labelledby="footCompany">
          <h2 id="footCompany" data-i18n="footer.company">Company</h2>
          <ul>
            <li><a href="/about.html" data-i18n="footer.about">About</a></li>
            <li><a href="/contact.html" data-i18n="footer.contact">Contact</a></li>
            <li><a href="/faq.html" data-i18n="footer.faq">FAQ</a></li>
            <li><a href="/how-we-verify.html" data-i18n="hv.title">How we verify mentors</a></li>
            <li><a href="/help.html" data-i18n="help.title">Help centre</a></li>
            <li><a href="/answers" data-i18n="answers.title">Real answers</a></li>
            <li id="footerLive" hidden><a href="/live" data-i18n="live.title">Live sessions</a></li>
          </ul>
        </nav>
        <nav class="footer-col" aria-labelledby="footLegal">
          <h2 id="footLegal" data-i18n="footer.legalNav">Legal</h2>
          <ul>
            <li><a href="/terms.html" data-i18n="footer.terms">Terms</a></li>
            <li><a href="/privacy.html" data-i18n="footer.privacy">Privacy</a></li>
          </ul>
        </nav>
      </div>
      <div class="footer-pay" id="footerPay" hidden>
        <span class="muted small" data-i18n="footer.weAccept">We accept</span>
        <span class="pay-mark" aria-label="Visa">VISA</span>
        <span class="pay-mark pay-mark-mc" aria-label="Mastercard"><span class="mc-dot" aria-hidden="true"></span><span class="mc-dot" aria-hidden="true"></span>Mastercard</span>
      </div>
      <div class="footer-bottom">
        <div>
          <p>© <span id="footerYear"></span> Wisecall</p>
          <p class="footer-legal muted small" id="footerLegal" hidden></p>
        </div>
        <div class="footer-lang">
          <span class="muted small" data-i18n="footer.lang">Language</span>
          <div class="lang-toggle" role="group" data-i18n-aria="footer.lang" aria-label="Language">
            <button type="button" class="lang-btn" data-lang="en">EN</button>
            <button type="button" class="lang-btn" data-lang="ka">KA</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(f);
  f.querySelector('#footerYear').textContent = new Date().getFullYear();

  // Simple line icons. The link's name is the network's own name, which is the same in every language.
  const SOCIAL = {
    facebook: ['Facebook', '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>'],
    instagram: ['Instagram', '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/>'],
    linkedin: ['LinkedIn', '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>'],
    x: ['X', '<path d="M4 4l16 16M20 4L4 20"/>'],
    tiktok: ['TikTok', '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'],
    youtube: ['YouTube', '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><path d="M9.75 15.02l5.75-3.27-5.75-3.27z"/>']
  };

  // The contact email and social links come from the server's settings; whatever is not set is not shown.
  function fromConfig(cfg) {
    // The seller's legal details (Georgian e-commerce rules), each part only when it is set.
    const legal = cfg.legal || {};
    const parts = [legal.name, legal.id && `ID ${legal.id}`, legal.address].filter(Boolean);
    if (parts.length) { const el = f.querySelector('#footerLegal'); el.textContent = parts.join(' · '); el.hidden = false; }
    // Card logos only once real payments are open.
    f.querySelector('#footerPay').hidden = !cfg.paymentsLive;
    f.querySelector('#footerLive').hidden = !cfg.liveSessions; // (only while live sessions are switched on)
    if (cfg.contactEmail) {
      const link = f.querySelector('#footerContactLink');
      link.href = 'mailto:' + cfg.contactEmail;
      link.textContent = cfg.contactEmail;
      f.querySelector('#footerContact').hidden = false;
    }
    const entries = Object.entries(cfg.social || {}).filter(([name, url]) => SOCIAL[name] && /^https:\/\//i.test(url));
    if (entries.length) {
      const list = f.querySelector('#footerSocial');
      list.innerHTML = entries.map(([name, url]) => `
        <li><a href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" aria-label="${SOCIAL[name][0]}">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SOCIAL[name][1]}</svg></a></li>`).join('');
      list.hidden = false;
    }
  }
  if (window.WisecallI18n && WisecallI18n.getConfig) WisecallI18n.getConfig().then(fromConfig);
})();
