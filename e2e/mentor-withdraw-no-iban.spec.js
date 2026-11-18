// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// A bank account is not needed to be shown on the site (tests/payout-at-withdrawal.test.js has the rules). In the browser, at 375px, in
// Georgian, an approved mentor with a price and no IBAN:
//   - is in Browse experts and on their profile with "დასვი კითხვა" (nothing sends them to add an IBAN first)
//   - sees one card on the dashboard once money is on their balance: "დაამატე საბანკო ანგარიში თანხის გასატანად"
//   - presses "გაიტანე": the form asks for the account right there; a holder name that is not the name on the ID is refused under that box;
//     the right one saves the account and the request goes on; the card is gone, and Settings → ანაზღაურება shows the account
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client, bookAndPay, longAnswer, approveMentor, SAMPLE } = require('../tests/helpers');

test.describe.configure({ mode: 'serial' });

const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const SHOTS = process.env.E2E_BANK_SHOTS;
const tag = Date.now();
const NAME = 'ნინო სატესტო';
let admin, mentor, ctx, page;

const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const shot = async (locator, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await locator.screenshot({ path: path.join(SHOTS, name) }); };

test.beforeAll(async ({ browser }) => {
  admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  // an approved mentor with a price, the ID check passed under their name, and no bank account
  const email = `noiban-${tag}@e2e.test`;
  const c = await S.apiUser(NAME, email);
  expect((await c.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'კონსულტანტი', niche: 'business', price: 130, sampleAnswer: SAMPLE } })).status).toBe(200);
  const k = await c.api('/verification/kyc/start', { method: 'POST' });
  await client(S.BASE).api(`/mock-kyc/sessions/${k.url.split('session=')[1]}/complete`, { method: 'POST', body: { outcome: 'approve', fullName: NAME, dateOfBirth: '1985-04-12' } });
  const me0 = (await c.api('/me')).user;
  await expect.poll(async () => (await S.sql(`SELECT 1 FROM kyc_sessions WHERE user_id = $1 AND status = 'approved'`, [me0.id])).length, { timeout: 15000 }).toBe(1);
  await approveMentor(admin, c);
  await S.sql(`UPDATE users SET language = 'ka' WHERE id = $1`, [me0.id]);
  const me = (await c.api('/me')).user;
  mentor = { client: c, id: me.id, username: me.username, email };
  expect(me.hasPayoutDetails).toBe(false);
  expect(me.isListedMentor).toBe(true);
  ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  page = await ctx.newPage();
});
test.afterAll(async () => { if (ctx) await ctx.close(); });

test('shown on the site without a bank account: Browse experts and the profile', async () => {
  await page.goto(`/ka/u/${mentor.username}`);
  await expect(page.locator('h1')).toContainText(NAME);
  await expect(page.locator('text=დასვი კითხვა >> visible=true').first()).toBeVisible(); // (they can be asked)
  const found = await client(S.BASE).api('/experts?q=' + encodeURIComponent('სატესტო'));
  expect(found.experts.some((e) => e.id === mentor.id)).toBe(true);
  // their own pages never send them to add an IBAN to be listed
  await S.logIn(page, { email: mentor.email }, '/ka/settings.html?tab=payouts');
  await expect(page.locator('#payoutStatus')).toHaveText(KA['settings.payouts.notSaved']);
  expect(await noSideways()).toBeLessThanOrEqual(0);
});

test('money on the balance: the dashboard card, then "გაიტანე" asks for the account; a wrong holder name is refused, the right one goes on', async () => {
  // no money yet: no card
  await page.goto('/ka/dashboard.html');
  await expect(page.locator('#dashTabs')).toBeVisible();
  await expect(page.locator('#bankCard')).toBeHidden();
  // a paid, answered question: 104 ₾ of 130 ₾, available now
  const asker = await S.apiUser('Walt NoIban', `noiban-asker-${tag}@e2e.test`);
  const b = await bookAndPay(S.BASE, asker, mentor.id, 'How do I price my first consulting project for a small shop?');
  expect((await mentor.client.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('Start from the value to the shop.') } })).status).toBe(200);
  await S.sql(`UPDATE bookings SET answer_review = 'released', answer_released_at = now() WHERE id = $1 AND answer_review = 'held'`, [b.id]);
  await S.sql(`INSERT INTO payouts (booking_id, mentor_id, amount, currency, payable_at) SELECT id, mentor_id, mentor_net_amount, currency, now() - interval '1 minute' FROM bookings WHERE id = $1
    ON CONFLICT (booking_id) DO UPDATE SET payable_at = now() - interval '1 minute'`, [b.id]);

  await page.reload();
  const card = page.locator('#bankCard .bank-card');
  await expect(card).toBeVisible();
  await expect(card.locator('h2')).toHaveText(KA['dash.bank.title']);
  await expect(card).toContainText('104.00');
  await expect(card.locator('a')).toHaveAttribute('href', /settings\.html\?tab=payouts/);
  expect(await noSideways()).toBeLessThanOrEqual(0);
  await shot(card, 'bank-card-375.png');

  // the Balance card: "გაიტანე" with the bank account asked for right there
  await page.goto('/ka/dashboard.html?tab=earnings');
  const form = page.locator('#balanceCard .bal-withdraw');
  await expect(form.locator('.bal-bank legend')).toHaveText(KA['bal.bank.title']);
  await expect(form.locator('button[type="submit"]')).toContainText('104.00');
  expect(await noSideways()).toBeLessThanOrEqual(0);
  await shot(page.locator('#balanceCard'), 'withdraw-asks-bank-375.png');
  // nothing typed: said under the box
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-bank-error="name"]')).toHaveText(KA['settings.payouts.err.name']);
  // somebody else's name: refused under the name box, nothing saved, no request
  await form.locator('[name="payoutName"]').fill('გიორგი სხვაგვარი');
  await form.locator('[name="payoutIban"]').fill('GE29 NB00 0000 0101 9049 17');
  await form.locator('[name="currentPassword"]').fill(S.PASSWORD);
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-bank-error="name"]')).toHaveText(KA['bal.bank.err.name']);
  await expect(form.locator('[name="payoutName"]')).toBeFocused();
  await expect(form.locator('[name="payoutIban"]')).toHaveValue('GE29 NB00 0000 0101 9049 17'); // (nothing typed is cleared)
  expect((await S.sql('SELECT payout_iban_enc FROM users WHERE id = $1', [mentor.id]))[0].payout_iban_enc).toBeNull();
  expect(await S.sql('SELECT 1 FROM payout_batches WHERE mentor_id = $1', [mentor.id])).toHaveLength(0);
  await shot(page.locator('#balanceCard'), 'withdraw-wrong-name-375.png');
  // a wrong IBAN: under the IBAN box
  await form.locator('[name="payoutName"]').fill(NAME);
  await form.locator('[name="payoutIban"]').fill('GE00 XX00 0000 0000 0000 00');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-bank-error="iban"]')).toHaveText(KA['settings.payouts.err.iban']);
  // the right details: saved, and the request goes on
  await form.locator('[name="payoutIban"]').fill('GE29 NB00 0000 0101 9049 17');
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('#balanceCard')).toContainText(KA['bal.requested']);
  await expect(page.locator('#balanceCard .bal-withdraw')).toHaveCount(0);
  const saved = (await S.sql('SELECT payout_name, payout_iban_last4 FROM users WHERE id = $1', [mentor.id]))[0];
  expect(saved).toEqual({ payout_name: NAME, payout_iban_last4: '4917' });
  expect((await S.sql(`SELECT status, iban_last4 FROM payout_batches WHERE mentor_id = $1`, [mentor.id]))[0]).toEqual({ status: 'requested', iban_last4: '4917' });

  // the card is gone; Settings → ანაზღაურება shows the account
  await page.goto('/ka/dashboard.html');
  await expect(page.locator('#dashTabs')).toBeVisible();
  await expect(page.locator('#bankCard')).toBeHidden();
  await page.goto('/ka/settings.html?tab=payouts');
  await expect(page.locator('#payoutIban')).toHaveValue('GE29 NB00 0000 0101 9049 17');
  await expect(page.locator('#payoutStatus')).toContainText(KA['settings.payouts.saved']);
});

test('the admin sees the request with the IBAN given at the withdrawal, and whether a mentor has a bank account', async ({ browser }) => {
  const actx = await browser.newContext();
  const apage = await actx.newPage();
  await S.logIn(apage, { email: 'e2e-admin@example.com' }, '/admin.html?tab=mentors&status=verified');
  const row = apage.locator('.mv-card').filter({ hasText: mentor.email });
  await expect(row.locator('.mv-payout-chip')).toBeVisible();
  await apage.click('#adminTabs [data-tab="payouts"]');
  await expect(apage.locator('.wd-request', { hasText: NAME })).toContainText('GE29 NB00 0000 0101 9049 17');
  await actx.close();
});
