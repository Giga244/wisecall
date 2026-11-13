// The same header on every page: skip link, logo, main links, language switch, log in / account buttons, and below
// 1024px a menu button that opens a full-height panel (built here, opened by nav.js).
// Loaded as the first script inside <body>, so it puts the header exactly where the script tag is.
(function () {
  // The header's logo (docs/CLAUDE-CODE-NEW-HOME.md 1): Jikhva peeks out from behind the "ll" of "Wisecall.". The letters are the brand
  // wordmark's own outlines (public/brand/wisecall-logo.svg, never redrawn), drawn over Jikhva's head with a thin outline in the page's
  // colour, so only the letters cover him and no box does. Ink letters on paper in light mode, light letters on the dark page in dark mode
  // (style.css .jlogo): one drawing for both. The viewBox leaves room above the letters for the horns.
  // The footer, emails, the payment page, receipts and the favicon keep the plain "Wisecall." logo.
  const JIKHVA = '<svg class="jlogo" viewBox="112 -84 362 166" width="157" height="72" role="img" aria-label="Wisecall" focusable="false">'
    + '<title>Wisecall</title>'
    + '<image class="jlogo-head" href="/brand/jikhva-head.webp" x="318" y="-81" width="144" height="122.4" preserveAspectRatio="xMidYMid meet"/>'
    + '<path class="jlogo-word" d="M147.17 76L130.17 76L119.48 27.01L132.55 27.01L139.00 65.91L139.82 65.91L147.91 27.01L162.98 27.01L171.22 65.91L172.03 65.91L178.49 27.01L190.81 27.01L180.05 76L163.42 76L155.63 37.18L154.89 37.18L147.17 76ZM207.36 76L195.41 76L195.41 36.81L207.36 36.81L207.36 76ZM201.43 31.32L201.43 31.32Q198.01 31.32 196.19 29.87Q194.37 28.42 194.37 25.75L194.37 25.75Q194.37 22.93 196.19 21.48Q198.01 20.04 201.43 20.04L201.43 20.04Q204.91 20.04 206.73 21.48Q208.55 22.93 208.55 25.68L208.55 25.68Q208.55 28.42 206.73 29.87Q204.91 31.32 201.43 31.32ZM231.19 77.04L231.19 77.04Q227.25 77.04 224.06 76.33Q220.87 75.63 218.50 74.29Q216.12 72.96 214.60 71.06Q213.08 69.17 212.48 66.87L212.48 66.87L221.39 62.94Q221.91 64.20 223.21 65.50Q224.51 66.80 226.70 67.61Q228.89 68.43 232.00 68.43L232.00 68.43Q234.97 68.43 236.64 67.58Q238.31 66.72 238.31 65.09L238.31 65.09Q238.31 63.90 237.39 63.20Q236.46 62.49 234.60 61.93Q232.75 61.38 230.00 60.86L230.00 60.86Q227.18 60.27 224.29 59.49Q221.39 58.71 218.87 57.33Q216.34 55.96 214.82 53.70Q213.30 51.43 213.30 47.94L213.30 47.94Q213.30 44.31 215.23 41.60Q217.16 38.89 220.98 37.33Q224.80 35.77 230.30 35.77L230.30 35.77Q235.20 35.77 238.91 37.03Q242.62 38.30 245.10 40.63Q247.59 42.97 248.56 46.24L248.56 46.24L238.98 49.65Q238.61 48.02 237.46 46.83Q236.31 45.64 234.57 45.01Q232.82 44.38 230.45 44.38L230.45 44.38Q227.55 44.38 225.96 45.27Q224.36 46.16 224.36 47.65L224.36 47.65Q224.36 48.83 225.44 49.61Q226.51 50.39 228.52 50.91Q230.52 51.43 233.27 52.03L233.27 52.03Q236.16 52.62 239.02 53.40Q241.88 54.18 244.21 55.48Q246.55 56.78 247.93 58.89Q249.30 61.01 249.30 64.35L249.30 64.35Q249.30 68.28 247.22 71.14Q245.14 74.00 241.10 75.52Q237.05 77.04 231.19 77.04ZM273.05 77.04L273.05 77.04Q268.15 77.04 264.29 75.74Q260.43 74.44 257.72 71.92Q255.01 69.39 253.60 65.68Q252.19 61.97 252.19 57.15L252.19 57.15Q252.19 52.47 253.57 48.54Q254.94 44.60 257.50 41.75Q260.06 38.89 263.81 37.33Q267.56 35.77 272.23 35.77L272.23 35.77Q276.98 35.77 280.58 37.29Q284.18 38.81 286.52 41.78Q288.86 44.75 289.97 49.02Q291.08 53.29 290.71 58.78L290.71 58.78L263.70 59.00Q264.07 63.53 266.29 65.76L266.29 65.76Q268.89 68.50 272.97 68.50L272.97 68.50Q274.98 68.50 276.31 67.95Q277.65 67.39 278.50 66.54Q279.36 65.68 279.84 64.64Q280.32 63.60 280.62 62.64L280.62 62.64L291.01 64.87Q290.42 67.61 289.12 69.84Q287.82 72.07 285.63 73.70Q283.44 75.33 280.36 76.19Q277.28 77.04 273.05 77.04ZM263.99 52.77L263.99 52.77L279.80 52.62Q279.80 50.76 279.21 49.35L279.21 49.35Q278.24 47.05 276.39 45.98Q274.53 44.90 272.38 44.90L272.38 44.90Q269.78 44.90 267.82 46.31Q265.85 47.72 264.74 50.39L264.74 50.39Q264.29 51.43 263.99 52.77ZM314.98 77.04L314.98 77.04Q309.94 77.04 306.08 75.63Q302.22 74.22 299.62 71.58Q297.02 68.95 295.65 65.24Q294.28 61.53 294.28 56.93L294.28 56.93Q294.28 52.17 295.65 48.32Q297.02 44.46 299.62 41.64Q302.22 38.81 306.00 37.29Q309.79 35.77 314.69 35.77L314.69 35.77Q319.59 35.77 323.15 37.33Q326.71 38.89 328.98 41.71Q331.24 44.53 332.06 48.24L332.06 48.24L321.00 51.95Q320.77 49.50 319.81 47.94Q318.84 46.39 317.32 45.68Q315.80 44.98 314.02 44.98L314.02 44.98Q312.16 44.98 310.75 45.72Q309.34 46.46 308.38 47.94Q307.41 49.43 306.89 51.54Q306.37 53.66 306.37 56.41L306.37 56.41Q306.37 60.34 307.38 62.97Q308.38 65.61 310.35 66.94Q312.31 68.28 315.13 68.28L315.13 68.28Q318.03 68.28 319.66 67.09Q321.29 65.91 322.04 64.16Q322.78 62.42 322.93 60.71L322.93 60.71L333.32 63.01Q333.02 65.76 331.87 68.32Q330.72 70.88 328.49 72.85Q326.27 74.81 322.96 75.93Q319.66 77.04 314.98 77.04ZM346.60 77.04L346.60 77.04Q343.34 77.04 340.81 75.74Q338.29 74.44 336.88 71.95Q335.47 69.47 335.47 65.91L335.47 65.91Q335.47 62.57 336.77 60.38Q338.07 58.19 340.55 56.89Q343.04 55.59 346.53 54.74Q350.02 53.88 354.47 53.21L354.47 53.21Q356.62 52.84 358.07 52.51Q359.52 52.17 360.26 51.43Q361.00 50.69 361.00 49.28L361.00 49.28Q361.00 47.42 359.67 46.09Q358.33 44.75 355.36 44.75L355.36 44.75Q353.28 44.75 351.61 45.49Q349.94 46.24 348.76 47.65Q347.57 49.06 346.97 51.06L346.97 51.06L336.43 47.94Q337.40 44.83 339.14 42.53Q340.89 40.23 343.34 38.70Q345.79 37.18 348.94 36.48Q352.10 35.77 355.66 35.77L355.66 35.77Q361.60 35.77 365.34 37.66Q369.09 39.56 370.91 43.53Q372.73 47.50 372.73 53.73L372.73 53.73L372.73 59.75Q372.73 62.42 372.84 65.13Q372.95 67.84 373.14 70.54Q373.32 73.25 373.62 76L373.62 76L363.08 76Q362.78 74.29 362.49 71.88Q362.19 69.47 362.04 66.94L362.04 66.94L360.63 66.94Q359.59 69.77 357.62 72.10Q355.66 74.44 352.87 75.74Q350.09 77.04 346.60 77.04ZM352.02 68.58L352.02 68.58Q353.36 68.58 354.73 68.10Q356.10 67.61 357.36 66.76Q358.63 65.91 359.67 64.64Q360.70 63.38 361.22 61.90L361.22 61.90L361.08 57.22Q360.41 57.59 359.59 57.82L359.59 57.82Q357.88 58.34 356.14 58.63Q354.40 58.93 352.73 59.26Q351.06 59.60 349.76 60.12Q348.46 60.64 347.72 61.53Q346.97 62.42 346.97 63.98L346.97 63.98Q346.97 66.05 348.38 67.32Q349.79 68.58 352.02 68.58ZM391.80 76L380.08 76L380.08 22.56L391.80 22.56L391.80 76ZM411.32 76L399.60 76L399.60 22.56L411.32 22.56L411.32 76Z"/>'
    + '<circle class="jlogo-dot" cx="424.1" cy="69.4" r="6.6"/></svg>';
  window.WisecallBrand = window.WisecallBrand || {
    logoHtml(opts) {
      if (opts && opts.full) {
        // (the footer: the plain logo, the one made for dark backgrounds on a dark page)
        const dark = document.documentElement.dataset.theme === 'dark';
        // (the addresses written out, so the server adds their version: server/assets.js)
        if (dark) return '<img class="logo-img" src="/brand/wisecall-logo-on-dark-transparent.svg" alt="Wisecall" width="149" height="36" decoding="async">';
        return '<img class="logo-img" src="/brand/wisecall-logo.svg" alt="Wisecall" width="149" height="36" decoding="async">';
      }
      return JIKHVA;
    }
  };
  const here = window.location.pathname.replace(/^\/ka(?=\/|$)/, '') || '/'; // (the Georgian address /ka/... is the same page)
  const onHome = here === '/' || here === '/index.html';
  const link = (l) => l.href || (onHome ? '' : '/index.html') + l.hash; // on the home page "How it works" just scrolls; Browse and the mentors' page are their own

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
      'nav.language': 'Language', 'nav.login': 'Log in', 'nav.signup': 'Sign up', 'nav.cta.join': 'Join', 'nav.cta.search': 'Find an expert', 'nav.inbox': 'Inbox', 'nav.dashboard': 'Dashboard', 'nav.settings': 'Settings',
      'nav.logout': 'Log out', 'nav.admin': 'Admin', 'nav.menu': 'Menu', 'nav.menuClose': 'Close menu', 'theme.toDark': 'Switch to dark mode', 'theme.toLight': 'Switch to light mode',
      'nav.continueApp': 'Continue your application', 'nav.continueStep': 'Continue your application · {n} of 5 done', 'nav.continueShort': 'Application · {n}/5',
      'nav.inReview': 'Application in review', 'nav.inReviewShort': 'In review', 'nav.idLeft': 'Application · 4/5 · ID left', 'nav.idLeftShort': '4/5 · ID left'
    },
    ka: {
      'a11y.skip': 'გადასვლა შინაარსზე', 'nav.how': 'როგორ მუშაობს', 'nav.browse': 'ექსპერტები', 'nav.becomeMentor': 'გახდი მენტორი', 'footer.faq': 'კითხვები',
      'nav.language': 'ენა', 'nav.login': 'შესვლა', 'nav.signup': 'რეგისტრაცია', 'nav.cta.join': 'ჩაეწერე', 'nav.cta.search': 'იპოვე ექსპერტი', 'nav.inbox': 'შემოსულები', 'nav.dashboard': 'პირადი კაბინეტი', 'nav.settings': 'პარამეტრები',
      'nav.logout': 'გასვლა', 'nav.admin': 'ადმინი', 'nav.menu': 'მენიუ', 'nav.menuClose': 'მენიუს დახურვა', 'theme.toDark': 'მუქ რეჟიმზე გადართვა', 'theme.toLight': 'ღია რეჟიმზე გადართვა',
      'nav.continueApp': 'განაცხადის გაგრძელება', 'nav.continueStep': 'განაცხადის გაგრძელება · დასრულებულია {n} / 5', 'nav.continueShort': 'განაცხადი · {n}/5',
      'nav.inReview': 'განაცხადი განხილვაშია', 'nav.inReviewShort': 'განხილვაშია', 'nav.idLeft': 'განაცხადი · 4/5 · დარჩა პირადობა', 'nav.idLeftShort': '4/5 · დარჩა პირადობა'
    }
  };
  const w = (key) => WORDS[LANG][key] || WORDS.en[key];

  // "Become a mentor" for a visitor, among the main links (to the mentors' page, which explains it and leads on). A signed-in person gets
  // their own button next to Dashboard and Settings instead (the mentor button, below).
  // The rest of the site's links, at the bottom of the menu panel (the home page's footer is short: docs/CLAUDE-CODE-COMPACT-HOME.md).
  const MORE = [['/faq.html#faq-payments', 'footer.pricing'], ['/about.html', 'footer.about'], ['/contact.html', 'footer.contact'], ['/how-we-verify.html', 'hv.title'],
    ['/help.html', 'help.title'], ['/answers', 'answers.title'], ['/terms.html', 'footer.terms'], ['/privacy.html', 'footer.privacy']];
  const LINKS = [
    { hash: '#how', key: 'nav.how', extra: true },
    { href: '/experts.html', key: 'nav.browse' },
    { href: '/become-a-mentor.html', key: 'nav.becomeMentor', mentor: true },
    { href: '/faq.html', key: 'footer.faq', extra: true, faq: true }
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

  // Signed in? Next to the login cookie the server leaves a small readable hint (wc_authed: "1", "apply" or "apply<next step>-<steps done>" such as "apply2-2", "sent", "idleft",
  // "mentor", or "admin"; see server/auth.js), so the header and the menu panel are drawn as they will stay from the first frame: a
  // signed-in person never sees the signed-out menu first. nav.js still asks the server, and only if the two disagree (a session that ran
  // out, say) does the header change, with a fade.
  const signedIn = (() => { try { return (/(?:^|;\s*)wc_authed=(1|admin|mentor|sent|idleft|apply(?:[1-5](?:-[0-5])?)?)(?:;|$)/.exec(document.cookie) || [])[1] || ''; } catch (e) { return ''; } })();
  const off = (yes) => (yes ? ' style="display:none"' : '');
  const shown = LINKS.filter((l) => !l.mentor || signedIn === '');

  // The mentor button, by where this person is on the way to becoming a mentor (docs/CLAUDE-CODE-MENTOR-BUTTON-SIGNED-IN.md):
  //   out     signed out: "Become a mentor" among the main links (above)
  //   asker   signed in, not applying: "Become a mentor" -> /apply.html
  //   draft   an application started and not sent: "Continue your application · 2 of 5 done" ("Application · 2/5" where the header is narrow)
  //           -> /apply.html?step=N, the first unfinished step (docs/CLAUDE-CODE-APPLY-PROGRESS.md)
  //   sent    sent, waiting for review: "Application in review" (a status, linking to /apply.html)
  //   idleft  steps 1-4 done (sent or not) and the ID check is what is left: "Application · 4/5 · ID left", coral, to step 5
  //           (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md 3)
  //   none    a mentor or an admin: nothing extra
  // The page's <html> carries the state from the first frame (data-mentor-state), so the home page's button never jumps (style.css);
  // nav.js asks the server and draws it again when it differs, and after a language switch.
  const MENTOR = (() => {
    if (!signedIn) return { state: 'out', step: null };
    if (signedIn === '1') return { state: 'asker', step: null };
    const draft = /^apply(?:([1-5])(?:-([0-5]))?)?$/.exec(signedIn);
    if (draft) return { state: 'draft', step: draft[1] ? Number(draft[1]) : null, done: draft[2] !== undefined ? Number(draft[2]) : null };
    if (signedIn === 'idleft') return { state: 'idleft', step: 5, done: 4 };
    return { state: signedIn === 'sent' ? 'sent' : 'none', step: null };
  })();
  window.WisecallMentorButton = {
    href: (m) => (m.state === 'idleft' ? '/apply.html?step=5' : (m.state === 'draft' && m.step ? `/apply.html?step=${m.step}` : '/apply.html')),
    // say: (key) -> words. short: the words for a narrow header.
    text(m, say, short) {
      if (m.state === 'asker') return say('nav.becomeMentor');
      // (how much is done, not the step: "2/5" means two of the five steps are done)
      if (m.state === 'draft') return Number.isInteger(m.done) ? say(short ? 'nav.continueShort' : 'nav.continueStep').replace('{n}', m.done) : say('nav.continueApp');
      if (m.state === 'sent') return say(short ? 'nav.inReviewShort' : 'nav.inReview');
      if (m.state === 'idleft') return say(short ? 'nav.idLeftShort' : 'nav.idLeft');
      return '';
    },
    // where: 'nav' (the header), 'menu' (the menu panel). '' for nobody.
    html(m, where, say) {
      if (!['asker', 'draft', 'sent', 'idleft'].includes(m.state)) return '';
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const cls = m.state === 'sent'
        ? (where === 'nav' ? 'nav-mentor mentor-status' : 'btn btn-ghost btn-lg btn-block mm-mentor mentor-status')
        : m.state === 'idleft'
          ? (where === 'nav' ? 'btn btn-primary nav-mentor' : 'btn btn-primary btn-lg btn-block mm-mentor')
          : (where === 'nav' ? 'btn btn-outline nav-mentor' : 'btn btn-outline btn-lg btn-block mm-mentor');
      const full = esc(this.text(m, say, false));
      const words = where === 'nav' ? `<span class="nm-full">${full}</span><span class="nm-short">${esc(this.text(m, say, true))}</span>` : full;
      return `<a href="${this.href(m)}" class="${cls}" data-mentor-cta="${where}" data-state="${m.state}">${words}</a>`;
    }
  };
  document.documentElement.dataset.mentorState = MENTOR.state;
  if (MENTOR.step) document.documentElement.dataset.mentorStep = String(MENTOR.step);
  const cls = (l, extra) => [l.extra && extra ? `nl-extra${l.faq ? ' nl-faq' : ''}` : '', l.mentor ? 'nl-mentor' : ''].filter(Boolean).join(' ');
  const adminLink = (cls) => (signedIn === 'admin' ? `<a href="/admin.html" class="${cls} admin-link" data-i18n="nav.admin">${w('nav.admin')}</a>` : '');

  // The home page's own button, from 768px (docs/CLAUDE-CODE-COMPACT-HOME.md): to the waiting list before launch (the server leaves
  // #homePrelaunch in the page then), to the search after; in the first frame, so nothing moves. Only for visitors who are not signed in.
  const homeCtaKey = document.getElementById('homePrelaunch') ? 'nav.cta.join' : 'nav.cta.search';
  const homeCta = document.body.classList.contains('home') ? `<a href="#heroTitle" class="btn btn-primary nav-cta" data-i18n="${homeCtaKey}">${w(homeCtaKey)}</a>` : '';
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
            ${homeCta}
            <a href="/login.html" class="btn btn-ghost" data-i18n="nav.login">${w('nav.login')}</a>
            <a href="/signup.html" class="btn btn-primary" data-i18n="nav.signup">${w('nav.signup')}</a>
          </div>
          <div class="nav-actions" id="navLoggedIn"${off(!signedIn)}>
            ${WisecallMentorButton.html(MENTOR, 'nav', w)}
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
        <nav class="mm-more" aria-label="More" data-i18n-aria="nav.more">
          ${MORE.map(([href, key]) => `<a href="${href}" data-i18n="${key}">${w(key) || ''}</a>`).join('')}
        </nav>
        <div class="mm-lang">${langSwitch('mm-lang-toggle')}</div>
        ${themeRow}
        <div class="mm-actions" id="mmLoggedOut"${off(signedIn)}>
          <a href="/signup.html" class="btn btn-primary btn-lg btn-block" data-i18n="nav.signup">${w('nav.signup')}</a>
          <a href="/login.html" class="btn btn-outline btn-lg btn-block" data-i18n="nav.login">${w('nav.login')}</a>
        </div>
        <div class="mm-actions" id="mmLoggedIn"${off(!signedIn)}>
          ${WisecallMentorButton.html(MENTOR, 'menu', w)}
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
