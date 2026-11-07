// The birth year and month, on the sign-up form and on /age-check.html. Only the year and the month are asked; the server decides (server/ageGate.js):
// these rules are here only so the page can say at once what comes next.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // (written out: not every browser has Georgian month names)
  const MONTHS = {
    ka: ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'],
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  };
  const monthName = (m) => MONTHS[WisecallI18n.getLang() === 'ka' ? 'ka' : 'en'][m - 1];

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
        <p class="age-too-young" id="ageTooYoung" role="status" hidden>${esc(t('age.under16'))}</p>
        <div class="age-parent" id="ageParent" hidden>
          <label class="checkbox-row" for="parentPermission"><input type="checkbox" id="parentPermission"> <span>${esc(t('age.parent.confirm'))}</span></label>
          <p class="hint">${esc(t('age.parent.forParents'))}</p>
        </div>
      </fieldset>`;
  }

  // The same count as server/ageGate.js (the server decides): whole years, once the whole birth month has passed.
  function ageOf(ym) {
    const [year, month] = ym.split('-').map(Number);
    const now = new Date();
    return Math.floor(((now.getUTCFullYear() * 12 + now.getUTCMonth() + 1) - (year * 12 + month) - 1) / 12);
  }
  // As soon as the year and month are chosen: under 16, the kind message right under them and no way to send; 16-17, a parent's or guardian's
  // agreement and a short line for the parents.
  function wire(root) {
    const box = root.querySelector('#ageParent');
    const young = root.querySelector('#ageTooYoung');
    const button = root.closest('form').querySelector('button[type="submit"]');
    const draw = () => {
      const ym = value(root);
      const age = ym === null ? null : ageOf(ym);
      const tooYoung = age !== null && age < 16;
      young.hidden = !tooYoung;
      box.hidden = !(age !== null && age >= 16 && age < 18);
      button.disabled = tooYoung;
      root.closest('form').dispatchEvent(new CustomEvent('wisecall:age', { detail: { minor: age !== null && age >= 16 && age < 18 } }));
    };
    root.querySelector('#birthYear').addEventListener('change', draw);
    root.querySelector('#birthMonth').addEventListener('change', draw);
  }
  // What the form sends. The box only counts while it is showing.
  const answer = (root) => ({ birthYm: value(root), parentPermission: !root.querySelector('#ageParent').hidden && root.querySelector('#parentPermission').checked });
  const needsPermission = (root) => !root.querySelector('#ageParent').hidden && !root.querySelector('#parentPermission').checked;

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

  window.WisecallAgeFields = { html, wire, value, answer, needsPermission, under16 };
})();
