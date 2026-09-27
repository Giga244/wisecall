#!/usr/bin/env node
// Demo data for a LOCAL server (never production): an admin, a buyer, three listed mentors (English and Georgian names and texts),
// one mentor applicant waiting for review, and bookings in every state (open, answered + rated, refunded).
//
//   node tests/e2e-cloud/seed-dev.js [--base http://localhost:4242]
//
// The server must run with PAYMENT_PROVIDER=mock and KYC_PROVIDER=mock and WITHOUT an email provider (so sign-up codes come back in the
// API reply, as in development), and DATABASE_URL must be the same database the server uses. Verification steps are written straight into
// the database, like tests/helpers.js approveMentor does, because the real ID check and review have their own tests.
// Every name and address here is invented (example.test).
require('dotenv').config();
const { Pool } = require('pg');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : process.argv[i + 1]; };
const BASE = String(arg('base', 'http://localhost:4242')).replace(/\/+$/, '');
const PASSWORD = 'demo-pass-12345';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = async (t, p) => (await pool.query(t, p)).rows;

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + '/api' + path, {
      method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const jar = new Map(cookie ? cookie.split('; ').map((c) => c.split('=')) : []);
    for (const c of set) { const [k, ...v] = c.split(';')[0].split('='); jar.set(k, v.join('=')); }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const text = await res.text();
    let json = {}; try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, ...json, text };
  };
}

async function user(name, email, language = 'en') {
  const c = client();
  let r = await c('/auth/signup', { method: 'POST', body: { name, email, password: PASSWORD, language } });
  if (r.status === 409) { r = await c('/auth/login', { method: 'POST', body: { email, password: PASSWORD } }); return c; }
  if (r.status !== 201) throw new Error(`signup ${email}: ${r.text}`);
  if (!r.devVerifyCode) throw new Error('No devVerifyCode: run the server without an email provider (see the top of this file).');
  const v = await c('/auth/verify-email', { method: 'POST', body: { code: r.devVerifyCode } });
  if (v.status !== 200) throw new Error(`verify ${email}: ${v.text}`);
  return c;
}

const rules = require('../../server/verification/rules');
async function passSteps(userId, niche, except = []) {
  for (const step of rules.requiredFor(niche)) {
    if (except.includes(step)) continue;
    await sql(`INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, $2, 'passed', 'demo data', now())
               ON CONFLICT (user_id, step) DO UPDATE SET status = 'passed', reason = 'demo data', decided_at = now()`, [userId, step]);
  }
}

async function listedMentor(admin, m) {
  const c = await user(m.name, m.email, m.language);
  const r = await c('/me', { method: 'PATCH', body: { becomeMentor: true, niche: m.niche, roleTitle: m.roleTitle, price: m.price, bio: m.bio, headline: m.headline, city: m.city, languages: m.languages } });
  if (r.status !== 200) throw new Error(`mentor ${m.email}: ${r.text}`);
  const me = (await c('/me')).user;
  if (me.verificationStatus !== 'verified') {
    await sql(`UPDATE users SET verification_status = 'pending', application_submitted_at = now(), story = $2, years_experience = $3 WHERE id = $1`, [me.id, m.story, m.years]);
    await passSteps(me.id, m.niche);
    const a = await admin(`/admin/mentors/${me.id}/approve`, { method: 'POST' });
    if (a.status !== 200) throw new Error(`approve ${m.email}: ${a.text}`);
  }
  await c('/me/payout', { method: 'PUT', body: { name: m.payoutName, iban: 'GE29NB0000000101904917' } });
  return { c, id: me.id, username: me.username };
}

async function paidBooking(buyer, mentorId, question) {
  const r = await buyer('/bookings', { method: 'POST', body: { mentorId, question } });
  if (r.status !== 201) throw new Error(`booking: ${r.text}`);
  await client()(`/mock-bank/orders/${r.booking.providerOrderId}/complete`, { method: 'POST', body: { outcome: 'success' } });
  for (let i = 0; i < 50; i++) {
    await buyer(`/bookings/${r.booking.id}/sync`, { method: 'POST' });
    const b = (await buyer(`/bookings/${r.booking.id}`)).booking;
    if (b.status === 'paid') return b;
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error('payment was not confirmed');
}

(async () => {
  const cfg = await (await fetch(BASE + '/api/config')).json();
  if (!cfg.devMode) throw new Error('This server is not in development mode. Never seed a real site.');
  const adminEmail = (process.env.ADMIN_EMAILS || '').split(',')[0].trim();
  if (!adminEmail) throw new Error('Set ADMIN_EMAILS (the first address becomes the demo admin).');

  const admin = await user('Demo Admin', adminEmail);
  const buyer = await user('ნინო ბერიძე', 'nino.buyer@example.test', 'ka');
  const buyer2 = await user('Sam Buyer', 'sam.buyer@example.test');

  const giorgi = await listedMentor(admin, {
    name: 'Giorgi Kapanadze', email: 'giorgi.mentor@example.test', niche: 'tech', roleTitle: 'Senior backend engineer', price: 40,
    headline: 'Backend engineer, 12 years in fintech', city: 'Tbilisi', languages: ['ka', 'en'], years: 12, payoutName: 'Giorgi Kapanadze',
    bio: 'I help junior and mid-level developers plan their careers, prepare for interviews and design systems that scale.',
    story: 'Twelve years building payment systems for banks in Georgia and Europe; I lead a team of eight engineers and mentor juniors every week.'
  });
  const tamar = await listedMentor(admin, {
    name: 'თამარ ლომიძე', email: 'tamar.mentor@example.test', language: 'ka', niche: 'marketing', roleTitle: 'ციფრული მარკეტინგის ხელმძღვანელი', price: 25,
    headline: 'ციფრული მარკეტინგის სპეციალისტი, სოციალური მედიის სტრატეგიები მცირე ბიზნესისთვის', city: 'ქუთაისი', languages: ['ka', 'en', 'ru'], years: 8,
    payoutName: 'თამარ ლომიძე',
    bio: 'ვეხმარები მცირე და საშუალო ბიზნესს სოციალურ მედიაში სტრატეგიის შექმნაში, რეკლამის ბიუჯეტის დაგეგმვასა და შედეგების გაზომვაში. რვა წელია ვმუშაობ ქართულ და საერთაშორისო ბრენდებთან.',
    story: 'რვა წელია ვმართავ ციფრულ კამპანიებს ქართული კომპანიებისთვის; ჩემი გუნდი ყოველთვიურად ორმოცამდე კლიენტს ემსახურება.'
  });
  const levan = await listedMentor(admin, {
    name: 'Levan Tsereteli', email: 'levan.mentor@example.test', niche: 'business', roleTitle: 'Founder and CEO', price: 120,
    headline: 'Built and sold two companies', city: 'Batumi', languages: ['ka', 'en'], years: 18, payoutName: 'Levan Tsereteli',
    bio: 'Founder of two Georgian startups (one acquired). Ask me about fundraising, hiring your first ten people, pricing and growing into new markets.',
    story: 'Eighteen years in business; founded a logistics startup that was acquired in 2021 and now run a SaaS company with 40 staff.'
  });

  // A mentor applicant waiting for review (identity passed, Experience submitted).
  const ana = await user('Ana Applicant', 'ana.applicant@example.test');
  await ana('/me', { method: 'PATCH', body: { becomeMentor: true, price: 30 } });
  const anaMe = (await ana('/me')).user;
  if (anaMe.verificationStatus !== 'pending') {
    await passSteps(anaMe.id, 'design', ['experience']);
    await ana('/verification/experience', { method: 'PUT', body: {
      niche: 'design', roleTitle: 'Product designer', yearsExperience: 6, specialtyTags: ['UX research', 'Figma'],
      story: 'Six years designing mobile banking and e-commerce apps; I ran user research for three Georgian startups and teach a UX course.',
      sampleAnswer: 'Start with five short interviews with real users before you touch the design. Ask them to show you how they do the task today, write down every place they hesitate, and only then sketch two alternatives to test with the next five people.'
    } });
    await ana('/verification/evidence', { method: 'POST', body: { kind: 'portfolio', url: 'https://portfolio.example.test/ana' } });
    const s = await ana('/verification/submit', { method: 'POST' });
    if (s.status !== 200) console.warn('applicant submit:', s.text);
  }

  // Bookings: one open, one answered and rated, one refunded.
  const existing = (await sql('SELECT count(*)::int AS n FROM bookings'))[0].n;
  if (!existing) {
    await paidBooking(buyer, giorgi.id, 'I am a junior developer in Tbilisi. Should I learn Go or keep going deeper with Node.js to get a backend job next year?');
    const b2 = await paidBooking(buyer, tamar.id, 'მცირე საცხობი მაქვს ქუთაისში. რა ბიუჯეტით დავიწყო ინსტაგრამზე რეკლამა და როგორ გავზომო, მუშაობს თუ არა?');
    await tamar.c(`/bookings/${b2.id}/answer`, { method: 'POST', body: { answer: 'დაიწყე თვეში 300–400 ლარით და გაყავი ორ ნაწილად: ნახევარი ახალი მომხმარებლების მოსაზიდად, ნახევარი — უკვე არსებული მიმდევრებისთვის შეთავაზებებით. თითოეულ რეკლამას მიეცი ცალკე ფასდაკლების კოდი, რომ გაზომო, რომელმა მოიყვანა ყიდვა. ორი კვირის შემდეგ გათიშე ის რეკლამა, რომელმაც ყველაზე ნაკლები შედეგი მოგცა, და მისი ბიუჯეტი გადაიტანე საუკეთესოზე.' } });
    await sql(`UPDATE bookings SET answered_at = now() - interval '8 days', answer_review = 'released', answer_released_at = now() - interval '8 days' WHERE id = $1`, [b2.id]);
    await buyer(`/bookings/${b2.id}/ratings`, { method: 'POST', body: { stars: 5, tags: [], review: 'ძალიან კონკრეტული და გამოსადეგი რჩევა, მადლობა!' } });
    const b3 = await paidBooking(buyer2, levan.id, 'We are a two-person SaaS startup with 20 paying customers. Is it too early to raise a seed round, and how much should we ask for?');
    await admin(`/admin/bookings/${b3.id}/refund`, { method: 'POST' });
  }
  console.log(`Seeded. Password for every account: ${PASSWORD}`);
  console.log(`  admin ${adminEmail} · buyer nino.buyer@example.test · mentor giorgi.mentor@example.test · applicant ana.applicant@example.test`);
  console.log(`  profiles: /u/${giorgi.username} /u/${tamar.username} /u/${levan.username}`);
  await pool.end();
})().catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
