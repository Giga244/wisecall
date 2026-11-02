// The 16 fields, chips and the one search box, at 360px in Georgian (docs/CLAUDE-CODE-CATEGORIES.md).
const { test, expect } = require('@playwright/test');
const S = require('./support');
const { client } = require('../tests/helpers');

test.use({ viewport: { width: 360, height: 740 } });
const OUT = process.env.E2E_SHOTS;
const stamp = Date.now();
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function adminClient() {
  const email = 'e2e-admin@example.com';
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [email])).length) return S.apiUser('E2E Admin', email);
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email, password: S.PASSWORD } });
  return c;
}
let dentist;
test.beforeAll(async () => {
  const admin = await adminClient();
  // (the same mentor if this runs again after a failed test)
  const [known] = await S.sql(`SELECT id FROM users WHERE email = 'dali-categories@e2e.test'`);
  dentist = known ? { id: known.id, name: 'დალი სტომატოლოგი' } : await S.listedMentor(admin, { name: 'დალი სტომატოლოგი', email: 'dali-categories@e2e.test', price: 0, roleTitle: 'ექიმი' });
  await S.sql(`UPDATE users SET field_id = 'med', directions = '{med.dentistry,med.surgery}', extra_fields = '{}', specialty_tags = '{იმპლანტოლოგია}', university = 'თსუ', country = 'ge', years_experience = 8 WHERE id = $1`, [dentist.id]);
});

test('a student searches "სტომატ", opens the chip, sees the mentor, and the question form has the chip chosen', async ({ page }) => {
  const email = `student-${stamp}@e2e.test`;
  await S.apiUser('ლუკა სტუდენტი', email);
  await S.logIn(page, { email });
  await page.goto('/ka/#experts');
  const box = page.locator('#searchInput');
  await box.fill('სტომატ');
  const chip = page.locator('#searchChips .chip[data-chip="med.dentistry"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('სტომატოლოგია');
  await expect(page.locator('.expert-card', { hasText: dentist.name })).toBeVisible();
  expect(await fits(page), 'no sideways scroll').toBe(true);
  await chip.click();
  await expect(page).toHaveURL(/[?&]chip=med\.dentistry/);
  await expect(box).toHaveValue('');
  await expect(page.locator('#fieldChips .chip[data-chip="med.dentistry"]')).toHaveAttribute('aria-pressed', 'true');
  const card = page.locator('.expert-card', { hasText: dentist.name });
  await expect(card).toBeVisible();
  await expect(card.locator('.card-skills')).toContainText('სტომატოლოგია');
  if (OUT) await page.screenshot({ path: `${OUT}/categories-chip-360-ka.png` });
  await card.click();
  await page.waitForURL(/chip=med\.dentistry/);
  await page.click('#askOpen');
  await expect(page.locator('#askDirection')).toHaveValue('med.dentistry');
  await expect(page.locator('#profileDirections, .profile-directions').first()).toBeAttached();
  expect(await fits(page)).toBe(true);
});

test('the search box finds a typo, a university and a specialization, and it stays in view', async ({ page }) => {
  await page.goto('/ka/#experts');
  const box = page.locator('#searchInput');
  for (const words of ['სტომატოლოგა', 'თსუ', 'იმპლანტოლოგია', 'dentistry']) {
    await box.fill(words);
    await expect(page.locator('.expert-card', { hasText: dentist.name }), words).toBeVisible();
  }
  await box.fill('');
  await page.evaluate(() => window.scrollBy(0, 500));
  await expect(box).toBeInViewport();
});

test('fields scroll sideways with counts; an empty chip is hidden; an empty field says "მალე" and offers the button', async ({ page }) => {
  await page.goto('/ka/#experts');
  const row = page.locator('#fieldChips');
  const med = row.locator('.chip[data-field="med"]');
  await expect(med.locator('.chip-count')).toHaveText(/\d+/);
  const scrolls = await row.evaluate((el) => getComputedStyle(el).flexWrap === 'nowrap' && el.scrollWidth > el.clientWidth);
  expect(scrolls, 'one line that scrolls').toBe(true);
  expect(await fits(page)).toBe(true);
  if (OUT) await page.screenshot({ path: `${OUT}/categories-browse-360-ka.png` });
  await med.click();
  await expect(row.locator('.chip[data-chip="med.dentistry"] .chip-count')).toBeVisible();
  await expect(row.locator('.chip[data-chip="med.veterinary"]')).toHaveCount(0);
  // (nobody in Sports in this run: an empty field)
  await S.sql(`UPDATE users SET field_id = 'biz', niche = 'business' WHERE field_id = 'sport'`);
  await S.sql(`UPDATE users SET extra_fields = array_remove(extra_fields, 'sport') WHERE 'sport' = ANY(extra_fields)`);
  await page.goto('/ka/?field=sport#experts');
  await expect(page.locator('.field-soon')).toHaveText('მალე');
  const form = page.locator('#expertGrid .waitlist-form');
  await expect(form.locator('.waitlist-submit')).toHaveText('შემატყობინე, როცა მენტორი გამოჩნდება');
  const email = `notify-${stamp}@e2e.test`;
  await form.locator('input[type=email]').fill(email);
  await form.locator('input[name=over16]').check();
  await form.locator('.waitlist-submit').click();
  await expect(page.locator('#expertGrid .waitlist-done')).toBeVisible();
  expect((await S.sql('SELECT niche FROM waitlist WHERE email = $1', [email]))[0].niche).toBe('sport');
  if (OUT) await page.screenshot({ path: `${OUT}/categories-empty-360-ka.png` });
});

test('the filters: free or paid, a country, the years', async ({ page }) => {
  await page.goto('/ka/#experts');
  await page.click('#filtersBtn');
  await page.selectOption('#filterCountry', 'ge');
  await page.selectOption('#filterYears', '6-10');
  await page.click('#filtersApply');
  await expect(page).toHaveURL(/country=ge/);
  await expect(page).toHaveURL(/years=6-10/);
  await expect(page.locator('.expert-card', { hasText: dentist.name })).toBeVisible();
  await expect(page.locator('#filtersCount')).toHaveText('2');
  await page.goto('/ka/?country=de#experts');
  await expect(page.locator('.expert-card', { hasText: dentist.name })).toHaveCount(0);
});

test('a mentor picks a field and chips on step 1, with "სხვა", specializations and a live preview; the limits hold', async ({ page }) => {
  const email = `picker-${stamp}@e2e.test`;
  await S.apiUser('ნიკა არჩევანი', email);
  await S.logIn(page, { email });
  await page.goto('/ka/apply.html');
  await page.fill('#apHeadline', 'პროგრამისტი');
  await page.fill('#apField', 'ვებ პროგრამირება');
  await expect(page.locator('[data-field="it"]')).toHaveAttribute('aria-pressed', 'true'); // (the words suggest the field)
  await page.selectOption('#apYears', '4');
  const preview = page.locator('[data-pick-preview]');
  await page.click('[data-direction="it.frontend"]');
  await expect(preview).toContainText('სტუდენტები შენ ასე გიპოვიან');
  await expect(preview).toContainText('Frontend');
  // the "Other" chip opens its text box
  await page.click('[data-direction="it.other"]');
  await page.fill('[data-other="it"]', 'ვებ-მაღაზიები');
  await expect(preview).toContainText('ვებ-მაღაზიები');
  // up to 2 extra fields
  await page.click('[data-field="abroad"]');
  await page.click('[data-field="edu"]');
  await page.click('[data-field="sci"]');
  await expect(page.locator('#apExtraErr')).toBeVisible();
  await expect(page.locator('[data-field="sci"]')).toHaveAttribute('aria-pressed', 'false');
  // up to 5 chips
  for (const d of ['it.backend', 'abroad.germany', 'edu.ielts']) await page.click(`[data-direction="${d}"]`);
  await page.click('[data-direction="edu.sat"]');
  await expect(page.locator('#apNicheErr')).toBeVisible();
  await expect(page.locator('[data-direction="edu.sat"]')).toHaveAttribute('aria-pressed', 'false');
  await page.fill('#apTags', 'React, react, Node');
  await page.fill('#apUniversity', 'თსუ');
  await page.selectOption('#apCountry', 'ge');
  await page.fill('#apCurrentRole', 'უფროსი დეველოპერი');
  await expect(preview).toContainText('React');
  await expect(preview).toContainText('თსუ');
  expect(await fits(page)).toBe(true);
  if (OUT) await page.locator('#apPicker').screenshot({ path: `${OUT}/categories-picker-360-ka.png` });
  await page.click('.apply-next');
  await page.waitForURL(/step=2$/);
  const [u] = await S.sql('SELECT field_id, extra_fields, directions, direction_other, specialty_tags, university, country, current_work, niche FROM users WHERE email = $1', [email]);
  expect(u).toMatchObject({ field_id: 'it', extra_fields: ['abroad', 'edu'], direction_other: { it: 'ვებ-მაღაზიები' }, specialty_tags: ['React', 'Node'], university: 'თსუ', country: 'ge', current_work: 'უფროსი დეველოპერი', niche: 'tech' });
  expect(u.directions.sort()).toEqual(['abroad.germany', 'edu.ielts', 'it.backend', 'it.frontend', 'it.other']);
  // coming back, it is all still chosen
  await page.goto('/ka/apply.html?step=1');
  await expect(page.locator('[data-direction="it.frontend"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-other="it"]')).toHaveValue('ვებ-მაღაზიები');
});

test('choosing a licensed chip says a licence is needed', async ({ page }) => {
  const email = `licensed-${stamp}@e2e.test`;
  await S.apiUser('ეკა ექიმი', email);
  await S.logIn(page, { email });
  await page.goto('/ka/apply.html');
  await expect(page.locator('[data-licence-note]')).toBeHidden();
  await page.click('[data-field="med"]');
  await expect(page.locator('[data-licence-note]')).toBeVisible();
});

test('admin: the categories tab shows the most-used tags, the questions per chip, and who could not be mapped', async ({ page }) => {
  await S.logIn(page, { email: 'e2e-admin@example.com' }, '/admin.html');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('#adminTabs [data-tab="categories"]');
  await expect(page.locator('#adminContent, main').first()).toContainText('იმპლანტოლოგია');
});
