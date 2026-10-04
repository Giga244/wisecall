(function () {
  const t = (k) => (window.WisecallI18n ? WisecallI18n.t(k) : k);

  // ---- The menu panel (below 1024px) ---------------------------------------------------------------------------
  // A full-height panel that slides in from the right: big tap targets, the language switch and the account buttons.
  // While it is open the page behind it cannot scroll or be reached with the keyboard (focus stays inside), Esc, the
  // close button, the backdrop and choosing a link all close it, and focus goes back to the menu button.
  const DESKTOP = window.matchMedia('(min-width: 1024px)');
  function initMenu() {
    const header = document.getElementById('siteHeader');
    const toggle = document.getElementById('navToggle');
    const menu = document.getElementById('mobileMenu');
    if (!header || !toggle || !menu || toggle.dataset.ready) return;
    toggle.dataset.ready = '1';
    const panel = menu.querySelector('.mm-panel');
    const behind = () => Array.from(document.body.children).filter((el) => el !== menu && !el.matches('script, .toast'));
    let closing = null;

    const focusable = () => Array.from(panel.querySelectorAll('a[href], button:not([disabled])')).filter((el) => el.offsetParent !== null || el === document.activeElement);

    function open() {
      clearTimeout(closing);
      menu.hidden = false;
      document.documentElement.classList.add('menu-open');
      toggle.setAttribute('aria-expanded', 'true');
      behind().forEach((el) => { el.inert = true; });
      requestAnimationFrame(() => { menu.classList.add('is-open'); const first = panel.querySelector('.mm-close'); if (first) first.focus(); });
    }
    function close(returnFocus) {
      if (menu.hidden) return;
      menu.classList.remove('is-open');
      document.documentElement.classList.remove('menu-open');
      toggle.setAttribute('aria-expanded', 'false');
      behind().forEach((el) => { el.inert = false; });
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      closing = setTimeout(() => { menu.hidden = true; }, reduce ? 0 : 260);
      if (returnFocus !== false) toggle.focus();
    }

    toggle.addEventListener('click', () => (menu.hidden ? open() : close()));
    menu.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-mm-close]')) close();
      else if (ev.target.closest('a[href]')) close(false); // following a link
    });
    document.addEventListener('keydown', (ev) => {
      if (menu.hidden) return;
      if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
      if (ev.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (ev.shiftKey && (document.activeElement === first || document.activeElement === panel)) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
    DESKTOP.addEventListener('change', (e) => { if (e.matches) close(false); });
    document.addEventListener('wisecall:lang-changed', () => {
      toggle.setAttribute('aria-label', t('nav.menu'));
    });
  }

  // ---- The header hides while reading down the page and comes back on the way up (phones) ---------------------
  function initAutoHide() {
    const header = document.getElementById('siteHeader');
    if (!header || header.dataset.autohide) return;
    header.dataset.autohide = '1';
    const phone = window.matchMedia('(max-width: 767px)');
    let last = window.scrollY, ticking = false;
    function update() {
      ticking = false;
      const y = window.scrollY;
      const delta = y - last;
      const menuOpen = document.documentElement.classList.contains('menu-open');
      if (!phone.matches || menuOpen || y < 80 || header.contains(document.activeElement)) header.classList.remove('nav-hidden');
      else if (delta > 8) header.classList.add('nav-hidden');
      else if (delta < -8) header.classList.remove('nav-hidden');
      if (Math.abs(delta) > 8 || y < 80) last = y;
    }
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    header.addEventListener('focusin', () => header.classList.remove('nav-hidden'));
  }

  // Runs once per page, however many scripts ask for it (the header script and the page's own script both do).
  let navPromise = null;
  function initNav() {
    if (!navPromise) navPromise = setUpNav();
    return navPromise;
  }

  const both = (...ids) => ids.map((id) => document.getElementById(id)).filter(Boolean);
  const show = (el) => { el.style.display = el.classList.contains('mm-actions') ? 'grid' : 'flex'; };

  async function setUpNav() {
    initMenu();
    initAutoHide();
    const header = document.getElementById('siteHeader');
    const loggedOut = both('navLoggedOut', 'mmLoggedOut');
    const loggedIn = both('navLoggedIn', 'mmLoggedIn');
    let user = null;
    try {
      const data = await WisecallAPI.apiFetch('/me');
      user = data.user;
    } catch (e) { /* not logged in */ }
    // The theme chosen on the account (on another device, say) wins over what this device remembers; and from now on a choice made
    // here is saved on the account too.
    if (window.WisecallTheme) WisecallTheme.adopt(user);

    if (user) {
      loggedOut.forEach((el) => { el.style.display = 'none'; });
      loggedIn.forEach(show);
      if (header) header.classList.add('is-authed');
      if (user.isAdmin) {
        // An Admin button next to the others, in the header and in the menu panel.
        loggedIn.forEach((box, i) => {
          if (box.querySelector('.admin-link')) return;
          const a = document.createElement('a');
          a.href = '/admin.html';
          a.className = i === 0 ? 'btn btn-ghost admin-link' : 'btn btn-outline btn-lg btn-block admin-link';
          a.setAttribute('data-i18n', 'nav.admin');
          a.textContent = t('nav.admin') === 'nav.admin' ? 'Admin' : t('nav.admin');
          box.insertBefore(a, i === 0 ? box.firstChild : box.children[1] || null);
        });
      }
      both('logoutBtn', 'mmLogoutBtn').forEach((btn) => btn.addEventListener('click', async () => {
        await WisecallAPI.apiFetch('/auth/logout', { method: 'POST' });
        window.location.href = '/index.html';
      }));
      // Emails are sent in the language saved on the account, so keep it in step with the toggle.
      document.addEventListener('wisecall:lang-changed', (ev) => {
        WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { language: ev.detail.lang } }).catch(() => {});
      });
      startUnreadBadge();
      // An account that is being deleted: say when, and how to keep it (Settings > Account).
      if (user.deletionRequestedAt && header && !document.querySelector(".deletion-banner")) {
        const until = new Date(new Date(user.deletionRequestedAt).getTime() + 14 * 86400000);
        const bar = document.createElement("div");
        bar.className = "verify-banner deletion-banner";
        bar.innerHTML = `<span>${t("nav.deletionBanner").replace("{date}", WisecallI18n.formatDate(until, { dateStyle: "long" }))}</span> <a href="/settings.html?tab=account">${t("nav.deletionKeep")}</a>`;
        header.insertAdjacentElement("afterend", bar);
      }
      if (!user.emailVerified && location.pathname !== '/verify-email.html' && header) {
        const bar = document.createElement('div');
        bar.className = 'verify-banner';
        bar.innerHTML = `<span>${t('nav.verifyBanner')}</span> <a href="/verify-email.html?redirect=${encodeURIComponent(location.pathname)}">${t('nav.verifyBannerCta')}</a>`;
        header.insertAdjacentElement('afterend', bar);
      }
    } else {
      loggedOut.forEach(show);
      loggedIn.forEach((el) => { el.style.display = 'none'; });
    }
    showLaunchBanner(user);
    return user;
  }

  // Before launch: a slim bar under the header on every page except the home page (its hero already says it) and
  // the admin page (which has its own note). Mentors are told what to do; everyone else can join the waiting list.
  function showLaunchBanner(user) {
    if (!window.WisecallI18n || WisecallI18n.launchMode() !== 'prelaunch') return;
    const path = location.pathname.replace(/^\/ka(?=\/|$)/, '') || '/';
    if (path === '/' || path === '/index.html' || path === '/admin.html' || document.querySelector('.launch-banner')) return;
    const header = document.getElementById('siteHeader');
    if (!header) return;
    const mentor = user && (user.role === 'mentor' || user.role === 'both');
    const bar = document.createElement('div');
    bar.className = 'launch-banner';
    bar.innerHTML = mentor
      ? `<span data-i18n="launch.banner.mentor">${t('launch.banner.mentor')}</span>`
      : `<span data-i18n="launch.banner">${t('launch.banner')}</span> <a href="/index.html#experts" data-i18n="wait.join">${t('wait.join')}</a>`;
    const after = header.nextElementSibling && header.nextElementSibling.classList.contains('verify-banner') ? header.nextElementSibling : header;
    after.insertAdjacentElement('afterend', bar);
  }

  // The unread count on the Inbox link (header, phone menu and a dot on the menu button). Asked for when the page opens, then every 30
  // seconds while the page is visible; the Inbox page sets it straight away after reading something.
  let unreadTimer = null;
  function setUnread(n) {
    const count = Math.max(0, Number(n) || 0);
    document.querySelectorAll('[data-inbox-badge]').forEach((b) => {
      b.hidden = count === 0;
      if (!b.hasAttribute('data-dot')) b.textContent = count > 99 ? '99+' : String(count);
    });
    const label = count ? t('nav.inboxUnread').replace('{n}', count) : t('nav.inbox');
    document.querySelectorAll('.nav-inbox[data-inbox-link]').forEach((a) => a.setAttribute('aria-label', label));
  }
  async function pollUnread() {
    if (document.visibilityState === 'hidden') return;
    try { setUnread((await WisecallAPI.apiFetch('/inbox/unread')).count); } catch (e) { /* signed out or offline: leave it */ }
  }
  function startUnreadBadge() {
    if (unreadTimer) return;
    pollUnread();
    unreadTimer = setInterval(pollUnread, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollUnread(); });
  }

  function showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  window.WisecallNav = { initNav, showToast, setUnread };
})();
