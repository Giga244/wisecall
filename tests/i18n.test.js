// The two languages stay in step: every English text has a Georgian one with the same {placeholders} (and the admin dictionaries too),
// the Georgian speaks to the reader informally (შენ) outside the legal texts, uses the agreed words, and dates are Georgian even in a
// browser without Georgian locale data.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const I18N = path.join(__dirname, '..', 'public', 'i18n');
const read = (name) => JSON.parse(fs.readFileSync(path.join(I18N, `${name}.json`), 'utf8'));
const PAIRS = [['en', 'ka'], ['admin-en', 'admin-ka'], ['admin2fa-en', 'admin2fa-ka']].filter(([a]) => fs.existsSync(path.join(I18N, `${a}.json`)));
const placeholders = (v) => [...new Set((JSON.stringify(v).match(/\{\w+\}/g) || []))].sort();
const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

describe('English and Georgian stay in step', () => {
  for (const [en, ka] of PAIRS) {
    test(`${ka}.json has every key of ${en}.json, and no other`, () => {
      const E = read(en), K = read(ka);
      assert.deepEqual(Object.keys(E).filter((k) => !(k in K)), [], `missing in ${ka}`);
      assert.deepEqual(Object.keys(K).filter((k) => !(k in E)), [], `only in ${ka}`);
    });
    test(`${en} / ${ka}: the same {placeholders} in every text, and nothing empty`, () => {
      const E = read(en), K = read(ka);
      // (Georgian may leave out a {name} where a case ending would have to be hyphenated onto it: "როგორი იყო პასუხი?")
      const differ = (k) => {
        const e = placeholders(E[k]), g = placeholders(K[k]);
        return g.some((p) => !e.includes(p)) || e.some((p) => !g.includes(p) && p !== '{name}');
      };
      const wrong = Object.keys(E).filter((k) => k in K && differ(k)).map((k) => `${k}: en ${placeholders(E[k])} / ka ${placeholders(K[k])}`);
      assert.deepEqual(wrong, []);
      const empty = Object.keys(K).filter((k) => text(K[k]).trim() === '' && text(E[k]).trim() !== '');
      assert.deepEqual(empty, []);
    });
  }
});

describe('the Georgian texts', () => {
  const all = () => PAIRS.flatMap(([, ka]) => Object.entries(read(ka)).map(([k, v]) => [`${ka}:${k}`, text(v)]));
  // (the Terms and Privacy Policy are written formally on purpose; the lawyer decides them: docs/legal/)
  const ordinary = () => all().filter(([k]) => !/:legal\./.test(k));

  test('speak to the reader informally (შენ, „გთხოვ“), never თქვენ', () => {
    const FORMAL = /(^|[^ა-ჰ])(გთხოვთ|თქვენ|თქვენი|თქვენს|თქვენთვის|შეიყვანეთ|აირჩიეთ|სცადეთ|დააჭირეთ|შეავსეთ|გამოიყენეთ|დაელოდეთ|შეცვალეთ|დაგვიკავშირდით|შედით|გადადით|ნახეთ|გახსენით|ჩაწერეთ|დაწერეთ|მოგვწერეთ|ატვირთეთ|წაშალეთ|დაადასტურეთ|დაამატეთ|დააკავშირეთ|გამორთეთ|დაიწყეთ|დარეგისტრირდით)([^ა-ჰ]|$)/;
    assert.deepEqual(ordinary().filter(([, v]) => FORMAL.test(v)).map(([k, v]) => `${k}: ${v.slice(0, 80)}`), []);
  });

  test('the asker is „კითხვის ავტორი“ (never „მკითხველი“, a reader), sizes are „MB“, mentor money is „ანაზღაურება“', () => {
    assert.deepEqual(ordinary().filter(([, v]) => /მკითხველ/.test(v)).map(([k]) => k), []);
    assert.deepEqual(ordinary().filter(([, v]) => /(^|[^ა-ჰ])მბ([^ა-ჰ]|$)|მეგაბაიტ/.test(v)).map(([k]) => k), []);
    const ka = read('ka');
    assert.equal(ka['settings.tab.payouts'], 'ანაზღაურება');
    assert.deepEqual(Object.entries(ka).filter(([k, v]) => /^(settings\.payouts|dash\.earnings)\./.test(k) && /გადახდის მონაცემ/.test(text(v))).map(([k]) => k), []);
  });

  test('no case ending hyphenated onto a name ({name}-ს, {name}-ის)', () => {
    assert.deepEqual(ordinary().filter(([, v]) => /\{name\}-[ა-ჰ]/.test(v)).map(([k, v]) => `${k}: ${v}`), []);
  });

  test('the earnings note says the money waits for the refund window (its meaning was once inverted)', () => {
    assert.equal(read('ka')['dash.earnings.note'], 'ყოველი პასუხგაცემული კითხვიდან შენი წილი (Wisecall-ის საკომისიოს გამოკლებით) გადასარიცხი ხდება პასუხიდან {days} დღის შემდეგ — ეს დრო საჭიროა, თუ მყიდველმა თანხის დაბრუნება მოითხოვა. შემდეგ Wisecall თანხას შენს საბანკო ანგარიშზე გადმოგირიცხავს.');
  });
});

describe('dates', () => {
  // public/js/i18n.js in a sandbox: a Georgian page, in a browser with and without Georgian locale data.
  function load({ kaLocale }) {
    const store = { wisecall_lang: 'ka' };
    const IntlCopy = Object.create(Intl);
    IntlCopy.DateTimeFormat = Object.assign(function (...a) { return new Intl.DateTimeFormat(...a); }, { supportedLocalesOf: (l) => (kaLocale ? Intl.DateTimeFormat.supportedLocalesOf(l) : []) });
    const window = {};
    const ctx = { window, Intl: IntlCopy, Date, Number, String, Object, Promise, JSON, console,
      localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
      location: { pathname: '/dashboard.html' }, navigator: { language: 'en-GB' }, document: { querySelector: () => null, querySelectorAll: () => [] } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8'), ctx);
    return window.WisecallI18n;
  }
  const when = new Date(2026, 9, 5, 14, 30);

  test('without Georgian locale data the month names are still Georgian', () => {
    const i18n = load({ kaLocale: false });
    assert.equal(i18n.formatDate(when, { day: 'numeric', month: 'long', year: 'numeric' }), '5 ოქტომბერი 2026');
    assert.equal(i18n.formatDate(when, { dateStyle: 'medium', timeStyle: 'short' }), '5 ოქტომბერი 2026, 14:30');
    assert.equal(i18n.formatDate(when, { month: 'long', year: 'numeric' }), 'ოქტომბერი 2026');
    assert.equal(i18n.formatDate('not a date'), '');
  });

  test('with it, the browser formats them', () => {
    const i18n = load({ kaLocale: true });
    assert.match(i18n.formatDate(when, { dateStyle: 'long' }), /2026/);
  });

  test('every page script formats dates through it (no English month names on a Georgian page)', () => {
    const dir = path.join(__dirname, '..', 'public', 'js');
    const direct = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'i18n.js')
      .filter((f) => /toLocale(Date|Time)String\(|new Date\([^)]*\)\.toLocaleString\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    assert.deepEqual(direct, []);
  });
});
