// Georgian pages keep the visitor in Georgian (docs/CLAUDE-CODE-WALKTHROUGH-FIXES.md #1, #2): every link a Georgian page shows, the
// header's and the footer's too (drawn by the scripts), leads to a /ka address; there is no link to live sessions; and a visitor who chose
// Georgian earlier and opens the English address of the help centre or the answers is sent to the Georgian page.
const { test, expect } = require('@playwright/test');

const FILE = /\.(png|svg|ico|xml|txt|pdf|webmanifest|css|js|woff2)(\?|$)/;
const english = (hrefs) => hrefs.filter((h) => h.startsWith('/') && !h.startsWith('//') && !/^\/ka(\/|$|[?#])/.test(h) && !/^\/(api|js|css|fonts)\//.test(h) && !FILE.test(h));

for (const p of ['/ka/', '/ka/about.html', '/ka/faq.html', '/ka/help.html', '/ka/become-a-mentor.html', '/ka/how-we-verify.html', '/ka/answers', '/ka/contact.html']) {
  test(`${p}: every link (header and footer too) stays in Georgian`, async ({ page }) => {
    await page.goto(p);
    await expect(page.locator('footer a[href]').first()).toBeAttached();
    await page.waitForLoadState('networkidle');
    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(english(hrefs), p).toEqual([]);
    expect(await page.locator('footer a[href$="/live"]').count()).toBe(0);
  });
}

test('Georgian chosen earlier: the English address of the help centre and of the answers opens the Georgian page', async ({ browser }) => {
  const ctx = await browser.newContext();
  // (once: the visitor chose Georgian earlier; choosing English later must stick)
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('wisecall_lang')) localStorage.setItem('wisecall_lang', 'ka'); } catch (e) { /* none */ } });
  const page = await ctx.newPage();
  await page.goto('/help.html');
  await page.waitForURL(/\/ka\/help\.html$/);
  await expect(page.locator('h1')).toHaveText('დახმარების ცენტრი');
  await page.goto('/answers');
  await page.waitForURL(/\/ka\/answers$/);
  // and back to English: the English page, with English links
  await page.locator('.lang-btn[data-lang="en"]').first().click();
  await page.waitForURL((u) => u.pathname === '/answers');
  await expect(page.locator('footer a[data-i18n="help.title"]')).toHaveAttribute('href', '/help.html');
  await ctx.close();
});
