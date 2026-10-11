#!/usr/bin/env node
// Launch rehearsal: test data for a LOCAL database (never production). It refuses to run unless the database name contains
// "rehearsal" or "test", and NODE_ENV is not production.
//
//   DATABASE_URL=postgresql://.../wisecall_rehearsal node scripts/rehearsal/seed.js [--mentors 50] [--users 500] [--sessions 20]
//
// What it writes (every name and address is invented, example.test):
//   - --mentors listable mentors (verified, every required step passed, payout details saved, approved for live sessions)
//   - --users buyers (email verified, half Georgian, half English), one login session row each (tokens: scripts/rehearsal/tokens.js)
//   - --sessions published live sessions 2–10 days ahead (30 seats), plus one more called "last seats" (30 seats, none sold) for the
//     seat race, and a history: ~2,000 answered questions with payouts and ratings, 300 published public answers
// The bank is the FAKE bank (provider "mock"): nothing real is ever charged.
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (process.env.NODE_ENV === 'production') { console.error('Refusing to seed in production.'); process.exit(1); }
const url = process.env.DATABASE_URL || '';
const dbName = url.split('/').pop().split('?')[0];
if (!/rehearsal|test/.test(dbName)) { console.error(`Refusing to seed "${dbName}": use a database whose name contains "rehearsal" or "test".`); process.exit(1); }

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : Number(process.argv[i + 1]); };
const N_MENTORS = arg('mentors', 50);
const N_USERS = arg('users', 500);
const N_SESSIONS = arg('sessions', 20);
const N_HISTORY = arg('history', 2000);
const N_PUBLIC = arg('public', 300);

const { encrypt } = require('../../server/cryptoBox');
const rules = require('../../server/verification/rules');
const pool = new Pool({ connectionString: url, max: 4 });
const sql = (t, p) => pool.query(t, p);

// A rehearsal-only, made-up IBAN that passes the checksum (the same value the test suite uses).
const IBAN = 'GE29NB0000000101904917';
const NICHES = ['tech', 'study_abroad', 'careers_hr', 'business', 'design', 'marketing', 'data_ai', 'freelancing', 'languages', 'teaching', 'law', 'medicine'];
const FIRST = ['Giorgi', 'Nino', 'Levan', 'Tamar', 'Davit', 'Mariam', 'Luka', 'Ana', 'Irakli', 'Salome', 'Nika', 'Elene', 'Sandro', 'Keti', 'Zura'];
const LAST = ['Beridze', 'Kapanadze', 'Lomidze', 'Tsereteli', 'Gelashvili', 'Maisuradze', 'Abashidze', 'Japaridze', 'Kvaratskhelia', 'Chikovani'];
const pick = (a, i) => a[i % a.length];
const LONG_Q = 'I am a junior developer in Tbilisi and I would like to know how you prepared for your first interviews abroad, what helped most and what you would skip.';
const LONG_A = 'Start with the basics you already use every day and practise explaining them out loud. Build one small project end to end, write down the decisions you made and why, and use that story in interviews. Mock interviews with a friend helped me more than any course.';

async function main() {
  const t0 = Date.now();
  const hash = await bcrypt.hash('rehearsal-pass-12345', 10);
  const ibanEnc = encrypt(IBAN);

  // ---- mentors ------------------------------------------------------------------------------------------------------------------------
  const mentors = [];
  for (let i = 0; i < N_MENTORS; i++) {
    const niche = pick(NICHES, i);
    const name = `${pick(FIRST, i)} ${pick(LAST, i * 7 + 3)}`;
    const { rows: [m] } = await sql(
      `INSERT INTO users (name, email, password_hash, role, niche, role_title, bio, price, language, verification_status, email_verified,
          payout_name, payout_iban_enc, payout_iban_last4, payout_updated_at, verification_decided_at, username, profile_visibility,
          headline, city, languages, years_experience, application_submitted_at, adult_confirmed_at, live_approved_at, created_at)
       VALUES ($1, $2, $3, 'mentor', $4, $5, $6, $7, $8, 'verified', true, $1, $9, '4917', now() - interval '60 days', now() - interval '50 days',
          $10, 'public', $5, 'Tbilisi', '{ka,en}', $11, now() - interval '55 days', now() - interval '55 days', now() - interval '40 days', now() - interval '90 days')
       RETURNING id`,
      [name, `rehearsal.mentor${i}@example.test`, hash, niche, `Senior ${niche.replace('_', ' ')} specialist`,
        'I help people at the start of their careers with practical, honest advice from my own experience.', 5 + ((i * 37) % 196),
        i % 2 ? 'ka' : 'en', ibanEnc, `rehearsal-mentor-${i}`, 3 + (i % 20)]);
    for (const step of rules.requiredFor(niche)) {
      await sql(`INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, $2, 'passed', 'rehearsal seed', now() - interval '50 days')`, [m.id, step]);
    }
    mentors.push(m.id);
  }

  // ---- buyers ---------------------------------------------------------------------------------------------------------------------------
  const users = [];
  for (let i = 0; i < N_USERS; i++) {
    const { rows: [u] } = await sql(
      `INSERT INTO users (name, email, password_hash, role, language, email_verified, username, adult_confirmed_at, created_at)
       VALUES ($1, $2, $3, 'seeker', $4, true, $5, now(), now() - make_interval(days => $6)) RETURNING id`,
      [`${pick(FIRST, i + 5)} ${pick(LAST, i)}`, `rehearsal.user${i}@example.test`, hash, i % 2 ? 'ka' : 'en', `rehearsal-user-${i}`, i % 60]);
    users.push(u.id);
  }
  // the rehearsal admin (start-server.sh sets ADMIN_EMAILS to this address): used to trigger the background sweep on demand
  await sql(`INSERT INTO users (name, email, password_hash, role, language, email_verified, username, adult_confirmed_at)
             VALUES ('Rehearsal Admin', 'rehearsal.admin@example.test', $1, 'seeker', 'en', true, 'rehearsal-admin', now())`, [hash]);
  // one login session per account (scripts/rehearsal/lib.js signs a cookie for it)
  await sql(`INSERT INTO sessions (user_id, device_label) SELECT id, 'rehearsal' FROM users WHERE email LIKE 'rehearsal.%@example.test'`);

  // ---- history: answered questions, payouts, ratings, public answers ---------------------------------------------------------------------
  for (let i = 0; i < N_HISTORY; i++) {
    const mentor = pick(mentors, i * 13);
    const seeker = pick(users, i * 7);
    const amount = 500 + ((i * 97) % 9500);
    const fee = Math.round(amount * 0.2);
    const days = 10 + (i % 80);
    const { rows: [b] } = await sql(
      `INSERT INTO bookings (seeker_id, mentor_id, question, answer, amount, currency, platform_fee_percent, platform_fee_amount, mentor_net_amount,
          status, provider, provider_order_id, paid_at, answered_at, answer_deadline, created_at)
       VALUES ($1, $2, $3, $4, $5, 'gel', 20, $6, $7, 'answered', 'mock', $8, now() - make_interval(days => $9), now() - make_interval(days => $9 - 1),
          now() - make_interval(days => $9 - 7), now() - make_interval(days => $9)) RETURNING id`,
      [seeker, mentor, LONG_Q, LONG_A, amount, fee, amount - fee, `seed-${i}`, days]);
    await sql(`INSERT INTO receipts (booking_id, kind, amount, currency) VALUES ($1, 'payment', $2, 'gel')`, [b.id, amount]);
    await sql(`INSERT INTO payouts (booking_id, mentor_id, amount, currency, status, payable_at) VALUES ($1, $2, $3, 'gel', $4, now() - make_interval(days => $5))`,
      [b.id, mentor, amount - fee, days > 40 ? 'paid' : 'pending', days - 8]);
    if (i % 3 !== 0) {
      await sql(`INSERT INTO ratings (booking_id, direction, rater_id, ratee_id, stars, review, submitted_at, revealed_at)
                 VALUES ($1, 'asker_to_mentor', $2, $3, $4, 'Clear and practical, thank you.', now() - make_interval(days => $5), now() - make_interval(days => $5))`,
        [b.id, seeker, mentor, 3 + (i % 3), days - 2]);
    }
    if (i < N_PUBLIC) {
      await sql(`INSERT INTO public_answers (booking_id, mentor_id, asker_id, niche, status, asker_consent, mentor_consent, question_public, answer_public, slug, published_at)
                 SELECT $1, $2, $3, u.niche, 'published', true, true, $4, $5, $6, now() - make_interval(days => $7) FROM users u WHERE u.id = $2`,
        [b.id, mentor, seeker, LONG_Q, LONG_A, `rehearsal-answer-${i}`, days - 3]);
    }
  }

  // ---- live sessions ------------------------------------------------------------------------------------------------------------------
  const make = async (i, title, seats, mentor) => sql(
    `INSERT INTO live_sessions (slug, mentor_id, title, description, learn_points, niche, kind, language, starts_at, duration_min, price,
        max_seats, min_seats, status, published_at)
     SELECT $1, $2, $3, 'A practical session for people starting out. Bring your questions.', '{Planning,Interviews,First steps}', u.niche, 'qa',
        $4, now() + make_interval(days => $5, hours => $6), 60, $7, $8, 3, 'published', now() - interval '1 day' FROM users u WHERE u.id = $2
     RETURNING id, slug`,
    [`rehearsal-live-${i}`, mentor, title, i % 2 ? 'ka' : 'en', 2 + (i % 9), i % 12, 1000 + (i % 5) * 500, seats]);
  for (let i = 0; i < N_SESSIONS; i++) await make(i, `Rehearsal live session ${i + 1}`, 30, pick(mentors, i * 3 + 1));
  const { rows: [last] } = await make(999, 'Rehearsal: the last seats', 30, mentors[0]);

  const counts = (await sql(`SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM bookings) b, (SELECT count(*) FROM live_sessions) l, (SELECT count(*) FROM public_answers) pa`)).rows[0];
  console.log(`Seeded in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${counts.u} users (${N_MENTORS} mentors), ${counts.b} bookings, ${counts.l} live sessions (last-seats session: ${last.slug}), ${counts.pa} public answers.`);
  console.log('Password for every rehearsal account: rehearsal-pass-12345');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
