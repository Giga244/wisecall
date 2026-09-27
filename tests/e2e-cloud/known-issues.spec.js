// Problems found by the cloud quality audit, written as browser tests of the behaviour we WANT. They fail today, so each is marked
// test.fixme with the reason and listed in docs/TODO-QUALITY.md. When the fix lands, change test.fixme back to test.
const { test, expect } = require('@playwright/test');
const S = require('../../e2e/support');

const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
let listed; // a listed mentor, made through the API (the journey spec covers the UI)

test.beforeAll(async ({}, info) => {
  const p = info.project.name;
  const [exists] = await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email]);
  const { client } = require('../../tests/helpers');
  let admin;
  if (exists) { admin = client(S.BASE); await admin.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } }); } else admin = await S.apiUser(ADMIN.name, ADMIN.email);
  listed = await S.listedMentor(admin, { name: `Irakli Known ${p}`, email: `${p}-known-${Date.now()}@e2e-cloud.test`, niche: 'tech', price: 45, roleTitle: 'Data engineer' });
});

test.fixme('QUALITY-SEO-1: a mentor profile is readable without calling /api/ (robots.txt disallows /api/ for search engines)', async ({ page }) => {
  // Googlebot obeys robots.txt: it does not fetch /api/users/<name>, which draws the whole profile. Emulate that.
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(`/u/${listed.username}`);
  await expect(page.locator('h1')).toContainText(listed.name);
  await expect(page.locator('main')).toContainText('Data engineer');
});

test.fixme('QUALITY-SEO-2: the Georgian version of a page has its own address, served with lang="ka" and a Georgian title', async ({ request }) => {
  // Today the language lives only in the browser (localStorage), so search engines only ever see English.
  const res = await request.get('/?lang=ka', { headers: { 'Accept-Language': 'ka' } });
  const html = await res.text();
  expect(html).toMatch(/<html[^>]*lang="ka"/);
  expect(html).toMatch(/<link rel="alternate" hreflang="ka"/);
  expect(html).toMatch(/<title>[^<]*[ა-ჰ]/);
});

test.fixme('AUDIT #9: an admin can download a verification document whose file name is in Georgian', async ({ page }) => {
  const m = await S.apiUser('Diploma Person', `${test.info().project.name}-diploma-${Date.now()}@e2e-cloud.test`);
  await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, niche: 'tech', price: 20 } });
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const up = await m.api('/verification/documents/diploma', { method: 'POST', body: pdf, headers: { 'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent('დიპლომი.pdf') } });
  expect(up.status).toBe(201);
  await S.logIn(page, ADMIN);
  const res = await page.request.get(`/api/admin/documents/${up.id}`);
  expect(res.status()).toBe(200); // today: 500, Node refuses the non-ASCII Content-Disposition header
});

test.fixme('AUDIT #3: changing the password signs out the other devices', async ({ browser }) => {
  const email = `${test.info().project.name}-twodevices-${Date.now()}@e2e-cloud.test`;
  const laptop = await browser.newContext();
  const phone = await browser.newContext();
  const a = await laptop.newPage();
  const b = await phone.newPage();
  await S.signUp(a, { name: 'Two Devices', email });
  await S.logIn(b, { email });
  const r = await a.request.post('/api/me/password', { headers: { 'X-Requested-With': 'wisecall' }, data: { currentPassword: S.PASSWORD, newPassword: 'a-brand-new-password-1' } });
  expect(r.status()).toBe(200);
  const me = await (await b.request.get('/api/me')).json();
  expect(me.user).toBeNull(); // today: the phone stays signed in for up to 30 days
  await laptop.close(); await phone.close();
});
