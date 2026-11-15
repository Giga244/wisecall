(function () {
  const STORAGE_KEY = 'wisecall_lang';
  const OLD_STORAGE_KEY = 'sagely_lang';

  // Carry a language chosen before the rename over to the new key.
  try {
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old !== null) {
      if (!localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, old);
      localStorage.removeItem(OLD_STORAGE_KEY);
    }
  } catch (e) { /* storage unavailable */ }
  let currentDict = {};

  // Public settings from the server (fee, deadline, price range, contact email, social links), fetched
  // once and shared by every script on the page. If the request fails the defaults are used.
  const DEFAULT_CONFIG = { answerDeadlineDays: 7, platformFeePercent: 20, mentorSharePercent: 80, priceMin: 5, priceMax: 2000, questionMin: 50, questionMax: 4000, answerMin: 150, answerMax: 8000, unpaidAttemptDays: 7, currency: 'gel', contactEmail: null, social: {}, launchMode: 'live' };
  let configPromise = null;
  let loadedConfig = DEFAULT_CONFIG;
  function getConfig() {
    if (!configPromise) {
      configPromise = fetch('/api/config').then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((c) => { loadedConfig = Object.assign({}, DEFAULT_CONFIG, c); return loadedConfig; });
    }
    return configPromise;
  }
  // "live" or "prelaunch" (buyers cannot pay yet). Known once initI18n() has finished; "live" before that.
  const launchMode = () => loadedConfig.launchMode;
  // True only on a developer's computer (the server does not send the setting at all in production).
  const devMode = () => Boolean(loadedConfig.devMode);
  // False while the site runs without its ID-check provider (before launch): the ID-check step then says "ID checks open soon".
  const idChecksOpen = () => loadedConfig.idChecksOpen !== false;
  // Live sessions switched on (LIVE_SESSIONS=on). Until the server says so, nothing about them is shown.
  const liveSessions = () => loadedConfig.liveSessions === true;

  // Texts may contain {answerDays}, {feePct}, {sharePct}, {priceMin} and {priceMax}; they are filled in
  // from the server's settings so the page never disagrees with what the server really does.
  let vars = {};
  function fillVars(s) {
    return typeof s === 'string' ? s.replace(/\{(answerDays|holdDays|disputeDays|feePct|sharePct|priceMin|priceMax|questionMin|questionMax|answerMin|answerMax|unpaidDays|payoutMin|support)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : s;
  }
  function setVarsFrom(cfg) {
    vars = {
      answerDays: cfg.answerDeadlineDays, holdDays: cfg.payoutHoldDays === undefined ? 7 : cfg.payoutHoldDays, disputeDays: cfg.disputeDays === undefined ? 7 : cfg.disputeDays,
      feePct: cfg.platformFeePercent, sharePct: cfg.mentorSharePercent, priceMin: cfg.priceMin, priceMax: cfg.priceMax, payoutMin: cfg.payoutMinGel === undefined ? 100 : cfg.payoutMinGel,
      support: cfg.contactEmail || `${location.host}/contact.html`, // (where the generic error message says to write)
      questionMin: cfg.questionMin, questionMax: cfg.questionMax, answerMin: cfg.answerMin, answerMax: cfg.answerMax, unpaidDays: cfg.unpaidAttemptDays
    };
  }

  // A Georgian address (/ka/...) is always Georgian, and remembers it; otherwise the saved choice, then the browser's language.
  const KA_PATH = /^\/ka(\/|$)/;
  const onKaPath = () => KA_PATH.test(location.pathname);
  // The page's address without the /ka prefix (what scripts compare against).
  const path = () => location.pathname.replace(/^\/ka(?=\/|$)/, '') || '/';
  function getLang() {
    if (onKaPath()) { try { localStorage.setItem(STORAGE_KEY, 'ka'); } catch (e) { /* storage unavailable */ } return 'ka'; }
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage unavailable */ }
    if (saved) return saved;
    return navigator.language && navigator.language.toLowerCase().startsWith('ka') ? 'ka' : 'en';
  }
  // A date (and time) in the page's language. Browsers without Georgian locale data would show English month names, so Georgian is
  // then written by hand ("5 ოქტომბერი 2026, 14:30"). options: the Intl options the page wants (dateStyle, timeStyle, day, month, ...).
  const KA_MONTHS = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
  let kaDates = null;
  const hasKaDates = () => {
    if (kaDates === null) { try { kaDates = Intl.DateTimeFormat.supportedLocalesOf(['ka']).length > 0; } catch (e) { kaDates = false; } }
    return kaDates;
  };
  const pad2 = (n) => String(n).padStart(2, '0');
  function formatDate(date, options) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const o = options || { day: 'numeric', month: 'long', year: 'numeric' };
    const lang = getLang();
    if (lang !== 'ka' || hasKaDates()) return d.toLocaleString(lang === 'ka' ? 'ka-GE' : 'en-GB', o);
    const whole = Boolean(o.dateStyle);
    const day = [whole || o.day ? d.getDate() : null, whole || o.month ? KA_MONTHS[d.getMonth()] : null, whole || o.year ? d.getFullYear() : null]
      .filter((x) => x !== null).join(' ');
    const time = o.timeStyle || o.hour ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}${o.second ? ':' + pad2(d.getSeconds()) : ''}` : '';
    return [day, time].filter(Boolean).join(', ');
  }

  // The page's title in the language (meta.<page>.title), for pages whose title is the same for everyone.
  function applyTitle(dict) {
    const p = path();
    const key = p === '/' || p === '/index.html' ? 'index' : (/^\/([\w-]+)\.html$/.exec(p) || [])[1];
    if (key && dict[`meta.${key}.title`]) document.title = dict[`meta.${key}.title`];
  }

  // A page can name extra dictionaries: <meta name="wisecall-i18n-extra" content="admin"> also loads /i18n/admin-<lang>.json. The admin
  // texts are kept out of the public dictionaries because the server only sends them to admins.
  function extraDictionaries() {
    const meta = document.querySelector('meta[name="wisecall-i18n-extra"]');
    return meta ? meta.content.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }
  // The niche names come from the server (an admin can add niches), so "niche.<key>" works for every niche in both languages.
  async function loadDict(lang) {
    const extra = extraDictionaries().map((name) => fetch(`/i18n/${name}-${lang}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
    const [cfg, ...parts] = await Promise.all([getConfig(), fetch(`/i18n/${lang}.json`).then((r) => r.json()), ...extra]);
    const dict = Object.assign({}, ...parts);
    (cfg.niches || []).forEach((n) => { dict['niche.' + n.key] = lang === 'ka' ? n.ka : n.en; });
    return dict;
  }
  // The niches the site offers, in their order: [{ key, en, ka, icon, regulated }]. Known once initI18n() has finished.
  const niches = () => loadedConfig.niches || [];
  const popularFields = () => loadedConfig.popularFields || []; // (the 6 fields people wait for most: server/waitlist.js)
  // A niche's name in the current language; "Other" shows the mentor's own words when there are some.
  const nicheName = (key, custom) => (key === 'other' && custom ? custom : t('niche.' + key));
  // "Your field": what a mentor wrote about their field, shown instead of the category (older profiles have only the category).
  // The 16 fields (their chips and counts come from /api/categories), a name in the page's language, and the field an old category's mentors are in.
  const fields = () => loadedConfig.fields || [];
  const nameIn = (x) => (x ? (getLang() === 'ka' ? x.ka : x.en) : '');
  const fieldOfNiche = (key) => (fields().some((f) => f.id === key) ? key : (loadedConfig.fieldOfNiche || {})[key] || null);
  const fieldName = (m) => (m && m.customNiche) || (m && m.niche ? nicheName(m.niche) : '');

  function applyDict(dict) {
    currentDict = dict;
    // Before launch some texts are different: data-i18n-prelaunch names the text to use instead of data-i18n.
    const pre = launchMode() === 'prelaunch';
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = (pre && el.getAttribute('data-i18n-prelaunch')) || el.getAttribute('data-i18n');
      if (dict[key] !== undefined) el.textContent = fillVars(dict[key]);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (dict[key] !== undefined) el.placeholder = fillVars(dict[key]);
    });
    // Accessible names and alternative text that are not visible text.
    [['data-i18n-aria', 'aria-label'], ['data-i18n-title', 'title'], ['data-i18n-alt', 'alt']].forEach(([attr, target]) => {
      document.querySelectorAll(`[${attr}]`).forEach(el => {
        const key = el.getAttribute(attr);
        if (dict[key] !== undefined) el.setAttribute(target, fillVars(dict[key]));
      });
    });
  }

  function t(key) {
    // The generic error says what to do (try again, or write to support) and, after a server error, its short reference
    // (docs/CLAUDE-CODE-UNKNOWN-ERROR.md 4).
    if (key === 'toast.error') {
      const ref = window.WisecallAPI && window.WisecallAPI.lastErrorRef ? window.WisecallAPI.lastErrorRef() : null;
      return fillVars(currentDict[key] || key) + (ref && currentDict['toast.errorRef'] ? currentDict['toast.errorRef'].replace('{ref}', ref) : '');
    }
    return fillVars(currentDict[key] || key);
  }

  // In Georgian, links lead to the Georgian pages (/answers -> /ka/answers): every page has a /ka address. Files, the API and addresses
  // already in Georgian stay as they are. The server writes the links of the page it sends the same way (server/pages.js kaHref); this
  // covers the links the scripts draw (the header, the footer, cards), now and whenever they draw more.
  const KA_SKIP = /^\/(?:ka(?:[/?#]|$)|api\/|js\/|css\/|fonts\/|img\/|images\/|brand\/|uploads?\/|mock-|auth\/)/;
  function kaHref(href) {
    if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//') || KA_SKIP.test(href)) return href;
    const p = href.split(/[?#]/)[0];
    if (/\.[a-z0-9]+$/i.test(p) && !/\.html$/i.test(p)) return href;
    return '/ka' + href;
  }
  function kaLinks(root) {
    const fix = (a) => { const h = a.getAttribute('href'); const k = kaHref(h); if (k !== h) a.setAttribute('href', k); };
    if (root.nodeType !== 1) return;
    if (root.matches('a[href]')) fix(root);
    root.querySelectorAll('a[href]').forEach(fix);
  }
  let linkWatch = null;
  function watchLinks() {
    if (linkWatch || !document.documentElement) return;
    kaLinks(document.documentElement);
    linkWatch = new MutationObserver((list) => list.forEach((m) => {
      if (m.type === 'attributes') kaLinks(m.target); else m.addedNodes.forEach(kaLinks);
    }));
    linkWatch.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
  }

  async function setLang(lang) {
    // On a Georgian address, English is the same page without /ka.
    if (lang !== 'ka' && onKaPath()) {
      try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* storage unavailable */ }
      location.href = path() + location.search + location.hash;
      return currentDict;
    }
    localStorage.setItem(STORAGE_KEY, lang);
    if (lang === 'ka' && !onKaPath() && document.querySelector('meta[name="wisecall-server-lang"]')) {
      location.href = '/ka' + path() + location.search + location.hash;
      return currentDict;
    }
    document.documentElement.lang = lang;
    const dict = await loadDict(lang);
    applyDict(dict);
    applyTitle(dict);
    if (lang === 'ka') watchLinks();
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    document.dispatchEvent(new CustomEvent('wisecall:lang-changed', { detail: { lang, dict } }));
    return dict;
  }

  // Resolves once the first language has been loaded and applied, so other scripts can wait for real texts.
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });

  async function initI18n() {
    const lang = getLang();
    // Georgian chosen earlier, on the English address of a page the server writes in its language (the help centre, answers, a field's
    // page): go to its Georgian address, or the page would be English inside a Georgian header.
    if (lang === 'ka' && !onKaPath() && document.querySelector('meta[name="wisecall-server-lang"]')) {
      location.replace('/ka' + path() + location.search + location.hash);
      return new Promise(() => {}); // (the Georgian page is on its way)
    }
    if (lang === 'ka') watchLinks();
    document.documentElement.lang = lang;
    const [dict, cfg] = await Promise.all([loadDict(lang), getConfig()]);
    setVarsFrom(cfg);
    document.documentElement.dataset.launch = cfg.launchMode; // lets the stylesheet show or hide things per mode
    if (cfg.devMode) { const s = document.createElement('script'); s.src = '/js/dev-overflow.js'; document.head.appendChild(s); } // development only
    applyDict(dict);
    applyTitle(dict);
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
      btn.addEventListener('click', () => setLang(btn.dataset.lang));
    });
    markReady();
    return dict;
  }

  window.WisecallI18n = { fields, nameIn, fieldOfNiche, initI18n, kaHref, getLang, setLang, loadDict, applyDict, t, getConfig, launchMode, devMode, idChecksOpen, liveSessions, ready, niches, popularFields, nicheName, fieldName, formatDate, path };
})();
