// The colour theme: System (the default until somebody chooses: it follows the device), Light or Dark. This file is loaded in the
// <head>, before the page paints, so the right theme is on the page from the first frame (no flash). It is an external script because
// the content-security policy does not allow inline ones. It also is the small API the header's one-click button (WisecallTheme.toggle:
// light <-> dark) and Settings (System, Light or Dark) use: WisecallTheme.get / resolved / set / toggle / adopt.
//   data-theme       on <html>: "light" or "dark", what is really shown
//   data-theme-pref  on <html>: "system", "light" or "dark", what the person chose
(function () {
  var KEY = 'wisecall_theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var BAR = { light: '#FBFAF7', dark: '#15121E' }; // the colour of the browser's address bar on a phone
  var account = null; // the signed-in person, once the header knows who they are

  function read() {
    try { var v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch (e) { /* storage is blocked: System */ }
    return 'system';
  }
  function remember(pref) { try { localStorage.setItem(KEY, pref); } catch (e) { /* the choice lasts for this visit only */ } }
  function resolve(pref) { return pref === 'system' ? (media && media.matches ? 'dark' : 'light') : pref; }

  // The address-bar colour follows the page's theme. In System mode the two <meta> tags with media queries do it by themselves;
  // once somebody chooses Light or Dark by hand, one more tag (first in the list, so it wins) says which.
  function bar(pref, theme) {
    var el = document.getElementById('themeColorOverride');
    if (pref === 'system') { if (el && el.parentNode) el.parentNode.removeChild(el); return; }
    if (!el) {
      el = document.createElement('meta');
      el.name = 'theme-color';
      el.id = 'themeColorOverride';
      document.head.insertBefore(el, document.head.firstChild);
    }
    el.content = BAR[theme];
  }

  var timer = null;
  function apply(pref, animate) {
    var theme = resolve(pref);
    var was = root.getAttribute('data-theme');
    // A short colour fade (0.2s) when somebody switches (never on the first paint, never with reduced motion: see style.css).
    if (animate && was && was !== theme) {
      root.classList.add('theme-switching');
      clearTimeout(timer);
      timer = setTimeout(function () { root.classList.remove('theme-switching'); }, 260);
    }
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-pref', pref);
    bar(pref, theme);
    if (document.head) document.dispatchEvent(new CustomEvent('wisecall:theme-changed', { detail: { pref: pref, theme: theme, changed: was !== theme } }));
  }

  apply(read(), false);

  // Motion (public/js/motion.js): "motion" on <html> lets a section wait below the fold until it is scrolled to. Never with reduced
  // motion, and set here, before the first paint, so nothing is drawn and then hidden again.
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!calm) root.classList.add('motion');
  // A browser without cross-document view transitions: the page's content fades in lightly as it opens instead (style.css).
  if (!calm && !('CSSViewTransitionRule' in window)) root.classList.add('page-fade');

  // System mode follows the device live (the evening switch of a phone, for example).
  var follow = function () { if (root.getAttribute('data-theme-pref') === 'system') apply('system', true); };
  if (media) { if (media.addEventListener) media.addEventListener('change', follow); else if (media.addListener) media.addListener(follow); }
  // Another tab of the same browser changed it.
  window.addEventListener('storage', function (ev) { if (ev.key === KEY) apply(read(), true); });

  function save(pref) {
    if (!account || !window.fetch) return;
    fetch('/api/me', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, body: JSON.stringify({ theme: pref }) }).catch(function () { /* the device still remembers it */ });
  }

  window.WisecallTheme = {
    get: function () { return root.getAttribute('data-theme-pref') || 'system'; },
    resolved: function () { return root.getAttribute('data-theme') || 'light'; },
    // A person chooses. Kept on this device and, when signed in, on the account (so it follows them to other devices).
    set: function (pref) {
      if (pref !== 'system' && pref !== 'light' && pref !== 'dark') return;
      remember(pref);
      apply(pref, true);
      save(pref);
    },
    // The header's button: one click to the other one (light <-> dark), remembered like any choice.
    toggle: function () { this.set(this.resolved() === 'dark' ? 'light' : 'dark'); },
    // The header found out who is signed in: what their account says wins over this device's memory.
    adopt: function (user) {
      account = user || null;
      if (user && (user.theme === 'system' || user.theme === 'light' || user.theme === 'dark') && user.theme !== this.get()) { remember(user.theme); apply(user.theme, false); }
    }
  };
})();
