// One-off: copy users/bookings from the old data/db.json into Postgres.
// Safe to re-run: rows that already exist (same id) are skipped.
//   node scripts/import-json.js [path/to/db.json]
const fs = require('fs');
const path = require('path');
const db = require('../server/db');

const file = process.argv[2] || path.join(__dirname, '..', 'data', 'db.json');
const ts = (v) => (v ? new Date(v) : null);

(async () => {
  if (!fs.existsSync(file)) { console.log(`Nothing to import: ${file} not found.`); return; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  await db.migrate();

  let users = 0, bookings = 0;
  await db.tx(async (c) => {
    for (const u of data.users || []) {
      const r = await c.query(
        `INSERT INTO users (id, name, email, password_hash, role, niche, role_title, bio, price, color, stripe_account_id,
                            language, verification_status, proof_url, sample_answer, verification_note, verification_checks,
                            email_verified, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT DO NOTHING`,
        [u.id, u.name, String(u.email).toLowerCase(), u.passwordHash, u.role || 'seeker', u.niche || null, u.roleTitle || null,
          u.bio || null, u.price || null, u.color || null, u.stripeAccountId || null, u.language || 'en',
          u.verificationStatus || 'none', u.proofUrl || null, u.sampleAnswer || null, u.verificationNote || null,
          u.verificationChecks ? JSON.stringify(u.verificationChecks) : null, Boolean(u.emailVerified), ts(u.createdAt) || new Date()]
      );
      users += r.rowCount;
    }
    for (const b of data.bookings || []) {
      const r = await c.query(
        `INSERT INTO bookings (id, seeker_id, mentor_id, question, answer, rating, review, reviewed_at, amount, currency,
                               platform_fee_percent, platform_fee_amount, mentor_net_amount, status, mode, stripe_session_id,
                               stripe_payment_intent_id, paid_at, answered_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT DO NOTHING`,
        [b.id, b.seekerId, b.mentorId, b.question, b.answer || null, b.rating || null, b.review || null, ts(b.reviewedAt),
          b.amount, b.currency, b.platformFeePercent, b.platformFeeAmount, b.mentorNetAmount, b.status, b.mode,
          b.stripeSessionId || null, b.stripePaymentIntentId || null, ts(b.paidAt), ts(b.answeredAt), ts(b.createdAt) || new Date()]
      );
      bookings += r.rowCount;
    }
  });
  console.log(`Imported ${users} users and ${bookings} bookings from ${file}.`);
})().catch((e) => { console.error('Import failed:', e.message); process.exitCode = 1; }).finally(() => db.close());
