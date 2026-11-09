// The redesign's design system ("Ink & Paper", docs/redesign/): the palette and type the owner approved, readable in both themes, the
// fonts served from this site, the signature shapes without gradients or blur, and motion that is off with reduced motion.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const contrast = require('../scripts/check-contrast');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'); // (the same on a Windows checkout)
const css = () => ['public/css/tokens.css', 'public/css/style.css', 'public/css/app.css', 'public/css/home.css'].map((f) => [f, read(f)]);

describe('the palette and type', () => {
  test('the approved colours: ink, paper, white, coral (fills), coral-text (headlines), mint, sun, blush, muted; dark ground and surface', () => {
    const { light, dark } = contrast.load();
    for (const [token, hex] of [['--c-ink', '#1e1a31'], ['--c-paper', '#f4f2ee'], ['--c-white', '#ffffff'], ['--c-coral', '#ff6f59'], ['--c-coral-text', '#e04a33'],
      ['--c-mint', '#ddf3ea'], ['--c-sun', '#ffe7a3'], ['--c-blush', '#ffd3cb'], ['--c-muted', '#4e4963'], ['--c-muted-2', '#6b6680'], ['--ink', '#1e1a31'], ['--bg', '#f4f2ee']]) {
      assert.equal(light[token], hex, token);
    }
    assert.deepEqual([dark['--bg'], dark['--card'], dark['--ink']], ['#16131f', '#221e31', '#f4f2ee']);
    assert.equal(dark['--c-coral'], '#ff6f59', 'the same accents in the dark');
  });

  test('4.5:1 everywhere it is text (both themes); the coral headline words only where they are 24px or larger (3:1)', () => {
    const { light, dark } = contrast.load();
    const pairs = [['--c-ink', '--c-paper'], ['--c-muted', '--c-paper'], ['--c-muted', '--c-white'], ['--c-muted-2', '--c-white'], ['--on-pastel', '--c-coral'],
      ['--on-pastel', '--c-mint'], ['--on-pastel', '--c-sun'], ['--on-pastel', '--c-blush'], ['--c-paper', '--c-ink']];
    for (const [fg, bg] of pairs) assert.ok(contrast.ratio(light[fg], light[bg]) >= 4.5, `${fg} on ${bg}: ${contrast.ratio(light[fg], light[bg]).toFixed(2)}`);
    for (const [fg, bg] of [['--ink', '--bg'], ['--ink', '--card'], ['--ink-soft', '--bg'], ['--ink-soft', '--card'], ['--accent-text', '--bg']]) {
      assert.ok(contrast.ratio(dark[fg], dark[bg]) >= 4.5, `dark ${fg} on ${bg}`);
    }
    assert.ok(contrast.ratio(light['--c-coral-text'], light['--c-paper']) >= 3);
    // (coral-text is never small text: only the hero's accent words use it, through --headline-accent)
    for (const [f, text] of css().filter(([f]) => !f.endsWith('tokens.css'))) assert.doesNotMatch(text, /var\(--c-coral-text\)/, f);
    // and white text never goes on coral
    for (const [f, text] of css()) assert.doesNotMatch(text, /--on-accent:\s*#fff/i, f);
    assert.deepEqual(contrast.check().failures, []);
  });

  test('type: Bricolage Grotesque for headings, prices and numerals, Onest for text; Georgian uses Noto Sans Georgian for both, chosen with :lang(ka)', () => {
    const t = read('public/css/tokens.css');
    assert.match(t, /--font-display: 'Bricolage Grotesque'/);
    assert.match(t, /--font-body: 'Onest'/);
    assert.match(t, /--tracking-display: -0\.02em/);
    assert.match(t, /:lang\(ka\) \{[^}]*--font-display: 'Noto Sans Georgian'[^}]*--font-body: 'Noto Sans Georgian'/s);
    const s = read('public/css/style.css');
    assert.match(s, /h1, h2, h3 \{ font-family: var\(--font-display\); font-weight: 800;/);
    assert.match(s, /\.price, \.num, \.display \{ font-family: var\(--font-display\)/);
    for (const [f, text] of css()) assert.doesNotMatch(text, /Baloo|Nunito/, `${f}: the old fonts are gone`);
  });
});

describe('the fonts are served from this site', () => {
  test('every @font-face is a local WOFF2 subset with font-display: swap; the files exist; the two latin files are preloaded on every page', () => {
    const t = read('public/css/tokens.css');
    const faces = t.match(/@font-face \{[^}]*\}/g);
    assert.equal(faces.length, 4);
    for (const f of faces) {
      assert.match(f, /font-display: swap/);
      assert.match(f, /unicode-range:/, 'subsetted');
      const url = f.match(/url\('([^']+)'\)/)[1];
      assert.match(url, /^\/fonts\/[\w-]+\.woff2$/);
      assert.ok(fs.existsSync(path.join(ROOT, 'public', url)), url);
    }
    assert.ok(fs.existsSync(path.join(ROOT, 'public/fonts/OFL.txt')), 'the licence travels with the fonts');
    const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html') && !/^mock-/.test(f));
    for (const p of pages) {
      const html = read('public/' + p);
      const tokens = html.indexOf('/css/tokens.css'), style = html.indexOf('/css/style.css');
      assert.ok(tokens > 0 && tokens < style, `${p}: tokens.css comes first`);
      assert.match(html, /<link rel="preload" href="\/fonts\/bricolage-grotesque-latin\.woff2" as="font" type="font\/woff2" crossorigin>/, p);
      assert.match(html, /<link rel="preload" href="\/fonts\/onest-latin\.woff2" as="font" type="font\/woff2" crossorigin>/, p);
    }
  });

  test('the content-security policy is unchanged: fonts and scripts from this site only, no inline scripts', () => {
    const { CSP } = require('../server/security');
    assert.match(CSP, /font-src 'self'/);
    assert.match(CSP, /script-src 'self'/);
    assert.doesNotMatch(CSP, /unsafe-inline[^;]*;?\s*$|script-src[^;]*unsafe/);
    assert.doesNotMatch(CSP, /fonts\.googleapis|fonts\.gstatic/);
  });
});

describe('the signature, without the generic look', () => {
  test('no gradients (except the fade masks of scrolling rows), no blur or glass, no left-border cards, no blobs', () => {
    for (const [f, text] of css()) {
      for (const line of text.split('\n')) {
        if (/gradient\(/.test(line)) assert.match(line, /mask-image/, `${f}: a gradient that is not a mask: ${line.trim().slice(0, 90)}`);
        assert.doesNotMatch(line, /backdrop-filter|filter: blur/, `${f}: ${line.trim().slice(0, 90)}`);
        assert.doesNotMatch(line, /border-left: [3-9]px solid/, `${f}: a left-border card: ${line.trim().slice(0, 90)}`);
        assert.doesNotMatch(line, /blob/, `${f}: ${line.trim().slice(0, 90)}`);
      }
    }
  });

  test('2px outlines, 14px buttons, 22-28px cards, 36-40px panels, the offset shadow on the primary action, 1.5px pill chips, dashed rules', () => {
    const t = read('public/css/tokens.css'), s = read('public/css/style.css'), h = read('public/css/home.css');
    assert.match(t, /--line-w: 2px;/);
    assert.match(t, /--chip-w: 1\.5px;/);
    assert.match(t, /--r-btn: 14px;/);
    assert.match(t, /--offset-shadow: 0 8px 0 -2px var\(--line\);/);
    assert.match(s, /\.btn-primary \{ background: var\(--accent-strong\); color: var\(--on-accent\); border-color: var\(--line\); box-shadow: var\(--offset-shadow\); \}/);
    assert.match(s, /\.chip \{\n  border: var\(--chip-w\) solid var\(--line\);[^}]*border-radius: var\(--r-pill\)/);
    assert.match(s, /\.ex-who \{[^}]*border-top: var\(--chip-w\) dashed var\(--line\)/);
    assert.match(s, /\.mentors-panel \{[^}]*border-radius: 40px/s); // (the mentors' page)
    assert.match(h, /\.cta-inner \{[^}]*border-radius: 40px/s);
    assert.match(s, /:focus-visible \{ outline: 2px solid var\(--focus\); outline-offset: 3px; \}/);
  });

  test('the spacing scale and the container: 4 8 12 16 24 32 48 72 110, 1280 wide with 32px gutters (18px on phones)', () => {
    const t = read('public/css/tokens.css');
    assert.match(t, /--s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 72px; --s-9: 110px;/);
    assert.match(t, /--container: 1280px;/);
    assert.match(t, /--gutter: 32px;/);
    assert.match(t, /@media \(max-width: 639px\) \{ :root \{ --gutter: 18px; \} \}/);
  });
});

describe('loading skeletons', () => {
  const count = (text, re) => (text.match(re) || []).length;
  test('paper-grey blocks; the shimmer only with motion allowed, moved by transform and shaped by a mask (no gradient fill)', () => {
    const s = read('public/css/style.css');
    assert.match(s, /\.skeleton \{ display: block; position: relative; overflow: hidden; border-radius: 8px; background: var\(--skeleton-a\); \}/);
    assert.match(s, /html\.motion \.skeleton::after \{[^}]*background: var\(--skeleton-b\); transform: translateX\(-100%\);[^}]*mask-image: linear-gradient[^}]*animation: skeleton-shine/s);
    assert.match(s, /@keyframes skeleton-shine \{ to \{ transform: translateX\(100%\); \} \}/);
    assert.doesNotMatch(read('public/css/app.css'), /\.skeleton\b/, 'one set of skeleton rules, in style.css (every page has it)');
  });

  test('each loading place: the skeleton hidden from screen readers and one "Loading…" status', () => {
    // Browse (public/experts.html): open before and after launch, so its skeleton is the same in both
    const browse = read('public/experts.html');
    const grid = /<div class="expert-grid" id="expertGrid" aria-live="polite" aria-busy="true">([\s\S]*?)\n {4}<\/div>\n/.exec(browse)[1];
    assert.equal(count(grid, /role="status"/g), 1);
    assert.equal(count(grid, /<div class="expert-card skeleton-expert" aria-hidden="true">/g), 8, '8 cards (6 below 1024px)');
    assert.doesNotMatch(grid, /<!-- (before|after) launch -->/);
    assert.equal(count(browse, /<li class="skeleton-tile" aria-hidden="true">/g), 10);
    // the home page: the hero's waiting list (before launch) has the form's height while it is drawn; the popular fields too
    const home = read('public/index.html');
    assert.match(home, /<!-- before launch -->[\s\S]*<div class="lhero-wait" id="heroWait"><div class="lhero-wait-skeleton" aria-hidden="true">[\s\S]*?<!-- \/before launch -->/);
    assert.equal(count(home, /<li aria-hidden="true"><span class="skeleton skeleton-chip"><\/span><\/li>/g), 3);
    const dash = read('public/dashboard.html');
    assert.match(dash, /<div id="askedList" aria-live="polite" aria-busy="true">\s*<p class="sr-only" role="status" data-i18n="experts\.loading">Loading…<\/p>/);
    assert.equal(count(dash, /<div class="booking-card skeleton-booking" aria-hidden="true">/g), 2);
    const inbox = read('public/inbox.html');
    assert.equal(count(/<main[\s\S]*<\/main>/.exec(inbox)[0], /role="status"/g), 1, 'the conversation list speaks for the whole page');
    assert.equal(count(inbox, /<li class="skeleton-thread" aria-hidden="true">/g), 4);
    assert.match(inbox, /<div class="skeleton-thread-view" aria-hidden="true">/);
  });

  test('the scripts show the skeleton again while something loads, and the usual message when it fails', () => {
    const main = read('public/js/main.js');
    assert.match(main, /const loadingHtml = grid\.innerHTML;/);
    assert.match(main, /if \(!loaded\) \{ grid\.innerHTML = loadingHtml;/);
    assert.match(main, /grid\.setAttribute\('aria-busy', 'false'\);\n\s*grid\.innerHTML = `<p class="muted">\$\{t\('experts\.loadError'\)\}<\/p>`;/);
    const dash = read('public/js/dashboard.js');
    assert.match(dash, /if \(isMentor\) receivedList\.innerHTML = `<p class="muted">\$\{t\('toast\.error'\)\}<\/p>`;/);
    const inbox = read('public/js/inbox.js');
    assert.match(inbox, /if \(id !== current\) \{ view\.innerHTML = threadLoading; layout\.classList\.add\('has-thread'\); \}/);
    assert.match(read('public/js/profile.js'), /page\.querySelectorAll\('\[data-skeleton\]'\)\.forEach\(\(el\) => el\.remove\(\)\);/);
    assert.match(read('public/js/answers.js'), /search\.addEventListener\('submit', \(\) => \{\n\s*list\.setAttribute\('aria-busy', 'true'\);/);
  });
});

describe('motion is off with reduced motion', () => {
  test('"motion" is set on <html> only without prefers-reduced-motion, before the first paint; motion.js is on every page (deferred)', () => {
    const init = read('public/js/theme-init.js');
    assert.match(init, /prefers-reduced-motion: reduce\)'\)\.matches;\n  if \(!calm\) root\.classList\.add\('motion'\);/);
    assert.match(read('server/headTags.html'), /<script src="\/js\/motion\.js" defer><\/script>/);
    const m = read('public/js/motion.js');
    assert.match(m, /IntersectionObserver/);
    assert.doesNotMatch(m, /innerHTML/);
  });

  test('every waiting or looping animation of the home page is gated by html.motion, and reduced motion stops the rest', () => {
    const h = read('public/css/home.css'), s = read('public/css/style.css');
    for (const sel of ['.bubble-q', '.bubble-typing', '.bubble-a', '.stage-meta', '.stage-sticker', '.squiggle path']) {
      const rule = h.split('\n').find((l) => l.startsWith(`html.motion ${sel} {`) && /animation:/.test(l));
      assert.ok(rule, `${sel} animates only with html.motion`);
    }
    assert.match(s, /html\.motion \[data-reveal\]:not\(\.is-in\) \{ opacity: 0; transform: translateY\(28px\); animation: reveal-safety 0\.01s 3s forwards; \}/);
    assert.match(s, /@media \(prefers-reduced-motion: reduce\) \{\n  \* \{ animation-duration: 0\.01ms !important;/);
    assert.match(s, /\.rise \{ animation: rise var\(--rise\) var\(--ease-out\) backwards; \}/);
    // (only transform and opacity move: the keyframes never animate a size or a position that would shift the layout)
    for (const [f, text] of css()) {
      for (const kf of text.match(/@keyframes [\w-]+ \{[^@]*?\}\s*\}/g) || []) {
        assert.doesNotMatch(kf, /\b(width|height|top|left|margin|padding)\s*:/, `${f}: ${kf.slice(0, 60)}`);
      }
    }
  });
});
