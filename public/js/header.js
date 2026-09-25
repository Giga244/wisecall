// The same header on every page: skip link, logo, main links, language switch, log in / account buttons, and below
// 1024px a menu button that opens a full-height panel (built here, opened by nav.js).
// Loaded as the first script inside <body>, so it puts the header exactly where the script tag is.
(function () {
  // The Wisecall logo, as the brand files in /brand (never redrawn here). Light pages use the navy + coral logo, dark pages the
  // one made for dark backgrounds. Under 360px wide the light logo becomes just the symbol, so the header never overflows.
  // (Ratio 446 : 108, so 36px high is 149px wide; the size attributes keep the page from jumping while the logo loads.)
  window.WisecallBrand = window.WisecallBrand || {
    logoHtml(opts) {
      const dark = document.documentElement.dataset.theme === 'dark';
      if (dark) return '<img class="logo-img" src="/brand/wisecall-logo-on-dark-transparent.svg" alt="Wisecall" width="149" height="36" decoding="async">';
      if (opts && opts.full) return '<img class="logo-img" src="/brand/wisecall-logo.svg" alt="Wisecall" width="149" height="36" decoding="async">'; // (the footer has room for the whole logo)
      return '<picture class="logo-pic" data-mark><source media="(max-width: 359px)" srcset="/brand/wisecall-mark.svg"><img class="logo-img" src="/brand/wisecall-logo.svg" alt="Wisecall" width="149" height="36" decoding="async"></picture>';
    }
  };
  const here = window.location.pathname;
  const onHome = here === '/' || here === '/index.html';
  const link = (hash) => (onHome ? '' : '/index.html') + hash; // on the home page the links just scroll

  const LINKS = [
    { hash: '#how', key: 'nav.how', text: 'How it works', extra: true },
    { hash: '#experts', key: 'nav.browse', text: 'Browse experts' },
    { hash: '#for-mentors', key: 'footer.forMentors', text: 'For mentors', extra: true },
    { hash: '#faq', key: 'footer.faq', text: 'FAQ', extra: true }
  ];
  const langSwitch = (cls) => `
    <div class="lang-toggle ${cls}" role="group" aria-label="Language" data-i18n-aria="nav.language">
      <button type="button" class="lang-btn" data-lang="en">EN</button>
      <button type="button" class="lang-btn" data-lang="ka">KA</button>
    </div>`;
  const ICON_MENU = '<svg class="icon-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const html = `
    <a class="skip-link" href="#main" data-i18n="a11y.skip">Skip to content</a>
    <header class="nav" id="siteHeader">
      <div class="container nav-inner">
        <a href="/index.html" class="logo">${WisecallBrand.logoHtml()}</a>
        <nav class="nav-links" aria-label="Main">
          ${LINKS.map((l) => `<a href="${link(l.hash)}"${l.extra ? ' class="nl-extra"' : ''} data-i18n="${l.key}">${l.text}</a>`).join('\n          ')}
        </nav>
        <div class="nav-right">
          ${langSwitch('nav-lang')}
          <div class="nav-actions" id="navLoggedOut">
            <a href="/login.html" class="btn btn-ghost" data-i18n="nav.login">Log in</a>
            <a href="/signup.html" class="btn btn-primary" data-i18n="nav.signup">Sign up</a>
          </div>
          <div class="nav-actions" id="navLoggedIn" style="display:none">
            <a href="/dashboard.html" class="btn btn-ghost" data-i18n="nav.dashboard">Dashboard</a>
            <a href="/settings.html" class="btn btn-ghost" data-i18n="nav.settings">Settings</a>
            <button type="button" class="btn btn-outline" id="logoutBtn" data-i18n="nav.logout">Log out</button>
          </div>
        </div>
        <button type="button" class="nav-toggle" id="navToggle" aria-expanded="false" aria-controls="mobileMenu" aria-label="Menu" data-i18n-aria="nav.menu">${ICON_MENU}</button>
      </div>
    </header>

    <div class="mobile-menu" id="mobileMenu" hidden>
      <div class="mm-backdrop" data-mm-close></div>
      <div class="mm-panel" role="dialog" aria-modal="true" aria-labelledby="mmTitle" tabindex="-1">
        <div class="mm-head">
          <span class="logo" id="mmTitle">${WisecallBrand.logoHtml()}</span>
          <button type="button" class="mm-close" data-mm-close aria-label="Close menu" data-i18n-aria="nav.menuClose">${ICON_CLOSE}</button>
        </div>
        <nav class="mm-links" aria-label="Main">
          ${LINKS.map((l) => `<a href="${link(l.hash)}" data-i18n="${l.key}">${l.text}</a>`).join('\n          ')}
        </nav>
        <div class="mm-lang">${langSwitch('mm-lang-toggle')}</div>
        <div class="mm-actions" id="mmLoggedOut">
          <a href="/signup.html" class="btn btn-primary btn-lg btn-block" data-i18n="nav.signup">Sign up</a>
          <a href="/login.html" class="btn btn-outline btn-lg btn-block" data-i18n="nav.login">Log in</a>
        </div>
        <div class="mm-actions" id="mmLoggedIn" style="display:none">
          <a href="/dashboard.html" class="btn btn-primary btn-lg btn-block" data-i18n="nav.dashboard">Dashboard</a>
          <a href="/settings.html" class="btn btn-outline btn-lg btn-block" data-i18n="nav.settings">Settings</a>
          <button type="button" class="btn btn-ghost btn-lg btn-block" id="mmLogoutBtn" data-i18n="nav.logout">Log out</button>
        </div>
      </div>
    </div>`;

  const me = document.currentScript;
  me.insertAdjacentHTML('beforebegin', html);
  me.remove();

  // Every page shows the right buttons for a signed-in or signed-out visitor, even when the page's own
  // script does not need to know who the user is (nav.js only runs its set-up once).
  document.addEventListener('DOMContentLoaded', () => {
    if (window.WisecallNav && window.WisecallI18n) WisecallI18n.ready.then(() => WisecallNav.initNav());
  });
})();
