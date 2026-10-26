// The story step of /apply.html (docs/CLAUDE-CODE-STORY-STEP-CHECK.md): the page and the server judge a story with the same rule
// (public/js/text-rules.js, loaded by the page and required by the server), so a story the page lets through is one the server counts,
// and the page can say why one does not count ("short" or "looks repeated").
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, resetDatabase, startServer, signupVerified } = require('./helpers');

// The rule as the page has it: the file run as a browser runs it (no module, a window).
function pageRules() {
  const sandbox = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'text-rules.js'), 'utf8'), sandbox);
  return sandbox.self.WisecallTextRules;
}

const REAL_KA = 'თბილისის სახელმწიფო უნივერსიტეტში თვრამეტი წელია მაკროეკონომიკას ვასწავლი და ეროვნული ბანკის ინფლაციის ანგარიშებზე ვმუშაობდი.';
const REAL_EN = 'I have taught macroeconomics at Tbilisi State University for eighteen years and worked on the National Bank inflation reports.';
const SAMPLES = [
  ['a real story in Georgian', REAL_KA, true],
  ['a real story in English', REAL_EN, true],
  ['the same word again and again (120 characters)', 'ტესტი '.repeat(20), false],
  ['test typing', 'test test test test test test test test test test test test test test test test test test test test test test test', false],
  ['one letter', 'a'.repeat(130), false],
  ['a few letters again and again', 'asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf asdf', false],
  ['a short unit repeated', 'hahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahaha', false],
  ['only punctuation', '!?.,'.repeat(30), false],
  ['too short', 'ეკონომიკას ვასწავლი.', false],
  ['padded with blanks to look long', `${'ეკონომიკა ვასწავლე'}${' '.repeat(120)}`, false],
  ['a few words over and over, as a long text', 'ბანკი სესხი ბანკი სესხი ბანკი სესხი ბანკი სესხი ბანკი სესხი ბანკი სესხი ბანკი სესხი ბანკი სესხი ბანკი სესხი ბანკი სესხი ბანკი სესხი ბანკი სესხი', false]
];

describe('the rule itself', () => {
  test('the page loads the same file the server uses', () => {
    const server = require('../server/content');
    const page = pageRules();
    for (const [, text] of SAMPLES) {
      assert.equal(page.looksRepeated(text), server.looksRepeated(text));
      assert.equal(page.size(text), server.size(text));
    }
    assert.match(fs.readFileSync(path.join(ROOT, 'server', 'content.js'), 'utf8'), /require\('\.\.\/public\/js\/text-rules'\)/);
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'apply.html'), 'utf8'), /<script src="\/js\/text-rules\.js"><\/script>\s*<script src="\/js\/apply\.js"><\/script>/);
  });

  test('the verdict and its reason', () => {
    const { storyVerdict } = pageRules();
    assert.deepEqual({ ...storyVerdict(REAL_EN, 100) }, { ok: true, reason: null, n: REAL_EN.length }); // (a plain copy: the page's object is from another context)
    assert.equal(storyVerdict('ტესტი '.repeat(20), 100).reason, 'repeated');
    assert.equal(storyVerdict('short', 100).reason, 'short');
    assert.equal(storyVerdict('', 100).reason, 'short');
    assert.equal(storyVerdict(null, 100).reason, 'short');
  });
});

describe('the page and the server agree on every sample', () => {
  let srv, c;
  before(async () => {
    await resetDatabase();
    srv = await startServer(4777);
    c = await signupVerified(srv.base, 'Nino Story', 'nino-story@example.com');
    await c.api('/me', { method: 'PATCH', body: { becomeMentor: true } });
  });
  after(() => { if (srv) srv.proc.kill(); });

  test('saved through the real API, the server counts the story exactly when the page would', async () => {
    const { storyVerdict } = pageRules();
    for (const [name, text, expected] of SAMPLES) {
      const page = storyVerdict(text, 100);
      assert.equal(page.ok, expected, `${name}: the page`);
      const saved = await c.api('/verification/experience', { method: 'PUT', body: { story: text } });
      assert.equal(saved.status, 200, `${name}: saved (a draft is never refused)`);
      const v = await c.api('/verification');
      assert.equal(!v.application.missing.includes('story'), page.ok, `${name}: the server agrees`);
      assert.equal(v.application.progress.done[1], page.ok, `${name}: step 2's tick`);
      assert.equal(v.application.storyReason, page.reason, `${name}: the same reason`);
    }
  });
});

describe('the words', () => {
  test('in English and Georgian', () => {
    for (const l of ['en', 'ka']) {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'i18n', `${l}.json`), 'utf8'));
      for (const k of ['apply.err.storyRepeated', 'apply.story.countRepeated', 'apply.gap', 'apply.stepIncomplete']) assert.ok(d[k], `${l}: ${k}`);
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'i18n', 'ka.json'), 'utf8'))['apply.err.storyRepeated'],
      'ეს ტექსტი განმეორებადს ჰგავს. დაწერე რამდენიმე ნამდვილი წინადადება შენს გამოცდილებაზე.');
  });
});
