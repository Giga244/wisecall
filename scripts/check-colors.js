// Finds colours written straight into the front end. Every colour must come from a design token (CSS custom property), so the dark
// theme can change it: run `npm run check:colors`. It looks at the stylesheets (outside the token blocks), the scripts that build HTML,
// and the pages, and lists each hard-coded colour with its file and line. The only allowed exceptions are colours that are not
// theme colours: the alpha mask in a CSS mask-image, Google's own logo, and the colour a person chose for their initials badge.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\((?!var\()[^)]*\)|hsla?\([^)]*\)/g; // (rgba(var(--token-rgb), 0.3) is a token with a transparency: fine)

// [file pattern, line pattern, why it is allowed]
const ALLOWED = [
  [/\.css$/, /mask-image/, 'an alpha mask: only the transparency counts, not the colour'],
  [/(login|signup|settings)\.html$|profile\.js$/, /fill="#(EA4335|4285F4|FBBC05|34A853)"/, 'the colours of Google\'s logo (a brand mark, used as Google publishes it; profile.js: the "sign up to ask" sheet)'],
  [/api\.js$/, /avatarStyle|#6d4de0|#fff'|const ink|hex\.slice|toString\(16\)/, 'the badge colour a person gets and its readable text colour, worked out from that colour'],
  [/theme-init\.js$/, /var BAR =/, 'the browser\'s address-bar colour is a <meta> tag: it cannot use a CSS variable'],
  [/mail[\\/]templates\.js$/, /COLORS =|COLORS\./, 'emails are always light, and mail apps do not know our CSS variables']
];

function stylesheetLines(file, text) {
  let inTokens = false;
  return text.split('\n').map((line, i) => {
    if (/^(:root|\[data-theme="dark"\]) \{/.test(line)) inTokens = true;
    const skip = inTokens;
    if (inTokens && /^\}/.test(line)) inTokens = false;
    return skip ? null : [i + 1, line];
  }).filter(Boolean);
}

function find() {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['fonts', 'i18n', 'brand'].includes(e.name)) walk(p); continue; }
      if (!/\.(css|js|html)$/.test(e.name)) continue;
      const rel = path.relative(ROOT, p).replace(/\\/g, '/');
      const text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
      const lines = e.name.endsWith('.css') ? stylesheetLines(rel, text) : text.split('\n').map((l, i) => [i + 1, l]);
      for (const [n, line] of lines) {
        const m = line.match(COLOR);
        if (!m) continue;
        if (ALLOWED.some(([f, l]) => f.test(rel) && l.test(line))) continue;
        found.push({ file: rel, line: n, colors: [...new Set(m)], text: line.trim().slice(0, 140) });
      }
    }
  };
  walk(path.join(ROOT, 'public'));
  return found;
}

module.exports = { find };

if (require.main === module) {
  const found = find();
  for (const f of found) console.log(`${f.file}:${f.line}  ${f.colors.join(' ')}   ${f.text}`);
  console.log(found.length ? `\n${found.length} hard-coded colour line(s): move them into the tokens in public/css/tokens.css` : 'No hard-coded colours: every colour comes from a design token.');
  process.exit(found.length ? 1 : 0);
}
