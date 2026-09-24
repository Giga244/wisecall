// Small helpers for the sign up and log in forms: show/hide password buttons and a password strength hint.
// The strength hint is advice only; the server's rule (8 to 200 characters) is the only hard requirement.
(function () {
  const t = (k) => WisecallI18n.t(k);

  const COMMON = ['password', 'password1', '12345678', '123456789', '1234567890', 'qwertyuiop', 'qwerty123', 'iloveyou', '11111111', '00000000', 'abc12345', 'password123', 'letmein123', 'admin1234'];

  // -> { level: 0..4, key } where 0 is empty, 1 too short or very common, 2 weak, 3 okay, 4 strong
  function strength(pw) {
    if (!pw) return { level: 0, key: '' };
    if (pw.length < 8) return { level: 1, key: 'short' };
    if (COMMON.includes(pw.toLowerCase())) return { level: 1, key: 'common' };
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
    let score = 0;
    if (pw.length >= 12) score += 1;
    if (pw.length >= 16) score += 1;
    if (kinds >= 3) score += 1;
    if (kinds === 4) score += 1;
    if (/^(.)\1+$/.test(pw)) return { level: 2, key: 'weak' };
    if (score <= 0) return { level: 2, key: 'weak' };
    if (score <= 2) return { level: 3, key: 'ok' };
    return { level: 4, key: 'strong' };
  }

  function drawStrength(box, input) {
    const s = strength(input.value);
    box.dataset.level = String(s.level);
    box.innerHTML = s.level === 0 ? '' : `
      <div class="pw-bar" aria-hidden="true">${[1, 2, 3, 4].map((n) => `<i class="${n <= s.level ? 'on' : ''}"></i>`).join('')}</div>
      <span class="pw-text"><span class="sr-only">${t('auth.pw.strength')}: </span>${t('auth.pw.s.' + s.key)}</span>`;
  }

  function labelToggle(btn, input) {
    const shown = input.type === 'text';
    btn.setAttribute('aria-pressed', String(shown));
    btn.setAttribute('aria-label', t(shown ? 'auth.pw.hide' : 'auth.pw.show'));
  }

  function init() {
    document.querySelectorAll('.pw-wrap').forEach((wrap) => {
      const input = wrap.querySelector('input');
      const btn = wrap.querySelector('.pw-toggle');
      if (!input || !btn || btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
        labelToggle(btn, input);
        input.focus();
      });
      document.addEventListener('wisecall:lang-changed', () => labelToggle(btn, input));
    });
    document.querySelectorAll('.pw-strength[data-for]').forEach((box) => {
      const input = document.getElementById(box.dataset.for);
      if (!input) return;
      input.addEventListener('input', () => drawStrength(box, input));
      document.addEventListener('wisecall:lang-changed', () => drawStrength(box, input));
      drawStrength(box, input);
    });
  }

  window.AuthUI = { init, strength };
})();
