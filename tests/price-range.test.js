// A mentor's price: free (0), or 5 to 200 ₾ (server/config.js PRICE_MIN / PRICE_MAX, the one place for the range):
//   - 200 is accepted, 201 is refused, 0 (free) still works, 4 is refused: by the mentor (My details, the application) and by an admin
//   - the pages and texts follow the same value: /api/config, the page script's fallback, the number boxes, every text that names it
//   - a mentor whose price was set above 200 before is never changed automatically: their price is kept, sent back unchanged it is
//     accepted, only a new price must fit; admin → Mentors lists them
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { ROOT, resetDatabase, startServer, client, signupVerified, approveMentor, addPayoutDetails } = require('./helpers');
const config = require('../server/config');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin;

before(async () => {
  await resetDatabase();
  srv = await startServer(4887, { RATE_LIMIT_MULTIPLIER: '50' });
  base = srv.base;
  admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
});
after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

let n = 0;
async function mentor(name) {
  n += 1;
  const c = await signupVerified(base, name, `price-${n}@example.com`);
  assert.equal((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, price: 20, headline: 'Web designer' } })).status, 200);
  assert.equal((await c.api('/verification/experience', { method: 'PUT', body: { roleTitle: 'Web designer', customNiche: 'Web design', niche: 'design', yearsExperience: 6 } })).status, 200);
  const id = (await c.api('/me')).user.id;
  return { c, id };
}
const setPrice = (c, price) => c.api('/me', { method: 'PATCH', body: { price } });
const priceOf = async (id) => (await pool.query('SELECT price FROM users WHERE id = $1', [id])).rows[0].price;

describe('the range', () => {
  test('one value: config.PRICE_MAX is 200 (and PRICE_MIN 5), and the site says so', async () => {
    assert.equal(config.PRICE_MIN, 5);
    assert.equal(config.PRICE_MAX, 200);
    const c = await client(base).api('/config');
    assert.deepEqual([c.priceMin, c.priceMax], [5, 200]);
    // (the page script's fallback, before /api/config answers, is the same)
    const src = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
    assert.match(src, new RegExp(`priceMin: ${config.PRICE_MIN}, priceMax: ${config.PRICE_MAX},`));
  });

  test('the mentor: 200 is accepted, 201 is refused, 0 (free) works, 4 is refused, 5 is accepted', async () => {
    const m = await mentor('Range Mentor');
    for (const [price, ok] of [[200, true], [201, false], [0, true], [4, false], [5, true], [2000, false], [-1, false]]) {
      const r = await setPrice(m.c, price);
      if (ok) {
        assert.equal(r.status, 200, `${price}: ${r.text}`);
        assert.equal(await priceOf(m.id), price);
      } else {
        assert.equal(r.status, 400, String(price));
        assert.equal(r.error, 'invalid_price', String(price));
      }
    }
    assert.equal(await priceOf(m.id), 5, 'a refused price changes nothing');
  });

  test('an admin, with a reason: 200 is accepted, 201 is refused, free works', async () => {
    const m = await mentor('Admin Range');
    await approveMentor(admin, m.c);
    await addPayoutDetails(m.c);
    const set = (price) => admin.api(`/admin/mentors/${m.id}/price`, { method: 'POST', body: { price, reason: 'Checked with the mentor by phone' } });
    assert.equal((await set(201)).error, 'invalid_price');
    assert.equal((await set(4)).error, 'invalid_price');
    assert.equal((await set(200)).status, 200);
    assert.equal(await priceOf(m.id), 200);
    assert.equal((await set(0)).status, 200);
    assert.equal(await priceOf(m.id), 0);
  });
});

describe('the texts and the price boxes', () => {
  test('no text names the old maximum: they say {priceMax}, filled in from the config', () => {
    for (const f of ['en.json', 'ka.json', 'admin-en.json', 'admin-ka.json']) {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n', f), 'utf8'));
      for (const k of ['settings.mentor.price', 'settings.mentor.price.invalid', 'rq.err.budget', 'admin.price.invalid', 'admin.rq.outreach', 'apply.err.price', 'price.mode.paid', 'faq.2.a', 'price.sub', 'mentors.1.body']) {
        if (d[k] === undefined) continue;
        assert.match(d[k], /\{priceMax\}/, `${f} ${k}`);
        assert.doesNotMatch(d[k], /2[ ,.]?000/, `${f} ${k}`);
      }
    }
    for (const f of ['public/js/price-block.js', 'public/js/admin-mentors.js', 'public/settings.html', 'public/find-a-mentor.html', 'public/become-a-mentor.html']) {
      assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /max="2000"|> 2000\)|2000 ₾/, f);
    }
  });

  test('the pages: the number boxes say max="200", and the texts say 200 ₾', async () => {
    const page = async (p) => (await fetch(base + p, { headers: { Accept: 'text/html' } })).text();
    const settings = await page('/settings.html');
    assert.match(settings, /id="price" min="5" max="200"/);
    const match = await page('/match');
    assert.match(match, /id="rqMin" min="5" max="200"/);
    assert.match(match, /id="rqMax" min="5" max="200"/);
    for (const p of ['/ka/become-a-mentor.html', '/en/become-a-mentor.html', '/ka/faq.html', '/en/faq.html']) {
      const html = await page(p);
      assert.match(html, /200 ₾|200-მდე|200 ₾-მდე/, p);
      assert.doesNotMatch(html, /2000 ₾|2000-მდე|2,000 ₾/, p);
    }
  });
});

describe('mentors whose price was set above 200 before', () => {
  test('kept as it is: sent back unchanged it is accepted, only a new price must fit; admin → Mentors lists them', async () => {
    const old = await mentor('Old High Price');
    await approveMentor(admin, old.c);
    await addPayoutDetails(old.c);
    await pool.query('UPDATE users SET price = 500 WHERE id = $1', [old.id]); // (set before the maximum was lowered)
    const fine = await mentor('Fine Price');
    // nothing changed it
    assert.equal(await priceOf(old.id), 500);
    assert.equal((await old.c.api('/me')).user.price, 500);
    // sent back as it is (a page that saves the whole form): accepted, still 500
    const same = await old.c.api('/me', { method: 'PATCH', body: { price: 500, headline: 'Senior web designer' } });
    assert.equal(same.status, 200, same.text);
    assert.equal(await priceOf(old.id), 500);
    // a new price above 200 is refused; within it, saved
    assert.equal((await setPrice(old.c, 450)).error, 'invalid_price');
    assert.equal(await priceOf(old.id), 500);
    // still asked at: a question at 500 ₾ is not refused
    const seeker = await signupVerified(base, 'Price Seeker', 'price-seeker@example.com');
    const q = await seeker.api('/bookings', { method: 'POST', body: { mentorId: old.id, question: require('./helpers').longQuestion('How do I price my first logo design job for a small local cafe?') } });
    assert.equal(q.status, 201, q.text);
    assert.equal(q.booking.amount, 50000);
    // admin → Mentors: the list
    const list = await admin.api('/admin/price-over-max');
    assert.equal(list.status, 200, list.text);
    assert.equal(list.max, 200);
    assert.deepEqual(list.mentors.map((m) => [m.id, m.price, m.status]), [[old.id, 500, 'verified']]);
    assert.ok(!list.mentors.some((m) => m.id === fine.id));
    assert.equal((await seeker.api('/admin/price-over-max')).status, 403);
    // they lower it themselves: off the list
    assert.equal((await setPrice(old.c, 150)).status, 200);
    assert.deepEqual((await admin.api('/admin/price-over-max')).mentors, []);
  });
});
