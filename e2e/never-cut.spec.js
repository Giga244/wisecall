// A mentor's text is never cut, in a browser (docs/CLAUDE-CODE-FINISH.md part 2): a Settings page opened while "About me" was half its
// story does not write the half back when something else is saved there; an "About me" changed elsewhere is not overwritten without the
// mentor knowing (what they typed stays); and a pasted text longer than the limit stays whole in the box and is refused, not cut. Runs
// after full-flow.spec.js (the admin account). (The server's side: tests/never-cut.test.js.)
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

const stamp = Date.now();
const PARA = 'ვმუშაობდი ბრიუსელში და ვკითხულობ ლექციებს რამდენიმე უნივერსიტეტში, ვეხმარები სტუდენტებს სწორი გზის არჩევაში. ';
const FULL = Array.from({ length: 9 }, (x, i) => `${i + 1}. ${PARA}`).join('\n\n');
const HALF = [...FULL].slice(0, 525).join('');
let mentor;

test.beforeAll(async () => {
  const admin = client(S.BASE);
  await admin.api('/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: S.PASSWORD } });
  mentor = await S.listedMentor(admin, { name: 'ირაკლი ტექსტი', email: `never-cut-${stamp}@e2e.test`, niche: 'teaching', roleTitle: 'ასისტენტ-პროფესორი' });
  // "About me" holds only the first part of the story, as it did while the story was being written
  await S.sql('UPDATE users SET bio = $2, story = $3 WHERE id = $1', [mentor.id, HALF, FULL]);
});
const bio = async () => (await S.sql('SELECT bio FROM users WHERE id = $1', [mentor.id]))[0].bio;

test('a Settings page opened on the half text, saved later for another field, leaves the whole "About me" alone', async ({ page }) => {
  await S.logIn(page, { email: mentor.email }, '/settings.html');
  await expect(page.locator('#bio')).toHaveValue(HALF);
  // meanwhile the whole text arrives (the story copied in, or another tab)
  await S.sql('UPDATE users SET bio = $2 WHERE id = $1', [mentor.id, FULL]);
  await page.fill('#headline', 'ლექტორი და დიპლომატი');
  await page.click('#profileForm button[type="submit"]');
  await expect(page.locator('#profileError')).toHaveText('');
  await expect.poll(async () => (await S.sql('SELECT headline FROM users WHERE id = $1', [mentor.id]))[0].headline).toBe('ლექტორი და დიპლომატი');
  expect(await bio()).toBe(FULL);
});

test('"About me" changed elsewhere since the page opened: the save is refused with a message, what was typed stays, the next save is deliberate', async ({ page }) => {
  await S.logIn(page, { email: mentor.email }, '/settings.html');
  await expect(page.locator('#bio')).toHaveValue(FULL);
  await S.sql('UPDATE users SET bio = $2 WHERE id = $1', [mentor.id, `${FULL}\n\nდამატებული სხვა ჩანართიდან.`]);
  const typed = `${FULL}\n\nჩემი ახალი წინადადება.`;
  await page.fill('#bio', typed);
  await page.click('#profileForm button[type="submit"]');
  await expect(page.locator('#profileError')).toContainText('was changed somewhere else');
  await expect(page.locator('#bio')).toHaveValue(typed);
  expect(await bio()).toBe(`${FULL}\n\nდამატებული სხვა ჩანართიდან.`);
  await page.click('#profileForm button[type="submit"]');
  await expect.poll(bio).toBe(typed);
});

test('a pasted "About me" over 2000 characters stays whole in the box and is refused, not cut', async ({ page }) => {
  await S.logIn(page, { email: mentor.email }, '/settings.html');
  const long = 'ა'.repeat(2100);
  await page.locator('#bio').evaluate((el, v) => { el.focus(); el.value = ''; }, long);
  await page.locator('#bio').fill(long);
  expect(await page.locator('#bio').evaluate((el) => el.value.length)).toBe(2100);
  await expect(page.locator('#bioCount')).toHaveClass(/is-over/);
  await page.click('#profileForm button[type="submit"]');
  await expect(page.locator('#profileError')).toContainText('2000');
  expect((await bio()).length).toBeLessThan(2100);
  expect(await page.locator('#bio').evaluate((el) => el.value.length)).toBe(2100);
});

// ---- The cards show the first lines of a long bio, with "Read more →"; the profile shows all of it; the stored text stays whole
const lines = (loc) => loc.evaluate((el) => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)));
for (const [width, lang, want] of [[1280, 'ka', 3], [360, 'ka', 2], [1280, 'en', 3], [360, 'en', 2]]) {
  test(`${width}px ${lang}: a long bio is clamped to ${want} lines on Browse and the home page, "Read more" opens the whole text; a short one has no link`, async ({ browser }) => {
    await S.sql('UPDATE users SET bio = $2 WHERE id = $1', [mentor.id, FULL]);
    const short = await S.listedMentor(client(S.BASE), { name: `მოკლე ბიო ${width}${lang}`, email: `short-bio-${width}${lang}-${stamp}@e2e.test`, niche: 'teaching' }).catch(() => null);
    if (short) await S.sql("UPDATE users SET bio = 'მოკლე ტექსტი.' WHERE id = $1", [short.id]);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript((l) => { try { localStorage.setItem('wisecall_lang', l); } catch (e) { /* none */ } }, lang);
    const page = await ctx.newPage();
    const more = lang === 'ka' ? 'სრულად ნახვა →' : 'Read more →';
    // Browse
    await page.goto(`${lang === 'ka' ? '/ka' : ''}/experts.html?q=${encodeURIComponent('ირაკლი ტექსტი')}`);
    const card = page.locator('.expert-card', { hasText: 'ირაკლი ტექსტი' });
    await expect(card).toBeVisible();
    const text = card.locator('.card-bio-text');
    expect(await lines(text)).toBe(want);
    expect(await text.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(card.locator('.card-more')).toBeVisible();
    await expect(card.locator('.card-more')).toHaveText(more);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // a short bio: whole on the card, no link
    if (short) {
      await page.goto(`${lang === 'ka' ? '/ka' : ''}/experts.html?q=${encodeURIComponent(short.name)}`);
      const s = page.locator('.expert-card', { hasText: short.name });
      await expect(s.locator('.card-bio-text')).toHaveText('მოკლე ტექსტი.');
      await expect(s.locator('.card-more')).toBeHidden();
      await page.goto(`${lang === 'ka' ? '/ka' : ''}/experts.html?q=${encodeURIComponent('ირაკლი ტექსტი')}`);
    }
    // "Read more" (the card) opens the profile: the whole text, its paragraphs kept
    await card.locator('.card-more').click();
    await page.waitForURL(/\/u\//);
    const about = page.locator('.profile-about p');
    await expect(about).toBeVisible();
    expect(await about.textContent()).toBe(FULL);
    expect(await about.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    // the home page's card: the same clamp, and its link to the profile (the other mentors shown there step aside meanwhile)
    const shown = (await S.sql('UPDATE users SET show_on_home = false WHERE show_on_home AND id <> $1 RETURNING id', [mentor.id])).map((r) => r.id);
    await S.sql('UPDATE users SET show_on_home = true WHERE id = $1', [mentor.id]);
    try {
      await page.goto(lang === 'ka' ? '/ka/' : '/');
      const home = page.locator('#homeMentorsList .lexpert', { hasText: 'ირაკლი ტექსტი' });
      await expect(home).toBeVisible();
      expect(await lines(home.locator('.lexpert-bio'))).toBe(want);
      await expect(home.locator('.lexpert-more')).toBeVisible();
      await expect(home.locator('.lexpert-more')).toHaveText(more);
      await home.locator('.lexpert-more').click();
      await page.waitForURL(/\/u\//);
      expect(await page.locator('.profile-about p').textContent()).toBe(FULL);
    } finally {
      await S.sql('UPDATE users SET show_on_home = false WHERE id = $1', [mentor.id]);
      if (shown.length) await S.sql('UPDATE users SET show_on_home = true WHERE id = ANY($1)', [shown]);
    }
    expect(await bio()).toBe(FULL); // (only the display is short)
    await ctx.close();
  });
}
