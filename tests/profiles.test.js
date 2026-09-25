// Public profiles: usernames, photos, the details on a profile, who may see it, and what is never shown.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, signupVerified, bookAndPay, addPayoutDetails, approveMentor, SAMPLE } = require('./helpers');

const PORT = 4600;
let srv, base, admin, mentor, mentorMe;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

const signup = async (name, email, username) => {
  const c = client(base);
  const r = await c.api('/auth/signup', { method: 'POST', body: { name, email, password: 'test-pass-12345', ...(username ? { username } : {}) } });
  return { c, r };
};
const png = (w = 800, h = 600, color = '#e0413a') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const upload = (c, buf, type = 'image/png') => c.api('/me/photo', { method: 'POST', body: buf, headers: { 'Content-Type': type } });
const page = async (path) => { const r = await fetch(base + path, { redirect: 'manual' }); return { status: r.status, location: r.headers.get('location'), text: await r.text() }; };

describe('profiles', () => {
  before(async () => {
    await resetDatabase();
    srv = await startServer(PORT, { RATE_LIMIT_MULTIPLIER: '30' }); // (many accounts are made from one address)
    base = srv.base;
    admin = await signupVerified(base, 'QA Admin', 'qa-admin@example.com');
    mentor = await signupVerified(base, 'Dr Mentor', 'mentor@example.com');
    await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Cardiologist', niche: 'medicine', price: 25, proofUrl: 'https://linkedin.com/in/drmentor', sampleAnswer: SAMPLE } });
    mentorMe = (await mentor.api('/me')).user;
    await approveMentor(admin, mentor);
    await addPayoutDetails(mentor);
    mentorMe = (await mentor.api('/me')).user;
  });
  after(async () => { if (srv) srv.proc.kill(); await pool.end(); });

  describe('usernames', () => {
    test('signup makes one from the name, in Latin letters, when none is chosen', async () => {
      const { r } = await signup('ნინო ბერიძე', 'nino@example.com');
      assert.equal(r.status, 201, r.text);
      assert.equal(r.user.username, 'nino-beridze');
      const second = await signup('Nino Beridze', 'nino2@example.com');
      assert.match(second.r.user.username, /^nino-beridze-\d{4}$/, 'a taken name gets a number');
    });

    test('signup takes the username the person chose (lower-cased) and refuses bad, reserved and taken ones', async () => {
      const { r } = await signup('Gio Kapanadze', 'gio@example.com', 'Gio-K');
      assert.equal(r.status, 201, r.text);
      assert.equal(r.user.username, 'gio-k');
      assert.equal((await signup('X Y', 'x1@example.com', 'gio-k')).r.error, 'username_taken');
      assert.equal((await signup('X Y', 'x2@example.com', 'GIO-K')).r.error, 'username_taken', 'case does not matter');
      assert.equal((await signup('X Y', 'x3@example.com', 'admin')).r.error, 'reserved_username');
      assert.equal((await signup('X Y', 'x4@example.com', 'a')).r.error, 'invalid_username');
      assert.equal((await signup('X Y', 'x5@example.com', '-abc')).r.error, 'invalid_username');
      assert.equal((await signup('X Y', 'x6@example.com', 'ab--cd')).r.error, 'invalid_username');
      assert.equal((await signup('X Y', 'x7@example.com', 'has space')).r.error, 'invalid_username');
      assert.equal((await signup('X Y', 'x8@example.com', 'a'.repeat(31))).r.error, 'invalid_username');
      assert.equal((await signup('X Y', 'x9@example.com', { a: 1 })).r.error, 'invalid_username');
      assert.equal((await pool.query(`SELECT 1 FROM users WHERE email LIKE 'x%@example.com'`)).rowCount, 0, 'nothing was created by a refused signup');
    });

    test('the check and suggestion endpoints for the forms', async () => {
      const c = client(base);
      assert.deepEqual((await c.api('/username/check?u=free-name-1')).available, true);
      assert.equal((await c.api('/username/check?u=gio-k')).reason, 'username_taken');
      assert.equal((await c.api('/username/check?u=settings')).reason, 'reserved_username');
      assert.equal((await c.api('/username/check?u=NO%20WAY')).available, false);
      const s = await c.api('/username/suggest?name=' + encodeURIComponent('Ana Gelashvili'));
      assert.equal(s.username, 'ana-gelashvili');
    });

    test('changing it: once every 30 days, the old address keeps working, and nobody else can take it', async () => {
      const { c } = await signup('Lasha Change', 'lasha@example.com', 'lasha-one');
      const first = await c.api('/me/username', { method: 'PUT', body: { username: 'lasha-two' } });
      assert.equal(first.status, 200, first.text);
      assert.equal(first.user.username, 'lasha-two');

      const tooSoon = await c.api('/me/username', { method: 'PUT', body: { username: 'lasha-three' } });
      assert.equal(tooSoon.status, 429);
      assert.equal(tooSoon.error, 'username_change_too_soon');
      assert.ok(new Date(tooSoon.nextChangeAt) > Date.now() + 29 * 86400000);

      // the old address redirects (page and API) and is not available to others
      const moved = await page('/u/lasha-one');
      assert.equal(moved.status, 301);
      assert.equal(moved.location, '/u/lasha-two');
      assert.equal((await client(base).api('/users/lasha-one')).redirectTo, 'lasha-two');
      assert.equal((await client(base).api('/username/check?u=lasha-one')).reason, 'username_taken');
      const other = await signup('Someone Else', 'else@example.com');
      assert.equal((await other.c.api('/me/username', { method: 'PUT', body: { username: 'lasha-one' } })).error, 'username_taken');

      // after 30 days it can be changed again (and the person can take an old name of their own back)
      await pool.query(`UPDATE users SET username_changed_at = now() - interval '31 days' WHERE lower(username) = 'lasha-two'`);
      assert.equal((await c.api('/me/username', { method: 'PUT', body: { username: 'lasha-one' } })).status, 200);
      assert.equal((await page('/u/lasha-two')).location, '/u/lasha-one');
    });

    test('a username we suggested does not start the 30-day clock until it is accepted', async () => {
      const { c, r } = await signup('Tamar Suggested', 'tamar@example.com');
      await pool.query('UPDATE users SET username_confirmed = false WHERE id = $1', [r.user.id]);
      assert.equal((await c.api('/me/username', { method: 'PUT', body: { username: 'tamar-pick' } })).status, 200);
      assert.equal((await pool.query('SELECT 1 FROM username_history WHERE old_username = $1', [r.user.username])).rowCount, 0, 'a suggestion nobody used is not kept');
      assert.equal((await c.api('/me/username', { method: 'PUT', body: { username: 'tamar-again' } })).status, 429, 'now the clock runs');
    });

    test('people who signed up before profiles existed get one when the server starts', async () => {
      await pool.query(`INSERT INTO users (name, email, password_hash, color, language) VALUES ('Old Timer', 'old@example.com', 'x', '#123456', 'en')`);
      srv.proc.kill();
      await new Promise((r) => setTimeout(r, 500));
      srv = await startServer(PORT, { RATE_LIMIT_MULTIPLIER: '30' }); // (many accounts are made from one address)
      const { rows } = await pool.query(`SELECT username FROM users WHERE email = 'old@example.com'`);
      assert.equal(rows[0].username, 'old-timer');
      assert.equal((await pool.query('SELECT 1 FROM users WHERE username IS NULL')).rowCount, 0);
    });
  });

  describe('profile details', () => {
    let c, me;
    before(async () => { ({ c } = await signup('Elene Profile', 'elene@example.com', 'elene')); me = (await c.api('/me')).user; });

    test('a person can fill in everything, and it is cleaned up', async () => {
      const r = await c.api('/me', { method: 'PATCH', body: {
        headline: '  Medical   student at TSMU \n', currentWork: 'TSMU, 4th year', city: 'Tbilisi', languages: ['ka', 'en', 'ka'],
        bio: 'I like anatomy.\nAnd tea.', linkedinUrl: 'linkedin.com/in/elene', websiteUrl: 'https://elene.example.com/about'
      } });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.user.headline, 'Medical student at TSMU');
      assert.deepEqual(r.user.languages, ['ka', 'en']);
      assert.equal(r.user.linkedinUrl, 'https://linkedin.com/in/elene', 'a link without https:// is completed');
      assert.equal(r.user.profileVisibility, 'public', 'public by default');
      // empty values clear a field
      const cleared = await c.api('/me', { method: 'PATCH', body: { city: '', websiteUrl: '' } });
      assert.equal(cleared.user.city, null);
      assert.equal(cleared.user.websiteUrl, null);
    });

    test('bad values are refused and nothing is saved', async () => {
      const before = (await c.api('/me')).user;
      const bad = async (body, error) => {
        const r = await c.api('/me', { method: 'PATCH', body: { name: 'Changed Name', ...body } });
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.equal(r.error, error, JSON.stringify(body));
      };
      await bad({ bio: 'x'.repeat(501) }, 'bio_too_long');
      await bad({ linkedinUrl: 'https://example.com/elene' }, 'invalid_linkedin_url');
      await bad({ linkedinUrl: 'http://linkedin.com/in/elene' }, 'invalid_linkedin_url');
      await bad({ websiteUrl: 'javascript:alert(1)' }, 'invalid_website_url');
      await bad({ websiteUrl: 'http://elene.example.com' }, 'invalid_website_url');
      await bad({ websiteUrl: 'https://localhost/x' }, 'invalid_website_url');
      await bad({ websiteUrl: 'https://user:pass@elene.example.com' }, 'invalid_website_url');
      await bad({ languages: ['xx'] }, 'invalid_language');
      await bad({ languages: ['ka', 'en', 'ru', 'tr', 'az', 'hy', 'de'] }, 'invalid_language');
      await bad({ languages: 'ka' }, 'invalid_field');
      await bad({ headline: { a: 1 } }, 'invalid_field');
      await bad({ profileVisibility: 'friends' }, 'invalid_visibility');
      const after = (await c.api('/me')).user;
      assert.equal(after.name, before.name, 'the name in the same request was not saved either');
    });

    test('a 500 character bio is fine; the headline and other lines are cut to their limits', async () => {
      const r = await c.api('/me', { method: 'PATCH', body: { bio: 'b'.repeat(500), headline: 'h'.repeat(300) } });
      assert.equal(r.status, 200);
      assert.equal(r.user.bio.length, 500);
      assert.equal(r.user.headline.length, 100);
    });

    test('the public page shows the profile, and never an email, bank or document detail', async () => {
      await c.api('/me', { method: 'PATCH', body: { bio: 'Hello there', headline: 'Student', currentWork: 'TSMU', city: 'Tbilisi', languages: ['ka'] } });
      const v = await client(base).api('/users/elene');
      assert.equal(v.status, 200);
      const p = v.profile;
      assert.equal(p.name, 'Elene Profile');
      assert.equal(p.headline, 'Student');
      assert.equal(p.isMentor, false);
      assert.equal(p.mentor, undefined);
      assert.ok(p.memberSince);
      const text = JSON.stringify(v);
      for (const secret of ['elene@example.com', 'email', 'iban', 'passwordHash', 'payout', 'proofUrl', 'sampleAnswer', 'verification']) {
        assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `the profile must not contain "${secret}"`);
      }
      assert.equal(p.visibility, undefined, 'the visibility setting is only sent to the owner');
      assert.equal((await c.api('/users/elene')).profile.visibility, 'public');
      assert.equal((await client(base).api('/users/nobody-by-this-name')).status, 404);
    });

    test('a mentor\'s public profile has everything the old expert page had', async () => {
      const p = (await client(base).api(`/users/${mentorMe.username}`)).profile;
      assert.equal(p.isMentor, true);
      assert.equal(p.mentor.roleTitle, 'Cardiologist');
      assert.equal(p.mentor.niche, 'medicine');
      assert.equal(p.mentor.price, 25);
      assert.ok(Array.isArray(p.mentor.badges));
      assert.ok('reviewCount' in p.mentor);
      assert.ok(!JSON.stringify(p).includes('mentor@example.com'));
    });
  });

  describe('who can see a profile', () => {
    let hidden, hiddenMe, stranger, buyer;
    before(async () => {
      ({ c: hidden } = await signup('Hidden Person', 'hidden@example.com', 'hidden-person'));
      hiddenMe = (await hidden.api('/me')).user;
      await hidden.api('/me', { method: 'PATCH', body: { bio: 'Private bio' } });
      stranger = (await signup('Stranger Danger', 'stranger@example.com')).c;
      buyer = await signupVerified(base, 'Hidden Buyer', 'hbuyer@example.com');
    });

    test('"only people I\'ve had a question with": everyone else is told only that it is private', async () => {
      assert.equal((await hidden.api('/me', { method: 'PATCH', body: { profileVisibility: 'contacts' } })).status, 200);
      const visitor = await client(base).api('/users/hidden-person');
      assert.equal(visitor.private, true);
      assert.equal(visitor.profile, undefined);
      assert.ok(!JSON.stringify(visitor).includes('Private bio'));
      assert.equal((await stranger.api('/users/hidden-person')).private, true);
      assert.equal((await hidden.api('/users/hidden-person')).profile.name, 'Hidden Person', 'the owner sees it');
      assert.equal((await admin.api('/users/hidden-person')).profile.name, 'Hidden Person', 'an admin sees it');
      assert.equal((await client(base).api('/username/check?u=hidden-person')).reason, 'username_taken');
    });

    test('a private profile is not for search engines', async () => {
      const p = await page('/u/hidden-person');
      assert.match(p.text, /name="robots" content="noindex"/);
      assert.doesNotMatch(p.text, /Hidden Person/, 'the page title does not reveal a private profile');
      assert.match((await page('/sitemap.xml')).text, /<urlset/);
      assert.doesNotMatch((await page('/sitemap.xml')).text, /hidden-person/);
    });

    test('after a paid question together, they can see each other', async () => {
      // the buyer asks the mentor: they now have a question together, so the mentor may see the buyer's private profile
      await buyer.api('/me', { method: 'PATCH', body: { profileVisibility: 'contacts', bio: 'Buyer bio' } });
      const buyerMe = (await buyer.api('/me')).user;
      assert.equal((await mentor.api(`/users/${buyerMe.username}`)).private, true, 'not yet');
      const b = await bookAndPay(base, buyer, mentorMe.id, 'How do I become a cardiologist in Georgia?');
      assert.equal(b.status, 'paid');
      assert.equal((await mentor.api(`/users/${buyerMe.username}`)).profile.bio, 'Buyer bio');
      assert.equal((await stranger.api(`/users/${buyerMe.username}`)).private, true, 'a third person still cannot');
    });

    test('a mentor who is listed on Wisecall always has a public profile', async () => {
      const r = await mentor.api('/me', { method: 'PATCH', body: { profileVisibility: 'contacts' } });
      assert.equal(r.status, 400);
      assert.equal(r.error, 'mentor_profile_must_be_public');
      assert.equal((await client(base).api(`/users/${mentorMe.username}`)).profile.isMentor, true);
    });

    test('only a listed mentor with a public profile is in the sitemap and may be indexed', async () => {
      const xml = (await page('/sitemap.xml')).text;
      assert.match(xml, new RegExp(`/u/${mentorMe.username}<`));
      assert.doesNotMatch(xml, /\/u\/elene</, 'an ordinary public profile is not offered to search engines');
      assert.match((await page(`/u/${mentorMe.username}`)).text, /name="robots" content="index, follow"/);
      assert.match((await page('/u/elene')).text, /name="robots" content="noindex"/);
      assert.match((await page('/u/elene')).text, /<title>Elene Profile — Wisecall<\/title>/);
    });
  });

  describe('photos', () => {
    let c, me;
    before(async () => { ({ c } = await signup('Photo Person', 'photo@example.com', 'photo-person')); me = (await c.api('/me')).user; });

    test('nobody has one at first: the page draws their initials', async () => {
      assert.equal(me.photoUrl, null);
      assert.equal((await client(base).raw(`/api/photo/${me.id}`)).status, 404);
    });

    test('a photo is cropped square, resized, re-encoded and stripped of hidden data', async () => {
      // a JPEG carrying EXIF (camera, place and so on)
      const withExif = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#2255cc' } })
        .withExif({ IFD0: { Copyright: 'SECRET-COPYRIGHT', Artist: 'SECRET-ARTIST' } }).jpeg().toBuffer();
      assert.ok(withExif.toString('latin1').includes('SECRET-ARTIST'), 'the test picture really has EXIF');
      const r = await upload(c, withExif, 'image/jpeg');
      assert.equal(r.status, 200, r.text);
      assert.match(r.user.photoUrl, new RegExp(`^/api/photo/${me.id}\\?v=\\d+$`));
      const res = await client(base).raw(r.user.photoUrl);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/webp');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.match(res.headers.get('cache-control'), /public/);
      const out = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(out).metadata();
      assert.equal(meta.format, 'webp');
      assert.equal(meta.width, 512);
      assert.equal(meta.height, 512);
      assert.equal(meta.exif, undefined, 'no EXIF');
      assert.ok(!out.toString('latin1').includes('SECRET'), 'nothing of the original metadata is left');
      assert.equal((await c.api('/users/photo-person')).profile.photoUrl, r.user.photoUrl);
    });

    test('PNG and WebP work too', async () => {
      assert.equal((await upload(c, await png(300, 300))).status, 200);
      assert.equal((await upload(c, await sharp(await png()).webp().toBuffer(), 'image/webp')).status, 200);
    });

    test('a file that is not a picture, a fake picture, a GIF and an oversized file are refused', async () => {
      const text = await upload(c, Buffer.from('this is not a picture at all, just some text'), 'image/png');
      assert.equal(text.status, 400);
      assert.equal(text.error, 'unsupported_image_type');
      const gif = await sharp(await png(50, 50)).gif().toBuffer();
      assert.equal((await upload(c, gif, 'image/png')).error, 'unsupported_image_type');
      const broken = Buffer.concat([(await png(50, 50)).subarray(0, 60)]);
      assert.equal((await upload(c, broken)).error, 'invalid_image');
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      assert.equal((await upload(c, svg, 'image/png')).status, 400);
      const big = Buffer.concat([await png(10, 10), Buffer.alloc(5 * 1024 * 1024 + 10)]);
      const tooBig = await upload(c, big);
      assert.equal(tooBig.status, 413);
      assert.equal(tooBig.error, 'file_too_large');
      assert.equal((await upload(c, Buffer.alloc(0))).status, 400);
      assert.equal((await client(base).api('/me/photo', { method: 'POST', body: await png(20, 20), headers: { 'Content-Type': 'image/png' } })).status, 401, 'signed-in people only');
    });

    test('a new photo gets a new address (so nobody keeps seeing the old one), and removing it brings the initials back', async () => {
      const before = (await c.api('/me')).user.photoUrl;
      await new Promise((r) => setTimeout(r, 15));
      const after = (await upload(c, await png(400, 400, '#00aa55'))).user.photoUrl;
      assert.notEqual(before, after);
      const del = await c.api('/me/photo', { method: 'DELETE' });
      assert.equal(del.status, 200);
      assert.equal(del.user.photoUrl, null);
      assert.equal((await client(base).raw(after)).status, 404);
      assert.equal((await pool.query('SELECT 1 FROM user_photos WHERE user_id = $1', [me.id])).rowCount, 0);
    });

    test('the photo of a private profile is only for those who may see the profile', async () => {
      await upload(c, await png(100, 100));
      await c.api('/me', { method: 'PATCH', body: { profileVisibility: 'contacts' } });
      const url = (await c.api('/me')).user.photoUrl;
      assert.equal((await client(base).raw(url)).status, 404, 'a visitor');
      const res = await c.raw(url);
      assert.equal(res.status, 200, 'the owner');
      assert.match(res.headers.get('cache-control'), /private/);
    });
  });

  describe('pages', () => {
    test('the profile page and the old expert address', async () => {
      const p = await page(`/u/${mentorMe.username}`);
      assert.equal(p.status, 200);
      assert.doesNotMatch(p.text, /\{\{/);
      assert.match(p.text, /<script src="\/js\/profile\.js">/);
      const old = await page(`/expert.html?id=${mentorMe.id}&booking=x&status=success`);
      assert.equal(old.status, 301);
      assert.equal(old.location, `/u/${mentorMe.username}?booking=x&status=success`);
      assert.equal((await page('/u/no-such-person')).status, 404);
      assert.equal((await page('/profile.html')).status, 200);
    });

    test('every new text is in English and Georgian', () => {
      const fs = require('fs');
      const en = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'public', 'i18n', 'en.json'), 'utf8'));
      const ka = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'public', 'i18n', 'ka.json'), 'utf8'));
      const keys = Object.keys(en).filter((k) => /^(profile\.|lang\.|auth\.field\.username)/.test(k));
      assert.ok(keys.length > 50);
      for (const k of keys) {
        assert.ok(ka[k], `${k} has no Georgian text`);
        assert.notEqual(ka[k], en[k], `${k} is not translated`);
        const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
        assert.equal(holes(ka[k]), holes(en[k]), `${k} has different {placeholders}`);
      }
    });
  });
});
