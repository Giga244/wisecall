// Checks that the colour tokens of public/css/style.css (light and dark) are readable: every text colour against the surfaces it is
// drawn on (WCAG AA: 4.5:1), and the outlines of form fields, the focus ring and emphasised borders (3:1). Run: npm run check:contrast
// It reads the :root block for the light theme and [data-theme="dark"] for the dark one (which overrides the light values).
const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'public', 'css', 'style.css');

function tokens(text, selector) {
  const start = text.indexOf(selector + ' {');
  if (start < 0) throw new Error('no ' + selector + ' block');
  const body = text.slice(text.indexOf('{', start) + 1, text.indexOf('\n}', start));
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

function load() {
  const text = fs.readFileSync(CSS, 'utf8').replace(/\r\n/g, '\n');
  const light = tokens(text, ':root');
  const dark = { ...light, ...tokens(text, '[data-theme="dark"]') };
  return { light, dark };
}

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground token, background token, minimum ratio, what it is]
const TEXT = 4.5, UI = 3;
const PAIRS = [
  ['--ink', '--bg', TEXT, 'text on the page'], ['--ink', '--card', TEXT, 'text on a card'], ['--ink', '--raised', TEXT, 'text in a menu or sheet'], ['--ink', '--field', TEXT, 'text typed in a field'],
  ['--ink-soft', '--bg', TEXT, 'muted text on the page'], ['--ink-soft', '--card', TEXT, 'muted text on a card'], ['--ink-soft', '--raised', TEXT, 'muted text in a menu'], ['--ink-soft', '--gray-soft', TEXT, 'muted text on a grey badge'],
  ['--ink', '--lav-soft', TEXT, 'tags and answered badges'], ['--ink', '--sun-tint', TEXT, 'the tips box'], ['--ink', '--coral-tint', TEXT, 'the rating prompt'], ['--ink', '--gray-soft', TEXT, 'hovered menu rows'],
  ['--accent-text', '--bg', TEXT, 'coral links on the page'], ['--accent-text', '--card', TEXT, 'coral links on a card'], ['--accent-text', '--raised', TEXT, 'coral links in a menu'],
  ['--accent-text', '--on-accent', TEXT, 'the coral text on the white/dark button of the coral band'],
  ['--on-accent', '--accent-strong', TEXT, 'button text'], ['--on-accent', '--accent-strong-hover', TEXT, 'button text when hovered'],
  ['--accent2-text', '--card', TEXT, 'green text on a card'], ['--accent2-text', '--bg', TEXT, 'green text on the page'], ['--accent2-text', '--mint-soft', TEXT, 'green text on a mint badge'],
  ['--on-accent2', '--accent2-strong', TEXT, 'the check mark on green'],
  ['--on-navy', '--navy', TEXT, 'text on the deep bands'], ['--on-inverse', '--inverse', TEXT, 'active chips, tooltips, toasts'], ['--on-sun', '--sun', TEXT, 'the "question" avatar'],
  ['--gold-text', '--card', TEXT, 'star ratings on a card'], ['--gold-text', '--bg', TEXT, 'star ratings on the page'],
  ['--red-strong', '--card', TEXT, 'error text on a card'], ['--red-strong', '--bg', TEXT, 'error text on the page'], ['--red-strong', '--pink-soft', TEXT, 'error badges'],
  ['--pink-ink', '--pink-soft', TEXT, 'the overdue countdown'], ['--sun-ink', '--sun-soft', TEXT, 'warning badges and banners'], ['--mint-banner-ink', '--mint-soft', TEXT, 'the mint banner'],
  ['--gbtn-ink', '--gbtn-bg', TEXT, 'Google button text'],
  // outlines of things you have to find and use
  ['--field-border', '--field', UI, 'the outline of a form field, from the inside'], ['--field-border', '--card', UI, 'the outline of a form field, from the card around it'], ['--field-border', '--bg', UI, 'the outline of a form field on the page'],
  ['--accent-strong', '--bg', UI, 'the focus ring on the page'], ['--accent-strong', '--card', UI, 'the focus ring on a card'], ['--border-strong', '--card', UI, 'emphasised outlines'],
  ['--gbtn-border', '--gbtn-bg', UI, 'the Google button outline']
];

function check() {
  const { light, dark } = load();
  const failures = [], rows = [];
  for (const [themeName, t] of [['light', light], ['dark', dark]]) {
    for (const [fg, bg, min, what] of PAIRS) {
      if (!t[fg] || !t[bg]) { failures.push({ theme: themeName, fg, bg, min, what, got: NaN, note: 'token missing' }); continue; }
      const got = ratio(t[fg], t[bg]);
      rows.push({ theme: themeName, fg, bg, min, what, got });
      if (got + 1e-9 < min) failures.push({ theme: themeName, fg, bg, min, what, got });
    }
  }
  return { failures, rows };
}

module.exports = { check, load, ratio, PAIRS };

if (require.main === module) {
  const { failures, rows } = check();
  if (process.argv.includes('--all')) for (const r of rows) console.log(`${r.theme.padEnd(5)} ${r.got.toFixed(2).padStart(6)}  (need ${r.min})  ${r.fg} on ${r.bg}: ${r.what}`);
  for (const f of failures) console.log(`FAIL ${f.theme}: ${f.fg} on ${f.bg} is ${Number.isNaN(f.got) ? f.note : f.got.toFixed(2) + ':1'}, needs ${f.min}:1 (${f.what})`);
  console.log(failures.length ? `\n${failures.length} pair(s) too low` : `All ${rows.length} colour pairs are readable (light and dark).`);
  process.exit(failures.length ? 1 : 0);
}
