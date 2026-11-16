// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// An EXISTING mentor can save with what they already have (tests/existing-mentor-save.test.js has the rules). On a 375px phone, in
// Georgian, a mentor from before the newer rules (the old free-text story, 7 specialty tags when 5 is the limit now, "current work" as the
// Profile tab took it, no "what I do" line, no field in their own words, no years):
//   - Settings -> My details saves with nothing changed, and with one box changed; a box that IS changed against the rule is marked, says
//     in Georgian what the limit is, and is right again once it is changed
//   - signed out, the dashboard's "add your path" link leads, through log-in, back to that very place
//   - signed out, the application link leads to the sign-up page: a box marked red is right again once it is filled in, and an email that
//     already has an account is shown the way into it (the email carried over), which ends in the application
//   - "Edit my application": step 1 asks for nothing they did not have ("optional"), and "Next" saves it as it is
// The pictures for the owner: E2E_FIX_SHOTS=<folder>.
const { test, expect } = require('@playwright/test');
const { client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_FIX_SHOTS;
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const tag = Date.now();
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
const phoneKa = async (browser) => {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  // (for the pictures only: the test server's support address is a placeholder; the pictures show the live site's own)
  if (SHOTS) await ctx.route('**/api/config', async (route) => { const res = await route.fetch(); await route.fulfill({ response: res, json: { ...(await res.json()), contactEmail: 'support@wisecall.ge' } }); });
  return { ctx, page: await ctx.newPage() };
};

const OLD_STORY = 'ვებ-დიზაინერი ვარ უკვე რვა წელია. დავიწყე პატარა სტუდიაში, სადაც ლოგოებსა და სავიზიტო ბარათებს ვაკეთებდი, შემდეგ ვისწავლე ვებ-გვერდების დიზაინი. ბოლო ხუთი წელია ფრილანსერად ვმუშაობ ქართულ და უცხოურ კლიენტებთან და დამწყებებს ვეხმარები პირველი შეკვეთის პოვნაში.';
const OLD_TAGS = ['ლოგო', 'ბრენდინგი', 'ვებ-დიზაინი', 'UX', 'UI', 'Figma', 'ილუსტრაცია'];
const OLD_WORK = 'ფრილანსერი @ Studio Nova';
const EMAIL = `existing-mentor-${tag}@e2e.test`;
let admin, mentor;

async function adminClient() {
  const email = 'e2e-admin@example.com';
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [email])).length) return S.apiUser('E2E Admin', email); // (this file run on its own)
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email, password: S.PASSWORD } });
  return c;
}

test.beforeAll(async () => {
  admin = await adminClient();
  mentor = await S.listedMentor(admin, { name: 'ელენე ვებდიზაინერი', email: EMAIL, niche: 'design', roleTitle: 'ვებ-დიზაინერი', price: 30 });
  // The row as a mentor from before the newer rules has it (written straight into the test database: nobody can make it through today's forms).
  await S.sql(
    `UPDATE users SET story = $2, bio = $2, headline = NULL, custom_niche = NULL, years_experience = NULL, specialty_tags = $3, current_work = $4,
       path_start = NULL, path_how = NULL, path_now = NULL, start_tags = '{}', sample_question = NULL, sample_reply = NULL, help_points = '{}', work_links = '{}',
       created_at = now() - interval '60 days' WHERE id = $1`, [mentor.id, OLD_STORY, OLD_TAGS, OLD_WORK]);
});

test('Settings -> My details: saved with nothing changed and with one box changed; a changed box against the rule says why, in Georgian', async ({ browser }) => {
  const { ctx, page } = await phoneKa(browser);
  await S.logIn(page, { email: EMAIL }, '/ka/settings.html?tab=details#story');
  const form = page.locator('#detailsForm');
  await expect(form.locator('#dSpecs')).toHaveValue(OLD_TAGS.join(', '));
  await expect(form.locator('#dRole')).toHaveValue(OLD_WORK);
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0); // (nothing is red before anything is pressed)
  // nothing changed: saved
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('#toast')).toContainText('შენახულია');
  await expect(page.locator('#detailsError')).toBeEmpty();
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  // one box changed (the years): saved, the old tags and role as they were
  await form.locator('#dYears').fill('8');
  await form.locator('button[type="submit"]').click();
  await expect.poll(async () => (await S.sql('SELECT years_experience, specialty_tags, current_work FROM users WHERE id = $1', [mentor.id]))[0])
    .toEqual({ years_experience: 8, specialty_tags: OLD_TAGS, current_work: OLD_WORK });
  await expect(page.locator('#detailsError')).toBeEmpty();
  await noOverflow(page);
  if (SHOTS) { await page.evaluate(() => window.scrollTo(0, document.querySelector('#detailsFreeTitle').getBoundingClientRect().top + window.scrollY - 90)); await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/1-my-details-saved-375.png` }); }
  // "My path" is not asked of them: the story form saves with its three boxes empty
  await page.locator('#storyForm button[type="submit"]').click();
  await expect(page.locator('#storyError')).toBeEmpty();
  await expect.poll(async () => (await S.sql('SELECT story FROM users WHERE id = $1', [mentor.id]))[0].story).toBe(OLD_STORY);

  // a box that is changed must fit today's rule: one tag taken off leaves 6, and the limit is 5
  await form.locator('#dSpecs').fill(OLD_TAGS.slice(0, 6).join(', '));
  await form.locator('button[type="submit"]').click();
  // (said right under the box, which is marked and in focus: in sight on a phone)
  await expect(form.locator('#dSpecsErr')).toHaveText('მაქსიმუმ 5 სპეციალიზაცია, თითო 30 სიმბოლომდე, ბმულებისა და მისამართების გარეშე.');
  await expect(form.locator('#dSpecsErr')).toBeInViewport();
  await expect(form.locator('#dSpecs')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('#dSpecs')).toBeFocused();
  await expect(form.locator('[aria-invalid="true"]')).toHaveCount(1); // (only the box it is about)
  const below = await page.evaluate(() => [document.querySelector('#dSpecs').getBoundingClientRect().bottom, document.querySelector('#dSpecsErr').getBoundingClientRect().top, document.querySelector('#dRole').getBoundingClientRect().top]);
  expect(below[0]).toBeLessThan(below[1]);
  expect(below[1]).toBeLessThan(below[2]);
  if (SHOTS) { await expect(page.locator('#toast.show')).toHaveCount(0, { timeout: 8000 }); await page.waitForTimeout(700); await page.screenshot({ path: `${SHOTS}/2-my-details-refused-375.png` }); }
  // changed again: the mark and the line go at once
  await form.locator('#dSpecs').fill(OLD_TAGS.slice(0, 5).join(', '));
  await expect(form.locator('#dSpecs')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('#dSpecsErr')).toBeHidden();
  // the role, changed to something the rule refuses: its own words
  await form.locator('#dRole').fill('დიზაინერი @ სხვა სტუდია');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('#dRoleErr')).toHaveText('მაქსიმუმ 100 სიმბოლო, ბმულების, ელ-ფოსტისა და @ ნიშნის გარეშე.');
  await expect(form.locator('#dRole')).toHaveAttribute('aria-invalid', 'true');
  await form.locator('#dRole').fill('ფრილანსერი ვებ-დიზაინერი');
  await form.locator('button[type="submit"]').click();
  await expect.poll(async () => (await S.sql('SELECT specialty_tags, current_work FROM users WHERE id = $1', [mentor.id]))[0])
    .toEqual({ specialty_tags: OLD_TAGS.slice(0, 5), current_work: 'ფრილანსერი ვებ-დიზაინერი' });
  // (back to the old values for the rest of this file)
  await S.sql('UPDATE users SET specialty_tags = $2, current_work = $3, years_experience = NULL WHERE id = $1', [mentor.id, OLD_TAGS, OLD_WORK]);
  await ctx.close();
});

test('signed out, the dashboard\'s "add your path" link: log-in leads back to that very place', async ({ browser }) => {
  const { ctx, page } = await phoneKa(browser);
  await page.goto('/ka/settings.html?tab=details#story');
  await page.waitForURL((u) => u.pathname === '/login.html');
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/settings.html?tab=details#story');
  await page.fill('#email', EMAIL);
  await page.fill('#password', S.PASSWORD);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname.endsWith('/settings.html') && u.search === '?tab=details' && u.hash === '#story');
  await expect(page.locator('#tab-details')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#storyForm')).toBeVisible();
  await expect(page.locator('#detailsStoryTitle')).toBeInViewport();
  await ctx.close();
});

test('signed out, the application link: the sign-up page marks nothing red once it is filled in, and an email that has an account is shown the way in', async ({ browser }) => {
  const { ctx, page } = await phoneKa(browser);
  await page.goto('/ka/apply.html');
  await page.waitForURL(/\/ka\/signup\.html\?as=mentor$/);
  // the way in, on top, for somebody who already started
  const returning = page.locator('.auth-returning');
  await expect(returning).toHaveText('უკვე დაწყებული გაქვს განაცხადი? შედი და გააგრძელე');
  await expect(returning.locator('a')).toHaveAttribute('href', /\/login\.html\?as=mentor$/);
  // sent empty: the name box, marked, with its own words
  await page.click('#signupForm button[type="submit"]');
  await expect(page.locator('#formError')).toHaveText('ჩაწერე სახელი და გვარი.');
  await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'true');
  // filled in: right again at once (it used to stay red until the next try)
  await page.fill('#name', 'ელენე ვებდიზაინერი');
  await expect(page.locator('#name')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#formError')).toBeEmpty();
  await page.click('#signupForm button[type="submit"]');
  await expect(page.locator('#formError')).toHaveText('ჩაწერე ელ-ფოსტა.');
  await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
  await page.fill('#email', EMAIL);
  await expect(page.locator('#email')).not.toHaveAttribute('aria-invalid', 'true');
  await page.fill('#password', S.PASSWORD);
  await page.check('#adult');
  await expect(page.locator('#existingAccount')).toBeHidden();
  await page.click('#signupForm button[type="submit"]');
  // her own email is not "wrong": it has an account, and the page shows the way into it
  await expect(page.locator('#formError')).toHaveText('ეს ელ-ფოსტა უკვე გამოყენებულია. შედი ამ ანგარიშით ან გამოიყენე სხვა ელ-ფოსტა.');
  await expect(page.locator('#existingLogin')).toBeVisible();
  await expect(page.locator('#existingLogin')).toHaveText('შესვლა ამ ანგარიშით');
  // (the way in is the page's main button now; creating an account is the other one)
  await expect(page.locator('#existingLogin')).toHaveClass(/btn-primary/);
  await expect(page.locator('#signupForm button[type="submit"]')).toHaveClass(/btn-outline/);
  await noOverflow(page);
  if (SHOTS) { await page.locator('#existingLogin').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/3-signup-existing-account-375.png` }); }
  await page.locator('#existingLogin').click();
  await page.waitForURL((u) => u.pathname.endsWith('/login.html') && u.searchParams.get('as') === 'mentor');
  expect(page.url()).not.toContain('e2e.test'); // (the email is never in the address)
  await expect(page.locator('#email')).toHaveValue(EMAIL);
  await expect(page.locator('#password')).toBeFocused();
  await page.fill('#password', S.PASSWORD);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL((u) => u.pathname.endsWith('/apply.html'));
  await expect(page.locator('.apply-done h1')).toBeVisible(); // (her application, as it stands)
  await ctx.close();
});

test('"Edit my application": step 1 asks for nothing they did not have, and "Next" saves it as it is', async ({ browser }) => {
  const { ctx, page } = await phoneKa(browser);
  await S.logIn(page, { email: EMAIL }, '/ka/apply.html');
  await page.locator('[data-edit]').click();
  await page.locator('dialog.wc-dialog[open] [data-ok]').click();
  await expect(page.locator('#applySteps')).toBeVisible();
  // step 1, with what she has: nothing marked, nothing "still missing"
  await page.locator('#applySteps [data-goto="0"]').click();
  const form = page.locator('form.apply-step[data-step="0"]');
  await expect(form.locator('h1')).toBeVisible();
  await expect(page.locator('.apply-gap')).toHaveCount(0);
  await expect(page.locator('#applySteps li').nth(0)).toHaveClass(/is-done/);
  await expect(page.locator('#applySteps li').nth(0)).not.toHaveClass(/has-gap/);
  for (const id of ['apHeadline', 'apField', 'apYears']) {
    await expect(form.locator(`label[for="${id}"] .apply-optional-mark`)).toHaveText('(არასავალდებულო)');
    await expect(form.locator(`#${id}`)).not.toHaveAttribute('required', '');
  }
  await expect(form.locator('#apTags')).toHaveValue(OLD_TAGS.join(', '));
  await expect(form.locator('#apCurrentRole')).toHaveValue(OLD_WORK);
  await noOverflow(page);
  if (SHOTS) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/4-apply-step1-optional-375.png`, fullPage: true }); }
  // "Next" with nothing filled in: saved, and on to step 2 (it used to stay here, red, with "at most 8 tags of 40" under the form)
  await form.locator('.apply-next').click();
  await page.waitForURL(/step=2$/);
  await expect(page.locator('form.apply-step[data-step="1"] h1')).toHaveText('ჩემი გზა');
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  expect((await S.sql('SELECT specialty_tags, current_work, headline, custom_niche, years_experience FROM users WHERE id = $1', [mentor.id]))[0])
    .toEqual({ specialty_tags: OLD_TAGS, current_work: OLD_WORK, headline: null, custom_niche: null, years_experience: null });
  // step 2: her old story counts, "My path" is not required
  await page.locator('form.apply-step[data-step="1"] .apply-next').click();
  await page.waitForURL(/step=3$/);
  // back on step 1, a box changed against the rule says so under itself, with the real limit
  await page.locator('#applySteps [data-goto="0"]').click();
  const again = page.locator('form.apply-step[data-step="0"]');
  await again.locator('#apTags').fill(OLD_TAGS.slice(0, 6).join(', '));
  await again.locator('.apply-next').click();
  await expect(again.locator('[data-error-for="tags"]')).toHaveText('მაქსიმუმ 5 სპეციალიზაცია, თითო 30 სიმბოლომდე, ბმულების გარეშე.');
  await expect(again.locator('#apTags')).toHaveAttribute('aria-invalid', 'true');
  await again.locator('#apTags').fill(OLD_TAGS.slice(0, 5).join(', '));
  await expect(again.locator('#apTags')).toHaveAttribute('aria-invalid', 'false');
  await expect(again.locator('[data-error-for="tags"]')).toBeHidden();
  await ctx.close();
});
