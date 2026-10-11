#!/usr/bin/env node
// Screenshots of the main pages for the redesign review (docs/redesign/): desktop 1440 and phone 390, light and dark, English and
// Georgian. The home page gets all eight; every other page four (desktop light EN, desktop dark KA, phone light KA, phone dark EN), so
// each page is seen at both sizes, in both themes and both languages. Saved as WebP (sharp), long pages cut at a sensible height.
//
//   node tests/e2e-cloud/seed-dev.js --base http://localhost:4790      (once, on a LOCAL server with mock bank and ID check)
//   node scripts/redesign-shots.js --base http://localhost:4790 --out docs/redesign/after [--only home,profile]
//
// The server must use the same DATABASE_URL as this script (live sessions are added here, and moved so the room is open), run with
// ADMIN_2FA=off and LIVE_PROVIDER=fake, and never be the production database. Motion is captured settled (reduced motion).
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const sharp = require('sharp');
const { chromium } = require('@playwright/test');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : process.argv[i + 1]; };
const BASE = String(arg('base', 'http://localhost:4790')).replace(/\/+$/, '');
const OUT = path.resolve(arg('out', 'docs/redesign/after'));
const ONLY = arg('only', '') ? String(arg('only')).split(',') : null;
const PASSWORD = 'demo-pass-12345'; // (tests/e2e-cloud/seed-dev.js)
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = async (t, p) => (await pool.query(t, p)).rows;

function client() {
  let cookie = '';
  const call = async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + '/api' + p, {
      method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const jar = new Map(cookie ? cookie.split('; ').map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]) : []);
    for (const c of res.headers.getSetCookie()) { const pair = c.split(';')[0]; jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)); }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const text = await res.text();
    let json = {}; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, ...json, text };
  };
  call.cookies = () => cookie.split('; ').filter(Boolean).map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1), url: BASE }));
  return call;
}
async function signIn(email) {
  const c = client();
  const r = await c('/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`sign in ${email}: ${r.text}`);
  return c;
}

// Two published live sessions by the seeded mentor (one in Georgian), a paid ticket for the English buyer, and the first one starting
// in five minutes, so its room is open. Done once: a second run reuses them.
async function seedLive() {
  const have = await sql(`SELECT s.* FROM live_sessions s JOIN users u ON u.id = s.mentor_id WHERE u.email = 'giorgi.mentor@example.test' AND s.status IN ('published', 'live') ORDER BY s.created_at`);
  if (have.length >= 2) return have;
  const admin = await signIn((process.env.ADMIN_EMAILS || '').split(',')[0].trim());
  const mentor = await signIn('giorgi.mentor@example.test');
  const mentorId = (await mentor('/me')).user.id;
  await admin(`/admin/live/hosts/${mentorId}`, { method: 'POST' });
  const day = (d) => new Date(Date.now() + d * 86400000 + 4 * 3600000).toISOString().slice(0, 10);
  const drafts = [
    { title: 'Your first backend job: ask me anything', description: 'An hour of answers about getting hired as a backend developer in Georgia: what to learn, what to build, how interviews go, and what the first year is really like.', learnPoints: ['What to learn first', 'How to prepare for interviews', 'What the first year looks like'], language: 'en', date: day(3) },
    { title: 'როგორ ვიპოვო პირველი სამსახური IT-ში', description: 'ერთსაათიანი ცოცხალი სესია პირველი სამსახურის ძიებაზე: რა ვისწავლო, რა პროექტები გავაკეთო, როგორ მოვემზადო გასაუბრებისთვის და რას ველოდო პირველ წელს.', learnPoints: ['რა ვისწავლო ჯერ', 'როგორ მოვემზადო'], language: 'ka', date: day(5) }
  ];
  for (const d of drafts) {
    const c = await mentor('/live', { method: 'POST', body: { niche: 'tech', kind: 'qa', time: '19:00', durationMin: 60, price: 15, maxSeats: 30, minSeats: 1, ...d } });
    if (c.status !== 201) throw new Error('live session: ' + c.text);
    const p = await mentor(`/live/${c.session.id}/publish`, { method: 'POST', body: { agree: true } });
    if (p.session && p.session.status === 'review') await admin(`/admin/live/${c.session.id}/approve`, { method: 'POST' });
  }
  const list = await sql(`SELECT s.* FROM live_sessions s JOIN users u ON u.id = s.mentor_id WHERE u.email = 'giorgi.mentor@example.test' AND s.status IN ('published', 'live') ORDER BY s.created_at`);
  const buyer = await signIn('sam.buyer@example.test');
  const t = await buyer(`/live/${list[0].id}/tickets`, { method: 'POST', body: { questions: ['How many projects should I have before I apply?'] } });
  if (t.status === 201) {
    await client()(`/mock-bank/orders/${new URL(t.checkoutUrl).searchParams.get('order')}/complete`, { method: 'POST', body: { outcome: 'success' } });
    await buyer(`/live/tickets/${t.ticket.id}/sync`, { method: 'POST' });
  }
  await pool.query(`UPDATE live_sessions SET starts_at = now() + interval '5 minutes' WHERE id = $1`, [list[0].id]);
  return list;
}

const VARIANTS = {
  'desktop-light-en': { width: 1440, height: 900, scheme: 'light', lang: 'en' },
  'desktop-dark-en': { width: 1440, height: 900, scheme: 'dark', lang: 'en' },
  'desktop-light-ka': { width: 1440, height: 900, scheme: 'light', lang: 'ka' },
  'desktop-dark-ka': { width: 1440, height: 900, scheme: 'dark', lang: 'ka' },
  'phone-light-en': { width: 390, height: 844, scheme: 'light', lang: 'en' },
  'phone-dark-en': { width: 390, height: 844, scheme: 'dark', lang: 'en' },
  'phone-light-ka': { width: 390, height: 844, scheme: 'light', lang: 'ka' },
  'phone-dark-ka': { width: 390, height: 844, scheme: 'dark', lang: 'ka' }
};
const FOUR = ['desktop-light-en', 'desktop-dark-ka', 'phone-light-ka', 'phone-dark-en'];

(async () => {
  const live = await seedLive();
  const giorgi = (await sql(`SELECT username FROM users WHERE email = 'giorgi.mentor@example.test'`))[0].username;
  const PAGES = [
    { name: 'home', path: '/', variants: Object.keys(VARIANTS), max: 9000 },
    { name: 'browse', path: '/#experts', variants: FOUR, from: '#experts', max: 2600 },
    { name: 'profile', path: `/u/${giorgi}`, variants: FOUR },
    { name: 'live-list', path: '/live', variants: FOUR },
    { name: 'live-session', path: `/live/${live[0].slug}`, variants: FOUR },
    { name: 'live-room', path: `/live/${live[0].slug}/room`, variants: ['desktop-light-en', 'phone-dark-ka'], as: 'giorgi.mentor@example.test' },
    { name: 'dashboard', path: '/dashboard.html', variants: FOUR, as: 'sam.buyer@example.test' },
    { name: 'inbox', path: '/inbox.html', variants: FOUR, as: 'sam.buyer@example.test' },
    { name: 'settings', path: '/settings.html', variants: FOUR, as: 'sam.buyer@example.test' },
    { name: 'login', path: '/login.html', variants: FOUR },
    { name: 'signup', path: '/signup.html', variants: FOUR },
    { name: 'help', path: '/help.html', variants: FOUR },
    { name: 'faq', path: '/faq.html', variants: FOUR },
    { name: 'terms', path: '/terms.html', variants: ['desktop-light-en', 'phone-dark-ka'] },
    { name: 'not-found', path: '/no-such-page', variants: ['desktop-light-en', 'phone-dark-ka'] },
    { name: 'admin', path: '/admin.html', variants: ['desktop-light-en', 'desktop-dark-en'], as: (process.env.ADMIN_EMAILS || '').split(',')[0].trim() }
  ].filter((p) => !ONLY || ONLY.includes(p.name));
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const sessions = {};
  let n = 0;
  for (const p of PAGES) {
    if (p.as && !sessions[p.as]) sessions[p.as] = (await signIn(p.as)).cookies();
    for (const v of p.variants) {
      const o = VARIANTS[v];
      const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, colorScheme: o.scheme, reducedMotion: 'reduce', locale: o.lang === 'ka' ? 'ka-GE' : 'en-GB', isMobile: o.width < 768, hasTouch: o.width < 768 });
      await ctx.addInitScript((lang) => { try { localStorage.setItem('wisecall_lang', lang); } catch (e) { /* none */ } }, o.lang);
      if (p.as) await ctx.addCookies(sessions[p.as]);
      const page = await ctx.newPage();
      const url = BASE + (o.lang === 'ka' && !p.path.startsWith('/#') ? '/ka' + (p.path === '/' ? '/' : p.path) : (o.lang === 'ka' ? '/ka/' + p.path.slice(1) : p.path));
      await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
      await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
      await page.waitForTimeout(400);
      let clip = null;
      if (p.from) {
        const box = await page.locator(p.from).boundingBox().catch(() => null);
        if (box) clip = { x: 0, y: Math.max(0, box.y + await page.evaluate(() => window.scrollY)), width: o.width, height: 0 };
      }
      const buf = await page.screenshot({ fullPage: true });
      let img = sharp(buf);
      const meta = await img.metadata();
      const top = clip ? Math.round(Math.min(clip.y, meta.height - 1)) : 0;
      const height = Math.min(meta.height - top, p.max || 3600);
      img = sharp(buf).extract({ left: 0, top, width: meta.width, height });
      await img.webp({ quality: 70 }).toFile(path.join(OUT, `${p.name}-${v}.webp`));
      n += 1;
      await ctx.close();
    }
    process.stdout.write(`${p.name} `);
  }
  await browser.close();
  await pool.end();
  console.log(`\n${n} screenshots in ${path.relative(process.cwd(), OUT)}`);
})().catch((e) => { console.error(e); process.exit(1); });
