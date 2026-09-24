// The same header (skip link, logo, main links, language switch, log in / account buttons) on every page.
// Loaded as the first script inside <body>, so it puts the header exactly where the script tag is.
(function () {
  const here = window.location.pathname;
  const onHome = here === '/' || here === '/index.html';
  const link = (hash) => (onHome ? '' : '/index.html') + hash; // on the home page the links just scroll

  const html = `
    <a class="skip-link" href="#main" data-i18n="a11y.skip">Skip to content</a>
    <header class="nav">
      <div class="container nav-inner">
        <a href="/index.html" class="logo" aria-label="Wisecall">Wisecall<span class="dot">.</span></a>
        <nav class="nav-links" aria-label="Main">
          <a href="${link('#how')}" data-i18n="nav.how">How it works</a>
          <a href="${link('#experts')}" data-i18n="nav.browse">Browse experts</a>
          <a href="${link('#for-mentors')}" data-i18n="footer.forMentors">For mentors</a>
          <a href="${link('#faq')}" data-i18n="footer.faq">FAQ</a>
        </nav>
        <div class="nav-right">
          <div class="lang-toggle">
            <button type="button" class="lang-btn" data-lang="en">EN</button>
            <button type="button" class="lang-btn" data-lang="ka">KA</button>
          </div>
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
      </div>
    </header>`;

  const me = document.currentScript;
  me.insertAdjacentHTML('beforebegin', html);
  me.remove();

  // Every page shows the right buttons for a signed-in or signed-out visitor, even when the page's own
  // script does not need to know who the user is (nav.js only runs its set-up once).
  document.addEventListener('DOMContentLoaded', () => {
    if (window.WisecallNav && window.WisecallI18n) WisecallI18n.ready.then(() => WisecallNav.initNav());
  });
})();
