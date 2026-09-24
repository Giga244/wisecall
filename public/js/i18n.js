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

  function getLang() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
    return navigator.language && navigator.language.toLowerCase().startsWith('ka') ? 'ka' : 'en';
  }

  async function loadDict(lang) {
    const res = await fetch(`/i18n/${lang}.json`);
    return res.json();
  }

  function applyDict(dict) {
    currentDict = dict;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key] !== undefined) el.textContent = dict[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (dict[key] !== undefined) el.placeholder = dict[key];
    });
  }

  function t(key) {
    return currentDict[key] || key;
  }

  async function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    const dict = await loadDict(lang);
    applyDict(dict);
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    document.dispatchEvent(new CustomEvent('wisecall:lang-changed', { detail: { lang, dict } }));
    return dict;
  }

  async function initI18n() {
    const lang = getLang();
    document.documentElement.lang = lang;
    const dict = await loadDict(lang);
    applyDict(dict);
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
      btn.addEventListener('click', () => setLang(btn.dataset.lang));
    });
    return dict;
  }

  window.WisecallI18n = { initI18n, getLang, setLang, loadDict, applyDict, t };
})();
