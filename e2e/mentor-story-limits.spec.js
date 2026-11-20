// (named mentor-… so it runs after full-flow.spec.js, which signs the shared e2e admin up through the page itself)
// "ჩემი გზა" refused for one "I can help with" line (docs/CLAUDE-CODE-STORY-SAVE.md), at 375px in Georgian, on Settings -> My details:
//   - each "I can help with" line counts its characters and shows the limit (200); one over it says so under itself, in red
//   - saved with a line over the limit: that line's reason is under it (with the 200), the path, the About and the link are saved anyway,
//     and the line keeps what was typed
//   - shortened to the reported 126 characters: saved, and on the public profile with the path (its line break too)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { client } = require('../tests/helpers');
const S = require('./support');

test.describe.configure({ mode: 'serial' });

const KA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@example.com' };
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const tag = Date.now();
const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), KA[key]);

const ABOUT = 'ოცდაათი წელია ვმუშაობ, ჯერ სახელმწიფო სამსახურში, მერე კერძო სექტორში. ვწერ წიგნებს და ვასწავლი უნივერსიტეტში. ბევრ ახალგაზრდას დავეხმარე, გაერკვია თავის მიზნებში და ეპოვა საკუთარი გზა.';
const P = {
  start: 'ჩემი გზა ოთხმოცდაათიანებში დავიწყე, როცა ქვეყანაში არც სინათლე იყო და არც სამსახური. ბევრს ეგონა, რომ წინ არაფერი გველოდა, და მეც ხშირად ასე მეგონა. ის განცდა, რომ ჩიხში ხარ და გამოსავალი არ ჩანს, დღესაც ბევრ ახალგაზრდას აქვს, ოღონდ სხვა მიზეზებით. სწორედ ეს გვაერთიანებს: გარემოსთან და საკუთარ შიშებთან ბრძოლა, როცა ჯერ არავინ გიცნობს და არავის სჯერა შენი.',
  how: 'სერიოზულად ვეკიდებოდი საქმეს და ამავე დროს არც თავს ვაძლევდი უფლებას, ზედმეტად მძიმედ აღმექვა ყველაფერი. დისციპლინა და ცოტა სილაღე ერთმანეთს არ გამორიცხავს: ჩემთვის სწორედ მათი ერთად ყოფნა აღმოჩნდა გამოსავალი, ყოველ დილით.',
  now: 'მყავს ოჯახი, საკუთარი საქმე და დრო ჰობისთვის. უფროსი არ მყავს.\nფული ჩემთვის თავისუფლებაა, მაგრამ არა მიზანი: ის მხოლოდ საშუალებაა. როცა საშუალება მიზნად იქცევა, იქ იწყება ადამიანის დაკარგვა, და ამას ყოველდღე ვიხსენებ, რომ არ დამავიწყდეს, რისთვის ვმუშაობ და ვისთვის ვცდილობ.'
};
const HELP = 'დაგეხმარები, გაარკვიო რა გინდა სინამდვილეში, დაალაგო პრიორიტეტები და იპოვო ის რესურსებიც, რომლებიც უკვე გაქვს ხელთ მიზნისთვის.';
const TOO_LONG = `${HELP} ${HELP}`.slice(0, 210); // (over 200)
const LINK = 'https://www.example.org/books/a-personal-journey-through-recent-history';

async function adminClient() {
  if (!(await S.sql('SELECT 1 FROM users WHERE email = $1', [ADMIN.email])).length) return S.apiUser(ADMIN.name, ADMIN.email);
  const c = client(S.BASE);
  await c.api('/auth/login', { method: 'POST', body: { email: ADMIN.email, password: S.PASSWORD } });
  return c;
}
const row = async (m) => (await S.sql('SELECT path_start, path_how, path_now, help_points, work_links, bio FROM users WHERE id = $1', [m.id]))[0];

test('a line over the limit is refused alone, in Georgian, with the limit; the rest is saved; shortened, all of it is on the profile', async ({ browser }) => {
  expect([...HELP].length).toBe(126);
  const admin = await adminClient();
  const m = await S.listedMentor(admin, { name: 'სატესტო ლექტორი', email: `limits-${tag}@e2e.test`, niche: 'teaching', roleTitle: 'ლექტორი', price: 30 });
  await S.sql(`UPDATE users SET language = 'ka' WHERE id = $1`, [m.id]);
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(() => { try { localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await S.logIn(page, { email: m.email }, '/ka/settings.html?tab=details#story');
  await expect(page.locator('#ds-pathStart')).toBeVisible();

  await page.fill('#ds-pathStart', P.start);
  await page.fill('#ds-pathHow', P.how);
  await page.fill('#ds-pathNow', P.now);
  await page.fill('#ds-about', ABOUT);
  await page.locator('[data-opt="help"] summary').scrollIntoViewIfNeeded();
  if (!(await page.locator('[data-opt="help"]').evaluate((d) => d.open))) await page.locator('[data-opt="help"] summary').click();
  // the limit is said before anything is typed, and each line counts
  await expect(page.locator('[data-opt="help"] .story-opt-what')).toHaveText(fill('story.help.hint', { max: 200 }));
  await page.fill('#ds-helpPoint-0', TOO_LONG);
  const count = page.locator('#ds-helpPoint-0-count');
  await expect(count).toHaveText(fill('story.count.over', { n: [...TOO_LONG].length, max: 200 }));
  await expect(count).toHaveClass(/is-over/);
  // (in the error colour, not the muted one of a count that is fine)
  const colours = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--red-strong)';
    document.body.appendChild(probe);
    const red = getComputedStyle(probe).color;
    probe.remove();
    return { red, count: getComputedStyle(document.querySelector('#ds-helpPoint-0-count')).color };
  });
  expect(colours.count).toBe(colours.red);
  if (!(await page.locator('[data-opt="links"]').evaluate((d) => d.open))) await page.locator('[data-opt="links"] summary').click();
  await page.locator('[name="workLink"]').first().fill(LINK);

  await page.locator('#storyForm button[type="submit"]').click();
  // the line's reason, under it, with the limit; the box marked and in focus; and by the button: the rest is saved
  const err = page.locator('[data-field-error="helpPoints"]');
  await expect(err).toBeVisible();
  await expect(err).toHaveText(fill('story.err.too_long', { max: 200 }));
  await expect(page.locator('#ds-helpPoint-0')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#ds-helpPoint-0')).toBeFocused();
  await expect(page.locator('#storyError')).toHaveText(KA['story.err.partSaved']);
  await expect.poll(async () => (await row(m)).path_now).toBe(P.now);
  const after1 = await row(m);
  expect(after1.path_start).toBe(P.start);
  expect(after1.path_how).toBe(P.how);
  expect(after1.bio).toBe(ABOUT);
  expect(after1.work_links).toEqual([LINK]);
  expect(after1.help_points).toEqual([]);
  await expect(page.locator('#ds-helpPoint-0')).toHaveValue(TOO_LONG); // (nothing typed is cut)
  // nothing sideways at 375px
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // shortened to the reported 126 characters: saved, the reason gone
  await page.fill('#ds-helpPoint-0', HELP);
  await expect(count).toHaveText(fill('story.count.ok', { n: 126, max: 200 }));
  await expect(err).toBeHidden();
  await page.locator('#storyForm button[type="submit"]').click();
  await expect.poll(async () => (await row(m)).help_points).toEqual([HELP]);
  await expect(page.locator('#storyError')).toHaveText('');

  // on the public profile: the path in three blocks (the line break kept) and the line
  const profile = (await client(S.BASE).api('/users/' + m.username)).profile;
  expect(profile.mentor.trust.path).toEqual({ start: P.start, how: P.how, now: P.now });
  expect(profile.mentor.trust.helpPoints).toEqual([HELP]);
  await ctx.close();
});
