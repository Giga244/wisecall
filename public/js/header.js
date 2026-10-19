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
  const here = window.location.pathname.replace(/^\/ka(?=\/|$)/, '') || '/'; // (the Georgian address /ka/... is the same page)
  const onHome = here === '/' || here === '/index.html';
  const link = (l) => l.href || (onHome ? '' : '/index.html') + l.hash; // on the home page the links just scroll (the mentors' page is its own)

  // The header's own words, in the page's language from its first frame (the page's dictionary arrives a moment later and writes the
  // same words; tests/header-hint.test.js keeps these equal to public/i18n/en.json and ka.json). The language as i18n.js finds it.
  const LANG = (() => {
    if (/^\/ka(\/|$)/.test(window.location.pathname)) return 'ka';
    try { const saved = localStorage.getItem('wisecall_lang'); if (saved === 'ka' || saved === 'en') return saved; } catch (e) { /* storage unavailable */ }
    return navigator.language && navigator.language.toLowerCase().startsWith('ka') ? 'ka' : 'en';
  })();
  const WORDS = {
    en: {
      'a11y.skip': 'Skip to content', 'nav.how': 'How it works', 'nav.browse': 'Browse experts', 'nav.becomeMentor': 'Become a mentor', 'footer.faq': 'FAQ',
      'nav.language': 'Language', 'nav.login': 'Log in', 'nav.signup': 'Sign up', 'nav.inbox': 'Inbox', 'nav.dashboard': 'Dashboard', 'nav.settings': 'Settings',
      'nav.logout': 'Log out', 'nav.admin': 'Admin', 'nav.menu': 'Menu', 'nav.menuClose': 'Close menu', 'theme.toDark': 'Switch to dark mode', 'theme.toLight': 'Switch to light mode'
    },
    ka: {
      'a11y.skip': 'გადასვლა შინაარსზე', 'nav.how': 'როგორ მუშაობს', 'nav.browse': 'ექსპერტები', 'nav.becomeMentor': 'გახდი მენტორი', 'footer.faq': 'კითხვები',
      'nav.language': 'ენა', 'nav.login': 'შესვლა', 'nav.signup': 'რეგისტრაცია', 'nav.inbox': 'შემოსულები', 'nav.dashboard': 'პირადი კაბინეტი', 'nav.settings': 'პარამეტრები',
      'nav.logout': 'გასვლა', 'nav.admin': 'ადმინი', 'nav.menu': 'მენიუ', 'nav.menuClose': 'მენიუს დახურვა', 'theme.toDark': 'მუქ რეჟიმზე გადართვა', 'theme.toLight': 'ღია რეჟიმზე გადართვა'
    }
  };
  const w = (key) => WORDS[LANG][key] || WORDS.en[key];

  // "Become a mentor" is always there for a visitor and for a signed-in person who is not a mentor (never for a mentor, someone already
  // applying, or an admin: the hint below says which), in the header and in the menu panel.
  const LINKS = [
    { hash: '#how', key: 'nav.how', extra: true },
    { hash: '#experts', key: 'nav.browse' },
    { href: '/become-a-mentor.html', key: 'nav.becomeMentor', mentor: true },
    { hash: '#faq', key: 'footer.faq', extra: true, faq: true }
  ];
  // (a page opened for a mentor, /signup.html?as=mentor and the rest of the way: its mentor words from the first frame, see style.css)
  try { if (new URLSearchParams(window.location.search).get('as') === 'mentor') document.documentElement.dataset.as = 'mentor'; } catch (e) { /* no URL API */ }
  const langSwitch = (cls) => `
    <div class="lang-toggle ${cls}" role="group" aria-label="${w('nav.language')}" data-i18n-aria="nav.language">
      <button type="button" class="lang-btn${LANG === 'en' ? ' active' : ''}" data-lang="en">EN</button>
      <button type="button" class="lang-btn${LANG === 'ka' ? ' active' : ''}" data-lang="ka">KA</button>
    </div>`;
  const SUN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/></svg>';
  // The theme: one button that switches between light and dark with one click. It shows where a click goes (a moon on a light page,
  // a sun on a dark one) and says it ("Switch to dark mode"). In the header on a desktop, in the menu panel (with its words) on a phone.
  const themeToggle = '<div class="theme-switch"><button type="button" class="theme-btn" id="themeBtn" data-theme-toggle aria-label="Switch to dark mode"></button></div>';
  const themeRow = '<button type="button" class="mm-theme-btn" id="mmThemeBtn" data-theme-toggle><span class="mm-theme-icon" aria-hidden="true"></span><span class="mm-theme-text">Switch to dark mode</span></button>';
  const ICON_MENU = '<svg class="icon-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  const ICON_INBOX = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13h4l2 3h4l2-3h4"/><path d="M5.5 5h13l2.5 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  // Signed in? Next to the login cookie the server leaves a small readable hint (wc_authed: "1", "mentor", or "admin"; see
  // server/auth.js), so the header and the menu panel are drawn as they will stay from the first frame: a signed-in person never sees the
  // signed-out menu first. nav.js still asks the server, and only if the two disagree (a session that ran out, say) does the header change,
  // with a fade.
  const signedIn = (() => { try { return (/(?:^|;\s*)wc_authed=(1|admin|mentor)(?:;|$)/.exec(document.cookie) || [])[1] || ''; } catch (e) { return ''; } })();
  const off = (yes) => (yes ? ' style="display:none"' : '');
  const shown = LINKS.filter((l) => !l.mentor || signedIn === '' || signedIn === '1')
    // (signed in: straight to the application; a visitor first reads what it means, and starts from there)
    .map((l) => (l.mentor && signedIn === '1' ? { ...l, href: '/apply.html' } : l));
  const cls = (l, extra) => [l.extra && extra ? `nl-extra${l.faq ? ' nl-faq' : ''}` : '', l.mentor ? 'nl-mentor' : ''].filter(Boolean).join(' ');
  const adminLink = (cls) => (signedIn === 'admin' ? `<a href="/admin.html" class="${cls} admin-link" data-i18n="nav.admin">${w('nav.admin')}</a>` : '');

  const html = `
    <a class="skip-link" href="#main" data-i18n="a11y.skip">${w('a11y.skip')}</a>
    <header class="nav${signedIn ? ' is-authed' : ''}" id="siteHeader">
      <div class="container nav-inner">
        <a href="/index.html" class="logo">${WisecallBrand.logoHtml()}</a>
        <nav class="nav-links" aria-label="Main">
          ${shown.map((l) => `<a href="${link(l)}"${cls(l, true) ? ` class="${cls(l, true)}"` : ''} data-i18n="${l.key}">${w(l.key)}</a>`).join('\n          ')}
        </nav>
        <div class="nav-right">
          ${langSwitch('nav-lang')}
          ${themeToggle}
          <div class="nav-actions" id="navLoggedOut"${off(signedIn)}>
            <a href="/login.html" class="btn btn-ghost" data-i18n="nav.login">${w('nav.login')}</a>
            <a href="/signup.html" class="btn btn-primary" data-i18n="nav.signup">${w('nav.signup')}</a>
          </div>
          <div class="nav-actions" id="navLoggedIn"${off(!signedIn)}>
            ${adminLink('btn btn-ghost')}
            <a href="/inbox.html" class="nav-inbox" data-inbox-link aria-label="${w('nav.inbox')}" data-i18n-aria="nav.inbox">${ICON_INBOX}<span class="nav-badge" data-inbox-badge hidden></span></a>
            <a href="/dashboard.html" class="btn btn-ghost" data-i18n="nav.dashboard">${w('nav.dashboard')}</a>
            <a href="/settings.html" class="btn btn-ghost" data-i18n="nav.settings">${w('nav.settings')}</a>
            <button type="button" class="btn btn-outline" id="logoutBtn" data-i18n="nav.logout">${w('nav.logout')}</button>
          </div>
        </div>
        <button type="button" class="nav-toggle" id="navToggle" aria-expanded="false" aria-controls="mobileMenu" aria-label="${w('nav.menu')}" data-i18n-aria="nav.menu">${ICON_MENU}<span class="nav-badge nav-badge-dot" data-inbox-badge data-dot hidden></span></button>
      </div>
    </header>

    <div class="mobile-menu" id="mobileMenu" hidden>
      <div class="mm-backdrop" data-mm-close></div>
      <div class="mm-panel" role="dialog" aria-modal="true" aria-labelledby="mmTitle" tabindex="-1">
        <div class="mm-head">
          <span class="logo" id="mmTitle">${WisecallBrand.logoHtml()}</span>
          <button type="button" class="mm-close" data-mm-close aria-label="${w('nav.menuClose')}" data-i18n-aria="nav.menuClose">${ICON_CLOSE}</button>
        </div>
        <nav class="mm-links" aria-label="Main">
          ${shown.map((l) => `<a href="${link(l)}"${cls(l, false) ? ` class="${cls(l, false)}"` : ''} data-i18n="${l.key}">${w(l.key)}</a>`).join('\n          ')}
        </nav>
        <div class="mm-lang">${langSwitch('mm-lang-toggle')}</div>
        ${themeRow}
        <div class="mm-actions" id="mmLoggedOut"${off(signedIn)}>
          <a href="/signup.html" class="btn btn-primary btn-lg btn-block" data-i18n="nav.signup">${w('nav.signup')}</a>
          <a href="/login.html" class="btn btn-outline btn-lg btn-block" data-i18n="nav.login">${w('nav.login')}</a>
        </div>
        <div class="mm-actions" id="mmLoggedIn"${off(!signedIn)}>
          <a href="/inbox.html" class="btn btn-outline btn-lg btn-block mm-inbox" data-inbox-link aria-label="${w('nav.inbox')}" data-i18n-aria="nav.inbox"><span data-i18n="nav.inbox">${w('nav.inbox')}</span><span class="nav-badge" data-inbox-badge hidden></span></a>
          ${adminLink('btn btn-outline btn-lg btn-block')}
          <a href="/dashboard.html" class="btn btn-primary btn-lg btn-block" data-i18n="nav.dashboard">${w('nav.dashboard')}</a>
          <a href="/settings.html" class="btn btn-outline btn-lg btn-block" data-i18n="nav.settings">${w('nav.settings')}</a>
          <button type="button" class="btn btn-ghost btn-lg btn-block" id="mmLogoutBtn" data-i18n="nav.logout">${w('nav.logout')}</button>
        </div>
      </div>
    </div>`;

  const me = document.currentScript;
  me.insertAdjacentHTML('beforebegin', html);
  me.remove();

  // ---- The theme toggle ------------------------------------------------------------------------------------------
  // (the page's dictionary once it is there, which follows a language switch; until then the header's own words)
  const word = (key) => {
    const t = window.WisecallI18n ? WisecallI18n.t(key) : key;
    return t && t !== key ? t : w(key);
  };
  function drawTheme(animate) {
    if (!window.WisecallTheme) return;
    const dark = WisecallTheme.resolved() === 'dark';
    const label = word(dark ? 'theme.toLight' : 'theme.toDark');
    const icon = dark ? SUN : MOON; // (where a click goes)
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
      b.setAttribute('aria-label', label);
      const iconBox = b.querySelector('.mm-theme-icon') || b;
      iconBox.innerHTML = icon;
      const text = b.querySelector('.mm-theme-text');
      if (text) text.textContent = label;
      // (the new icon turns in: a short rotate and fade, only when motion is allowed, see style.css)
      if (animate) { b.classList.remove('is-switching'); void b.offsetWidth; b.classList.add('is-switching'); }
    });
  }
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-theme-toggle]') && window.WisecallTheme) WisecallTheme.toggle();
  });
  drawTheme(false);
  document.addEventListener('wisecall:lang-changed', () => drawTheme(false));
  document.addEventListener('wisecall:theme-changed', (ev) => {
    drawTheme(Boolean(ev.detail && ev.detail.changed));
    // the logo made for dark backgrounds on dark pages, the navy + coral one on light pages
    document.querySelectorAll('.logo').forEach((a) => { a.innerHTML = WisecallBrand.logoHtml(a.closest('.footer') ? { full: true } : undefined); });
  });
  // Every page shows the right buttons for a signed-in or signed-out visitor, even when the page's own
  // script does not need to know who the user is (nav.js only runs its set-up once).
  document.addEventListener('DOMContentLoaded', () => {
    if (window.WisecallI18n) WisecallI18n.ready.then(() => drawTheme(false)); // (the button's words, once the page's language is loaded)
    if (window.WisecallNav && window.WisecallI18n) WisecallI18n.ready.then(() => WisecallNav.initNav());
  });
})();
