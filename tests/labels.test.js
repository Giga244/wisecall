// Every form control has a real <label for="id">, so a screen reader reads the label and not the placeholder or a bare "on".
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));

describe('form controls in the pages', () => {
  for (const file of pages) {
    test(`${file}: every field is tied to a <label for>`, () => {
      const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
      const missing = [];
      for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
        const tag = m[0];
        if (/type="hidden"/.test(tag)) continue;
        const id = (tag.match(/\bid="([^"]+)"/) || [])[1];
        if (!id || !new RegExp(`<label[^>]*\\bfor="${id}"`).test(html)) missing.push(tag.slice(0, 90));
      }
      assert.deepEqual(missing, [], `${file} has fields without a label`);
    });
  }

  test('the verification code and the "I\'d like to offer advice as a mentor" checkbox have visible label text', () => {
    const verify = fs.readFileSync(path.join(PUBLIC, 'verify-email.html'), 'utf8');
    assert.match(verify, /<label for="code">[\s\S]*?data-i18n="auth\.verify\.codeLabel"/);
    const settings = fs.readFileSync(path.join(PUBLIC, 'settings.html'), 'utf8');
    assert.match(settings, /<label class="checkbox-row" for="becomeMentor">[\s\S]*?data-i18n="settings\.mentor\.enable"/);
  });
});

describe('the work-email code in development', () => {
  test('is drawn on the page from the server\'s reply (which only has it outside production), like the signup code', () => {
    const js = fs.readFileSync(path.join(PUBLIC, 'js', 'settings-verification.js'), 'utf8');
    assert.match(js, /devWorkEmailCode = r\.devCode \|\| null/);
    assert.match(js, /class="hero-cta-banner dev-code" role="status"/);
    assert.doesNotMatch(js, /showToast\(t\('vt\.we\.devCode'\)/, 'no longer a toast that disappears after 3 seconds');
    const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'verification', 'credentials.js'), 'utf8');
    assert.match(server, /devCode: \(!emailSent && !config\.IS_PROD\) \? code : undefined/);
  });
});

describe('form controls that scripts draw later', () => {
  test('api.js ties every label to its control by id, also for what is drawn after the page loads', () => {
    const api = fs.readFileSync(path.join(PUBLIC, 'js', 'api.js'), 'utf8');
    assert.match(api, /label:not\(\[for\]\)/);
    assert.match(api, /htmlFor = control\.id/);
    assert.match(api, /new MutationObserver\(scheduleLinking\)/);
  });

  test('the templates put the control inside its label (or give it an explicit label)', () => {
    for (const f of ['settings-verification.js', 'report.js', 'waitlist.js']) {
      const js = fs.readFileSync(path.join(PUBLIC, 'js', f), 'utf8');
      const controls = (js.match(/<(input|select|textarea)\b/g) || []).length;
      const labels = (js.match(/<label\b/g) || []).length;
      assert.ok(labels >= controls - 1, `${f}: ${controls} controls but ${labels} labels`);
    }
  });
});
