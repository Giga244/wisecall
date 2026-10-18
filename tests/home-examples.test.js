// The hero's rotating example (docs/CLAUDE-CODE-ROTATING-EXAMPLE.md): six examples, each in English and Georgian; all six in the page,
// in the decorative card; and the rotation (public/js/home.js): a random first one, then the next, never the same one twice in a row.
// The layout, the timing, reduced motion and the hidden tab are checked in a real browser (e2e/home-examples.spec.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const en = JSON.parse(read('public/i18n/en.json'));
const ka = JSON.parse(read('public/i18n/ka.json'));
const GEORGIAN = /[ა-ჿ]/;

test('all 6 examples exist in English and Georgian: a question, the mentor\'s role and a short answer', () => {
  for (let n = 1; n <= 6; n++) {
    for (const part of ['q', 'role', 'a']) {
      const key = `mock.examples.${n}.${part}`;
      assert.ok(typeof en[key] === 'string' && en[key].trim(), `${key} in English`);
      assert.ok(typeof ka[key] === 'string' && ka[key].trim(), `${key} in Georgian`);
      assert.match(ka[key], GEORGIAN, `${key} is Georgian`);
      assert.notEqual(ka[key], en[key]);
    }
    const sentences = (s) => s.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;
    assert.ok(sentences(en[`mock.examples.${n}.a`]) <= 4, `example ${n}: a short answer`);
    assert.ok(en[`mock.examples.${n}.q`].endsWith('?'), `example ${n}: a question`);
  }
  assert.equal(en['mock.examples.1.role'], 'Product designer', 'the first is the example the card showed before');
  assert.equal(en['mock.examples.2.role'], 'Studied in Munich');
  assert.equal(en['mock.examples.6.a'], 'Price the result, not your hours: offer a basic package and a fuller one with a mini brand guide. Most small clients pick the middle option, so always offer three.');
  for (const old of ['mock.q.text', 'mock.a.role', 'mock.a.text']) assert.equal(en[old], undefined, `${old} is replaced by the examples`);
  assert.deepEqual(Object.keys(en).filter((k) => k.startsWith('mock.examples.')).sort(), Object.keys(ka).filter((k) => k.startsWith('mock.examples.')).sort());
});

test('all 6 are in the card, which stays decoration with its "Example" tag and label', () => {
  const html = read('public/index.html');
  const stage = html.slice(html.indexOf('<div class="hero-stage'), html.indexOf('<span class="stage-sticker'));
  assert.match(stage, /<div class="hero-stage rise rise-2" role="img" data-i18n-aria="mock\.aria" aria-label="[^"]+">/);
  assert.match(stage, /<div class="stage" aria-hidden="true">/);
  assert.match(stage, /<span class="stage-tag" data-i18n="mock\.example">Example<\/span>/);
  const examples = stage.split('<div class="stage-example">').slice(1);
  assert.equal(examples.length, 6);
  examples.forEach((ex, i) => {
    for (const part of ['q', 'role', 'a']) assert.match(ex, new RegExp(`data-i18n="mock\\.examples\\.${i + 1}\\.${part}"`), `example ${i + 1} ${part}`);
  });
  assert.doesNotMatch(stage, /is-active/, 'none is shown until home.js has chosen one (no flash of another)');
});

test('the rotation: a random first one (any of the 6), then the next; never the same one twice in a row, and every one comes round', () => {
  const js = read('public/js/home.js');
  const src = js.match(/  const firstExample = .*\n  const nextExample = .*\n/);
  assert.ok(src, 'the two rules are in home.js');
  const { firstExample, nextExample } = vm.runInNewContext(`(() => { ${src[0]}; return { firstExample, nextExample }; })()`);
  assert.equal(firstExample(6, () => 0), 0);
  assert.equal(firstExample(6, () => 0.5), 3);
  assert.equal(firstExample(6, () => 0.999999), 5);
  assert.equal(firstExample(6, () => 1), 5, 'never past the last one');
  const firsts = new Set();
  for (let run = 0; run < 2000; run++) {
    let i = firstExample(6);
    firsts.add(i);
    const seen = new Set([i]);
    for (let step = 0; step < 30; step++) {
      const next = nextExample(i, 6);
      assert.notEqual(next, i, 'never the same one twice in a row');
      assert.ok(next >= 0 && next < 6);
      i = next;
      if (step < 5) seen.add(i);
    }
    assert.equal(seen.size, 6, 'all six within one round');
  }
  assert.equal(firsts.size, 6, 'any of them can come first');
  // (the page wires it to the animation: the next one when the question's 12-second loop starts over, paused while the tab is hidden)
  assert.match(js, /stage\.addEventListener\('animationiteration', \(ev\) => \{\n      if \(ev\.animationName === 'q-in' && ev\.target\.closest\('\.stage-example'\) === examples\[current\]\) show\(nextExample\(current, examples\.length\)\);/);
  assert.match(js, /document\.addEventListener\('visibilitychange', paused\);/);
  assert.match(read('public/css/home.css'), /html\.motion \.stage\.is-paused, html\.motion \.stage\.is-paused \* \{ animation-play-state: paused; \}/);
});
