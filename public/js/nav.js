(function () {
  async function initNav() {
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
