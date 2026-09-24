// DEVELOPMENT ONLY: fills your local database with realistic demo mentors, questions and reviews
// so the site does not look empty while you work on it.
//
//   npm run seed:dev              add the demo data (safe to run twice)
//   npm run seed:dev -- --remove  delete it again
//
// All demo accounts use an @demo.wisecall.test email and the password below. This script refuses
// to run in production or against a database that is not on this computer.
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data: NODE_ENV is "production".');
  process.exit(1);
}

const bcrypt = require('bcryptjs');
const db = require('../server/db');
const config = require('../server/config');

const DEMO_DOMAIN = '@demo.wisecall.test';
const DEMO_PASSWORD = 'demo-pass-1234';

let host = '';
try { host = new URL(config.DATABASE_URL).hostname; } catch (e) { /* checked below */ }
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error(`Refusing to seed demo data: DATABASE_URL points at "${host || 'unknown'}", not this computer.`);
  process.exit(1);
}

const COLORS = ['#ff6f59', '#3db88e', '#f4a93b', '#5b6b8c', '#8c5b9f', '#3f8fc4', '#d1567e', '#3f6b6b'];

const MENTORS = [
  { name: 'Dr. Nino Kapanadze', email: 'nino.k', lang: 'ka', niche: 'medicine', roleTitle: 'Cardiologist, 12 years in practice', price: 25,
    bio: 'I help medical students and young doctors choose a specialty, prepare for residency interviews, and survive the first years on the wards.',
    sample: 'Start with the specialty you would still enjoy on a bad night shift, not the one that sounds best. Shadow for a week before you commit, and ask residents what they would change about the job.' },
  { name: 'Giorgi Beridze', email: 'giorgi.b', lang: 'ka', niche: 'business', roleTitle: 'Founder of a Tbilisi logistics startup', price: 30,
    bio: 'Built a company from two people to forty. Ask me about first customers, hiring your first employees, and the mistakes that cost me a year.',
    sample: 'Before you build anything, find ten people who already pay to solve this problem badly. If you cannot find ten, the problem is not painful enough yet, and that is cheaper to learn now than after you write code.' },
  { name: 'Elene Japaridze', email: 'elene.j', lang: 'ka', niche: 'teaching', roleTitle: 'High-school teacher and exam coach', price: 15,
    bio: 'Fifteen years teaching maths and preparing students for national exams. I can help you build a study plan that fits a real life.',
    sample: 'Study in short blocks and test yourself instead of rereading. Three 40-minute sessions with practice questions beat a whole Sunday of highlighting, and you will see the gaps early enough to fix them.' },
  { name: 'Sarah Whitfield', email: 'sarah.w', lang: 'en', niche: 'tech', roleTitle: 'Senior software engineer at a global fintech', price: 35,
    bio: 'I review career plans, portfolios and interview strategy for people breaking into software, and I am happy to be blunt about what hiring managers really look for.',
    sample: 'Two solid projects that you can explain end to end beat ten tutorials. Pick one problem you care about, ship it, write down the trade-offs you made, and be ready to talk about what you would do differently.' },
  { name: 'Tamar Gelashvili', email: 'tamar.g', lang: 'ka', niche: 'law', roleTitle: 'Attorney specialising in business and contracts', price: 40,
    bio: 'I can help law students plan their careers and small founders understand what to ask before they sign. General guidance only, not legal advice for your case.',
    sample: 'Read every contract for three things first: what you must do, what happens if either side stops, and how you can get out. If any of those is unclear, ask for it in writing before you sign.' },
  { name: 'Luka Meladze', email: 'luka.m', lang: 'en', niche: 'fitness', roleTitle: 'Strength coach and former national-team athlete', price: 20,
    bio: 'I coach beginners to lift safely, build habits that last, and avoid the injuries that end most people’s first year in the gym.',
    sample: 'Train three days a week, add weight slowly, and stop every set with a rep or two left. Consistency for a year beats a perfect programme for a month, and it keeps you healthy enough to continue.' }
];

const SEEKERS = [
  { name: 'Ana Tsiklauri', email: 'ana.t', lang: 'ka' },
  { name: 'Mikheil Lomidze', email: 'mikheil.l', lang: 'ka' },
  { name: 'Chris Morgan', email: 'chris.m', lang: 'en' }
];

// [mentor index, seeker index, question, answer, rating, review]
const QA = [
  [0, 0, 'How do I decide between cardiology and internal medicine?', 'Spend a week with each team. Notice which patients you enjoy thinking about after you leave, and pick the one where the work still interests you when it is unglamorous.', 5, 'Clear and honest. Exactly the perspective I needed before choosing.'],
  [0, 1, 'Any tips for a residency interview?', 'Prepare three real stories about patients or mistakes, not slogans. Interviewers remember specifics, and they trust people who can say what they learned.', 5, 'Practical and encouraging.'],
  [1, 2, 'How did you find your first customers?', 'I called people I already knew who had the problem, and asked for ten minutes, not a sale. Two of them became customers, and the rest introduced me to more.', 4, 'Useful, concrete advice I could act on the same day.'],
  [3, 2, 'What should be in a junior developer portfolio?', 'Two projects with a short write-up each: the problem, your choices, and what you would change. Keep the code readable and the README honest.', 5, 'Helped me cut my portfolio in half and it is much stronger.'],
  [2, 0, 'How can I study for exams when I work part-time?', 'Use short blocks right after your shift while you are still warmed up, and always finish by testing yourself. Twenty focused minutes beats an hour of rereading.', 5, 'Realistic plan for someone with a busy schedule.'],
  [5, 1, 'How often should a beginner train?', 'Three full-body sessions a week, with a rest day between them. Start lighter than you think you need to and add a little each week.', 4, 'Simple and easy to follow.']
];

async function remove() {
  const { rows } = await db.query('SELECT id FROM users WHERE email LIKE $1', [`%${DEMO_DOMAIN}`]);
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.query('DELETE FROM bookings WHERE seeker_id = ANY($1::uuid[]) OR mentor_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  }
  console.log(`Removed ${ids.length} demo account(s) and their bookings.`);
}

async function seed() {
  await db.migrate();
  const existing = await db.query('SELECT count(*)::int AS n FROM users WHERE email LIKE $1', [`%${DEMO_DOMAIN}`]);
  if (existing.rows[0].n > 0) {
    console.log('Demo data is already there. Run with --remove first if you want to start over.');
    return;
  }
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const mentorIds = [];
  const seekerIds = [];

  for (const [i, m] of MENTORS.entries()) {
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, role, niche, role_title, bio, price, color, language,
                          verification_status, proof_url, sample_answer, verification_checks, email_verified, payouts_enabled, created_at)
       VALUES ($1, $2, $3, 'mentor', $4, $5, $6, $7, $8, $9, 'verified', $10, $11, $12, true, true, now() - ($13 || ' days')::interval)
       RETURNING id`,
      [m.name, m.email + DEMO_DOMAIN, hash, m.niche, m.roleTitle, m.bio, m.price, COLORS[i % COLORS.length], m.lang,
        'https://www.linkedin.com/in/demo-' + m.email.replace('.', '-'), m.sample,
        JSON.stringify({ identity: true, credential: true, sample: true, at: new Date().toISOString() }), String(30 - i * 4)]
    );
    mentorIds.push(rows[0].id);
  }
  for (const [i, s] of SEEKERS.entries()) {
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, color, language, email_verified) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [s.name, s.email + DEMO_DOMAIN, hash, COLORS[(i + 3) % COLORS.length], s.lang]
    );
    seekerIds.push(rows[0].id);
  }
  for (const [n, [mi, si, question, answer, rating, review]] of QA.entries()) {
    const price = MENTORS[mi].price * 100;
    const fee = Math.round((price * config.PLATFORM_FEE_PERCENT) / 100);
    await db.query(
      `INSERT INTO bookings (seeker_id, mentor_id, question, answer, rating, review, reviewed_at, amount, currency,
                             platform_fee_percent, platform_fee_amount, mentor_net_amount, status, mode, paid_at, answered_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11, 'answered', 'simulated',
               now() - ($12 || ' days')::interval, now() - ($12 || ' days')::interval, now() - ($12 || ' days')::interval)`,
      [seekerIds[si], mentorIds[mi], question, answer, rating, review, price, config.CURRENCY, config.PLATFORM_FEE_PERCENT, fee, price - fee, String(10 - n)]
    );
  }
  console.log(`Added ${MENTORS.length} mentors, ${SEEKERS.length} seekers and ${QA.length} answered questions with reviews.`);
  console.log(`Log in as any of them, for example ${MENTORS[3].email + DEMO_DOMAIN} / ${DEMO_PASSWORD}`);
}

(process.argv.includes('--remove') ? remove() : seed())
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => db.close());
