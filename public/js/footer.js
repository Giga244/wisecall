// Adds the same footer to every page: logo and tagline, Product / Company / Legal links, the contact
// email and social links (only when they are set in the server's configuration), the language switch
// and the year. Loaded right after i18n.js so the footer exists before the translations are applied.
(function () {
  const old = document.querySelector('footer.footer');
  if (old) old.remove();

  const f = document.createElement('footer');
  f.className = 'footer';
  // One line (docs/CLAUDE-CODE-REDESIGN-CALM.md): © and the contact email, a few links, the social icons; under it, only when set, the
  // seller's legal details and (once payments are live) the card logos. Every other link is in the menu (public/js/header.js).
  f.className = 'footer footer-compact';
  f.innerHTML = `
    <div class="container footer-compact-inner">
      <div class="fc-copy"><p>© <span id="footerYear"></span> Wisecall<span id="footerContact" hidden> · <a href="" id="footerContactLink"></a></span></p></div>
      <nav class="fc-links" aria-label="Site links" data-i18n-aria="footer.nav">
        <a href="/faq.html#faq-payments" data-i18n="footer.pricing">Pricing</a>
        <a href="/faq.html" data-i18n="footer.faq">FAQ</a>
        <a href="/about.html" data-i18n="footer.about">About</a>
        <a href="/contact.html" data-i18n="footer.contact">Contact</a>
        <a href="/terms.html" data-i18n="footer.terms">Terms</a>
        <a href="/privacy.html" data-i18n="footer.privacy">Privacy</a>
      </nav>
      <ul class="footer-social" id="footerSocial" hidden></ul>
      <p class="fc-legal muted" id="footerLegal" hidden></p>
      <div class="footer-pay" id="footerPay" hidden>
        <span class="muted small" data-i18n="footer.weAccept">We accept</span>
        <span class="pay-mark" aria-label="Visa">VISA</span>
        <span class="pay-mark pay-mark-mc" aria-label="Mastercard"><span class="mc-dot" aria-hidden="true"></span><span class="mc-dot" aria-hidden="true"></span>Mastercard</span>
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
    tiktok: ['TikTok', '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.4 2.7 2.4 4.6 5 5"/>'],
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
    if (cfg.contactEmail) {
      const link = f.querySelector('#footerContactLink');
      link.href = 'mailto:' + cfg.contactEmail;
      link.textContent = cfg.contactEmail;
      f.querySelector('#footerContact').hidden = false;
    }
    const html = socialHtml(cfg.social);
    if (html) {
      const list = f.querySelector('#footerSocial');
      list.innerHTML = html;
      list.hidden = false;
    }
  }
  // The social links as icons in one colour, each opening in a new tab: Instagram, TikTok, Facebook first (docs/CLAUDE-CODE-NEW-HOME.md 2.7).
  // Also used by the waiting list's thank-you (waitlist.js). '' when none is set.
  const ORDER = ['instagram', 'tiktok', 'facebook', 'linkedin', 'x', 'youtube'];
  function socialHtml(social) {
    return ORDER.filter((name) => social && /^https:\/\//i.test(social[name] || '')).map((name) => `
        <li><a href="${social[name].replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" aria-label="${SOCIAL[name][0]}">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SOCIAL[name][1]}</svg></a></li>`).join('');
  }
  window.WisecallSocial = { html: socialHtml };
  if (window.WisecallI18n && WisecallI18n.getConfig) WisecallI18n.getConfig().then(fromConfig);
})();
