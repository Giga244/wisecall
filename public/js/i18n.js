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

  // Texts may contain {answerDays}, {feePct}, {sharePct}, {priceMin} and {priceMax}; they are filled in
  // from the server's settings so the page never disagrees with what the server really does.
  let vars = {};
  function fillVars(s) {
    return typeof s === 'string' ? s.replace(/\{(answerDays|holdDays|disputeDays|feePct|sharePct|priceMin|priceMax|questionMin|questionMax|answerMin|answerMax|unpaidDays)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : s;
  }
  function setVarsFrom(cfg) {
    vars = {
      answerDays: cfg.answerDeadlineDays, holdDays: cfg.payoutHoldDays === undefined ? 7 : cfg.payoutHoldDays, disputeDays: cfg.disputeDays === undefined ? 7 : cfg.disputeDays,
      feePct: cfg.platformFeePercent, sharePct: cfg.mentorSharePercent, priceMin: cfg.priceMin, priceMax: cfg.priceMax,
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
  // A niche's name in the current language; "Other" shows the mentor's own words when there are some.
  const nicheName = (key, custom) => (key === 'other' && custom ? custom : t('niche.' + key));

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
    return fillVars(currentDict[key] || key);
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
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    document.dispatchEvent(new CustomEvent('wisecall:lang-changed', { detail: { lang, dict } }));
    return dict;
  }

  // Resolves once the first language has been loaded and applied, so other scripts can wait for real texts.
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });

  async function initI18n() {
    const lang = getLang();
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

  window.WisecallI18n = { initI18n, getLang, setLang, loadDict, applyDict, t, getConfig, launchMode, devMode, idChecksOpen, ready, niches, nicheName, path };
})();
