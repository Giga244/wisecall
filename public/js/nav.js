(function () {
  // Under ~720px the header links are hidden; this adds an accessible menu button that shows them.
  function initMenu() {
    const nav = document.querySelector('header.nav');
    const links = nav && nav.querySelector('.nav-links');
    if (!links || nav.querySelector('.nav-toggle')) return;
    const t = (window.WisecallI18n && window.WisecallI18n.t) || (k => k);
    if (!links.id) links.id = 'navLinks';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-toggle';
    btn.setAttribute('aria-controls', links.id);
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg class="icon-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>' +
      '<svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    const label = () => btn.setAttribute('aria-label', t('nav.menu'));
    label();
    document.addEventListener('wisecall:lang-changed', label);
    nav.querySelector('.nav-inner').appendChild(btn);

    const setOpen = (open, returnFocus) => {
      nav.classList.toggle('menu-open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (!open && returnFocus) btn.focus();
    };
    btn.addEventListener('click', () => setOpen(!nav.classList.contains('menu-open')));
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && nav.classList.contains('menu-open')) setOpen(false, true); });
    document.addEventListener('click', (ev) => { if (!nav.contains(ev.target)) setOpen(false); });
    links.addEventListener('click', (ev) => { if (ev.target.closest('a')) setOpen(false); });
    window.matchMedia('(min-width: 721px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });
  }
  // Runs once per page, however many scripts ask for it (the header script and the page's own script both do).
  let navPromise = null;
  function initNav() {
    if (!navPromise) navPromise = setUpNav();
    return navPromise;
  }
  async function setUpNav() {
    initMenu();
    const loggedOutEl = document.getElementById('navLoggedOut');
    const loggedInEl = document.getElementById('navLoggedIn');
    let user = null;
    try {
      const data = await WisecallAPI.apiFetch('/me');
      user = data.user;
    } catch (e) { /* not logged in */ }

    if (user) {
      if (loggedOutEl) loggedOutEl.style.display = 'none';
      if (loggedInEl) loggedInEl.style.display = 'flex';
      if (user.isAdmin && loggedInEl && !loggedInEl.querySelector('.admin-link')) {
        const a = document.createElement('a');
        a.href = '/admin.html'; a.className = 'btn btn-ghost admin-link';
        a.setAttribute('data-i18n', 'nav.admin'); a.textContent = (window.WisecallI18n && window.WisecallI18n.t('nav.admin')) || 'Admin';
        loggedInEl.insertBefore(a, loggedInEl.firstChild);
      }
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          await WisecallAPI.apiFetch('/auth/logout', { method: 'POST' });
          window.location.href = '/index.html';
        });
      }
      // Emails are sent in the language saved on the account, so keep it in step with the toggle.
      document.addEventListener('wisecall:lang-changed', (ev) => {
        WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { language: ev.detail.lang } }).catch(() => {});
      });
      if (!user.emailVerified && location.pathname !== '/verify-email.html') {
        const nav = document.querySelector('header.nav');
        const t = (window.WisecallI18n && window.WisecallI18n.t) || (k => k);
        if (nav) {
          const bar = document.createElement('div');
          bar.className = 'verify-banner';
          bar.innerHTML = `<span>${t('nav.verifyBanner')}</span> <a href="/verify-email.html?redirect=${encodeURIComponent(location.pathname)}">${t('nav.verifyBannerCta')}</a>`;
          nav.insertAdjacentElement('afterend', bar);
        }
      }
    } else {
      if (loggedOutEl) loggedOutEl.style.display = 'flex';
      if (loggedInEl) loggedInEl.style.display = 'none';
    }
    return user;
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

  window.WisecallNav = { initNav, showToast };
})();
