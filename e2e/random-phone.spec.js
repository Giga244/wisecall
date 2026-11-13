// The home page's phone in a browser (docs/CLAUDE-CODE-RANDOM-PHONE.md, docs/CLAUDE-CODE-FINISH.md part 1): with no published answer an honest
// example, marked "მაგალითი" (no name, no badge, no stars), played like live texting;
// with one real answer the two take turns; with three or more only real ones, a different one on each loop (the page's clock is run forward); the pinned one
// first; one an admin hid never; with reduced motion one finished conversation that does not change. Runs after full-flow.spec.js (the admin
// account). The answers other tests published are kept off the phone while this file runs, and let back at the end.
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client, longQuestion } = require('../tests/helpers');

const stamp = Date.now();
let admin, mentor, others, days;
const ids = [];
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  mentor = await S.listedMentor(admin, { name: 'ლევან ტელეფონი', email: `phone-mentor-${stamp}@e2e.test`, price: 0, roleTitle: 'მასწავლებელი', niche: 'medicine' });
  others = (await S.sql("UPDATE public_answers SET phone_hidden_at = now() WHERE status = 'published' AND phone_hidden_at IS NULL RETURNING id")).map((r) => r.id);
  await admin.api('/admin/home-qa', { method: 'POST', body: { id: null } });
  days = (await client(S.BASE).api('/config')).answerDeadlineDays;
});
test.afterAll(async () => {
  if (others && others.length) await S.sql('UPDATE public_answers SET phone_hidden_at = NULL WHERE id = ANY($1)', [others]);
  if (ids.length) await S.sql('DELETE FROM public_answers WHERE id = ANY($1)', [ids]); // (the library's own tests count its answers)
  await admin.api('/admin/home-qa', { method: 'POST', body: { id: null } });
});

// A real answered question, published with both people's yes, in the given field.
async function publish(niche, n) {
  const asker = await S.apiUser(`ტელეფონის სტუდენტი ${n}`, `phone-asker-${n}-${stamp}@e2e.test`);
  const asked = await asker.api('/bookings', { method: 'POST', body: { mentorId: mentor.id, question: longQuestion(`კითხვა ნომერი ${n}: ${niche}?`) } });
  if (!asked.booking) throw new Error('ask failed: ' + asked.text);
  const answer = `პასუხი ნომერი ${n}. დაიწყე საფუძვლებით და ყოველდღე ერთი საათი დაუთმე. ჩაწერე, სად შეცდი, და კვირას ისევ გადახედე. `
    + 'ჰკითხე მასწავლებელს, რომელი თემები გვხვდება ყველაზე ხშირად. იპოვე მეგობარი, ვინც იგივეს სწავლობს, რომ ერთმანეთს გამოცადოთ. '
    + 'კვირაში ერთი ნამდვილი შემთხვევა ან სტატია წაიკითხე, არა მხოლოდ სახელმძღვანელო. თვის ბოლოს ჩანაწერებს გადახედე და გადაწყვიტე, რა მოაკლო.';
  const sent = await mentor.client.api(`/bookings/${asked.booking.id}/answer`, { method: 'POST', body: { answer } });
  if (sent.status !== 200) throw new Error('answer failed: ' + sent.text);
  const [b] = await S.sql('SELECT seeker_id, question, answer FROM bookings WHERE id = $1', [asked.booking.id]);
  const [pa] = await S.sql(`INSERT INTO public_answers (booking_id, mentor_id, asker_id, niche, status, asker_consent, asker_decided_at, mentor_consent, mentor_decided_at, question_public, answer_public, slug, published_at)
    VALUES ($1, $2, $3, $4, 'published', true, now(), true, now(), $5, $6, $7, now()) RETURNING id`, [asked.booking.id, mentor.id, b.seeker_id, niche, b.question, b.answer, `phone-e2e-${n}-${stamp}`]);
  ids.push(pa.id);
  return pa.id;
}
const open = async (browser, { reduce = false, clock = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  if (clock) await page.clock.install();
  await page.goto('/ka/');
  await expect(page.locator('#homeQa')).toHaveAttribute('data-item', /.+/);
  return { ctx, page };
};
const item = (page) => page.locator('#homeQa').getAttribute('data-item');
// The page's clock forward a second at a time until the phone shows the next item (a loop is about 11 seconds): that item.
async function nextItem(page) {
  const was = await item(page);
  for (let s = 0; s < 20; s++) {
    await page.clock.runFor(1000);
    const now = await item(page);
    if (now !== was) return now;
  }
  return was;
}

test('no published answer: the example, marked "მაგალითი": "ექსპერტი · მედიცინა", a neutral picture, no badge, no stars, "პასუხი 7 დღეში"', async ({ browser }) => {
  const { ctx, page } = await open(browser, { reduce: true });
  const phone = page.locator('#homeQa');
  expect(await item(page)).toBe('example-1');
  // (at 1280 "მაგალითი" is at the bottom, next to the dots: docs/CLAUDE-CODE-COMPACT-HOME.md; on a phone in the label above the card)
  await expect(phone.locator('.qa-example-foot')).toBeVisible();
  await expect(phone.locator('.qa-example-foot')).toHaveText('მაგალითი');
  await expect(phone.locator('.qa-example')).toHaveText('მაგალითი');
  await expect(phone.locator('.qa-name')).toHaveText('ექსპერტი · მედიცინა');
  await expect(phone.locator('.qa-meta')).toBeHidden(); // (no "verified")
  await expect(phone.locator('.qa-avatar svg')).toHaveCount(1); // (a neutral picture, no letter, no photo)
  await expect(phone.locator('.qa-avatar img, .qa-avatar .avatar')).toHaveCount(0);
  await expect(phone.locator('.qa-aname')).toHaveText(/^ექსპერტი( · მედიცინა)?$/);
  await expect(phone.locator('.qa-aname')).not.toContainText('✓');
  await expect(phone.locator('.qa-rate')).toBeHidden(); // (no stars, no "მადლობა! ⭐ 5.0")
  await expect(phone.locator('.qa-d2')).toHaveCount(0); // (no "2 დღის შემდეგ")
  await expect(phone.locator('.qa-adays')).toHaveText(`✓ პასუხი ${days} დღეში`);
  await expect(phone.locator('.qa-atext')).toHaveText(/^ღირს, თუ მედიცინა/);
  await expect(page.locator('#qaCaption')).toContainText('მაგალითი (არა ნამდვილი საუბარი)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});

test('the example is played like live texting: typed letter by letter with the cursor, sent, the dots, the answer, then the next loop', async ({ browser }) => {
  const { ctx, page } = await open(browser, { clock: true });
  const phone = page.locator('#homeQa');
  await page.clock.runFor(1200);
  // (the question is typed inside its bubble, with a cursor after it)
  const typing = await phone.locator('.qa-qtext').innerText();
  expect(typing.length).toBeGreaterThan(3);
  expect('ბიოლოგია სუსტად მაქვს. ღირს თუ არა სამედიცინოზე ჩაბარება და საიდან დავიწყო?'.startsWith(typing.trim())).toBe(true);
  await expect(phone.locator('.qa-qtext .qa-cur')).toHaveCount(1);
  const sentShown = () => phone.locator('.qa-sent').evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(await sentShown()).toBe(0); // (not sent yet)
  await page.clock.runFor(3500);
  await expect(phone.locator('.qa-q')).toBeVisible();
  await expect(phone.locator('.qa-qtext .qa-cur')).toHaveCount(0);
  expect(await sentShown()).toBe(1);
  await expect(phone.locator('.qa-sent')).toHaveText('გაგზავნილია ✓');
  await page.clock.runFor(1500);
  await expect(phone.locator('.qa-typing')).toBeVisible();
  await page.clock.runFor(1500);
  const part = await phone.locator('.qa-atext').innerText();
  await page.clock.runFor(1500);
  const whole = await phone.locator('.qa-atext').innerText();
  expect(whole.length).toBeGreaterThan(part.length); // (the answer appears letter by letter)
  await expect(phone.locator('.qa-rate')).toBeHidden();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // (the next loop starts again: the question is typed anew, the cursor back)
  let again = false;
  for (let s = 0; s < 30 && !again; s++) { await page.clock.runFor(500); again = (await phone.locator('.qa-qtext .qa-cur').count()) === 1; }
  expect(again).toBe(true);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('one real answer: it comes first, then the example takes its turn, then the real one again', async ({ browser }) => {
  await publish('tech', 1);
  const { ctx, page } = await open(browser, { clock: true });
  expect(await item(page)).toBe(ids[0]);
  await expect(page.locator('#homeQa .qa-example-foot')).toBeHidden();
  await expect(page.locator('#homeQa .qa-name')).toHaveText('ლევან ტელეფონი');
  expect(await nextItem(page)).toBe('example-1');
  await expect(page.locator('#homeQa .qa-example-foot')).toBeVisible(); // (at 1280: next to the dots)
  expect(await nextItem(page)).toBe(ids[0]);
  await ctx.close();
});

test('three or more real ones: only real answers, another one on each loop, never two of a field in a row', async ({ browser }) => {
  await publish('medicine', 2);
  await publish('law', 3);
  const { ctx, page } = await open(browser, { clock: true });
  const phone = page.locator('#homeQa');
  const seen = [await item(page)];
  for (let loop = 0; loop < 6; loop++) {
    await expect(phone.locator('.qa-example-foot')).toBeHidden();
    await expect(phone.locator('.qa-name')).toHaveText('ლევან ტელეფონი');
    seen.push(await nextItem(page));
  }
  expect(seen.every((x) => ids.includes(x)), seen.join()).toBe(true);
  for (let i = 1; i < seen.length; i++) expect(seen[i], 'another one on the next loop').not.toBe(seen[i - 1]);
  const niche = Object.fromEntries((await S.sql('SELECT id, niche FROM public_answers WHERE id = ANY($1)', [ids])).map((r) => [r.id, r.niche]));
  for (let i = 1; i < seen.length; i++) expect(niche[seen[i]]).not.toBe(niche[seen[i - 1]]);
  await ctx.close();
});

test('a pinned answer is shown first; one an admin hid never shows', async ({ browser }) => {
  const [pin, hide] = [ids[1], ids[2]];
  expect((await admin.api('/admin/home-qa', { method: 'POST', body: { id: pin } })).status).toBe(200);
  expect((await admin.api(`/admin/home-qa/${hide}/hide`, { method: 'POST', body: { hidden: true } })).status).toBe(200);
  const { ctx, page } = await open(browser, { clock: true });
  expect(await item(page)).toBe(pin);
  const seen = [];
  for (let loop = 0; loop < 5; loop++) seen.push(await nextItem(page));
  expect(seen).not.toContain(hide);
  await ctx.close();
  await admin.api(`/admin/home-qa/${hide}/hide`, { method: 'POST', body: { hidden: false } });
  await admin.api('/admin/home-qa', { method: 'POST', body: { id: null } });
});

test('reduced motion: one finished conversation, and it does not change', async ({ browser }) => {
  const { ctx, page } = await open(browser, { reduce: true, clock: true });
  const first = await item(page);
  const phone = page.locator('#homeQa');
  await expect(phone.locator('.qa-a')).toBeVisible();
  await expect(phone.locator('.qa-atext')).toHaveText(/\.\.\.$|.{40,}/);
  expect(await phone.locator('.qa-adays').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await page.clock.runFor(40000);
  expect(await item(page)).toBe(first);
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  await ctx.close();
});
