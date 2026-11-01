// The birth year and month, on the sign-up form and on /age-check.html. Only the year and the month are asked; the server decides (server/ageGate.js):
// these rules are here only so the page can say at once what comes next.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function monthName(m) {
    return new Intl.DateTimeFormat(WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, m - 1, 1)));
  }

  function html() {
    const thisYear = new Date().getUTCFullYear();
    const months = Array.from({ length: 12 }, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}">${esc(monthName(i + 1))}</option>`).join('');
    const years = Array.from({ length: 96 }, (_, i) => thisYear - 5 - i).map((y) => `<option value="${y}">${y}</option>`).join('');
    return `
      <fieldset class="age-fields">
        <legend>${esc(t('age.legend'))}</legend>
        <div class="age-row">
          <label for="birthYear"><span>${esc(t('age.year'))}</span><select id="birthYear" required><option value="">${esc(t('age.choose'))}</option>${years}</select></label>
          <label for="birthMonth"><span>${esc(t('age.month'))}</span><select id="birthMonth" required><option value="">${esc(t('age.choose'))}</option>${months}</select></label>
        </div>
        <span class="hint">${esc(t('age.why'))}</span>
      </fieldset>`;
  }

  // 'YYYY-MM', or null while something is not chosen.
  function value(root) {
    const y = root.querySelector('#birthYear').value;
    const m = root.querySelector('#birthMonth').value;
    return y && m ? `${y}-${m}` : null;
  }

  // The kind message under 16: it takes the form's place. Nothing was kept.
  function under16(box) {
    box.innerHTML = `<div class="age-under16" role="status" tabindex="-1"><p>${esc(t('age.under16'))}</p><p><a class="plain-link" href="${WisecallI18n.getLang() === 'ka' ? '/ka/' : '/'}">${esc(t('age.backHome'))}</a></p></div>`;
    box.querySelector('.age-under16').focus();
  }

  window.WisecallAgeFields = { html, value, under16 };
})();
