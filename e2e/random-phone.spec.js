// The home page's phone in a browser (docs/CLAUDE-CODE-RANDOM-PHONE.md): with no published answer the example video, marked "მაგალითი";
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

test('no published answer: the example video, marked "მაგალითი", in place of the drawn phone; its caption says it is an example', async ({ browser }) => {
  const { ctx, page } = await open(browser, { reduce: true });
  const phone = page.locator('#homeQa');
  expect(await item(page)).toBe('example-video');
  await expect(phone.locator('.qa-phone')).toBeHidden();
  await expect(phone.locator('.qa-video video')).toBeVisible();
  await expect(phone.locator('.qa-video-tag')).toBeVisible();
  await expect(phone.locator('.qa-video-tag')).toHaveText('მაგალითი');
  await expect(page.locator('#qaCaption')).toContainText('მაგალითი (არა ნამდვილი საუბარი)');
  // (reduced motion: the poster, still; the video is not played)
  expect(await phone.locator('.qa-video video').evaluate((v) => v.paused)).toBe(true);
  // the video's phone takes the drawn phone's place: the same height, nothing moves around it
  const box = await phone.locator('.qa-video').boundingBox();
  expect(Math.round(box.height)).toBe(640);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});

test('one real answer: it comes first, then the example video takes its turn, then the real one again', async ({ browser }) => {
  await publish('tech', 1);
  const { ctx, page } = await open(browser, { clock: true });
  expect(await item(page)).toBe(ids[0]);
  await expect(page.locator('#homeQa .qa-video')).toBeHidden();
  await nextItem(page); // (one loop of the drawn phone)
  await expect(page.locator('#homeQa')).toHaveAttribute('data-item', 'example-video');
  await expect(page.locator('#homeQa .qa-video-tag')).toBeVisible();
  // (a video plays in real time, not on the page's clock: here it ends at once; a browser that cannot play it waits the video's length)
  const playable = await page.locator('#homeQa .qa-video video').evaluate((v) => v.canPlayType('video/mp4; codecs="avc1.42E01E"') !== '');
  if (playable) await page.locator('#homeQa .qa-video video').evaluate((v) => v.dispatchEvent(new Event('ended')));
  else { await page.waitForTimeout(500); await page.clock.runFor(13000); }
  await expect(page.locator('#homeQa')).toHaveAttribute('data-item', ids[0]);
  await ctx.close();
});

test('three or more real ones: only real answers, another one on each loop, never two of a field in a row', async ({ browser }) => {
  await publish('medicine', 2);
  await publish('law', 3);
  const { ctx, page } = await open(browser, { clock: true });
  const phone = page.locator('#homeQa');
  const seen = [await item(page)];
  for (let loop = 0; loop < 6; loop++) {
    await expect(phone.locator('.qa-video')).toBeHidden();
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
