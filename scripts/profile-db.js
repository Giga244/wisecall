#!/usr/bin/env node
// A read-only data profile of a database (docs/data-profile/PROFILE.md): row counts, rates, min/median/max, the values of status-type
// columns and consistency checks, with a "Problems found" list on top. It never reads or writes a name, an email address, an IBAN, a
// message, a question or answer, a note or an id: every query returns counts and aggregates only.
//   node scripts/profile-db.js                -> docs/data-profile/PROFILE.md (not committed: .gitignore), from DATABASE_URL
//   node scripts/profile-db.js --out <file>   -> another file
//   node scripts/profile-db.js --stdout       -> the Markdown on standard output (for example in a shell on the server)
// DATABASE_URL is read from the environment as the app reads it (.env included; a variable already set wins). For the production database
// set it in your own terminal to the database's External URL (with ?sslmode=require), or keep it in .env.production (never committed) and
// run `node --env-file=.env.production scripts/profile-db.js`. The URL is never printed.
// Everything runs in ONE transaction that is READ ONLY (Postgres refuses any write inside it) and is rolled back at the end.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const toStdout = args.includes('--stdout');
const outArg = args.indexOf('--out');
const OUT = outArg >= 0 ? path.resolve(args[outArg + 1]) : path.join(ROOT, 'docs', 'data-profile', 'PROFILE.md');

// ---- Formatting ------------------------------------------------------------------------------------------------------------------------
const n = (v) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('en-US'));
const gel = (tetri) => (tetri === null || tetri === undefined ? '–' : `${(Number(tetri) / 100).toFixed(2)} GEL`);
const lari = (v) => (v === null || v === undefined ? '–' : `${Math.round(Number(v))} GEL`);
const pct = (part, whole) => (Number(whole) ? `${((100 * Number(part)) / Number(whole)).toFixed(1)}%` : '–');
const when = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '–');
const cell = (v) => String(v === null || v === undefined ? '–' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
function table(head, rows) {
  if (!rows.length) return '_(none)_\n';
  return [`| ${head.map(cell).join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n') + '\n';
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  await client.connect();
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  const problems = []; // { check, count, note }
  const fail = (check, count, note = '') => { if (Number(count) > 0) problems.push({ check, count: Number(count), note }); };
  const out = [];
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout = '60s'");
    const [{ transaction_read_only: ro }] = await q('SHOW transaction_read_only');
    if (ro !== 'on') throw new Error('The transaction is not read-only: stopping.');
    const [{ db, version }] = await q("SELECT current_database() AS db, current_setting('server_version') AS version");
    process.stderr.write(`Profiling database "${db}" (read-only)...\n`);

    // ---- The schema: every table of "public" and its columns -----------------------------------------------------------------------
    const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).map((r) => r.table_name);
    const columns = {};
    for (const r of await q(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)) {
      (columns[r.table_name] = columns[r.table_name] || {})[r.column_name] = r.data_type;
    }
    const has = (t, c) => Boolean(columns[t] && (c === undefined || columns[t][c]));
    const id = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const one = async (sql, params) => (await q(sql, params))[0];
    const byValue = async (t, c, where = 'true') => (has(t, c)
      ? (await q(`SELECT COALESCE(${id(c)}::text, '(none)') AS v, count(*)::int AS n FROM ${id(t)} WHERE ${where} GROUP BY 1 ORDER BY 2 DESC, 1`)).map((r) => [r.v, n(r.n)])
      : null);
    const migration = has('schema_migrations') ? (await one('SELECT max(name) AS m FROM schema_migrations')).m : null;

    // ---- 1. Row counts and the newest row of every table -------------------------------------------------------------------------
    const NEWEST = ['created_at', 'received_at', 'submitted_at', 'issued_at', 'requested_at', 'sent_at', 'applied_at', 'updated_at'];
    const counts = {};
    const rowRows = [];
    for (const t of tables) {
      const col = NEWEST.find((c) => columns[t][c] === 'timestamp with time zone') || Object.keys(columns[t]).find((c) => columns[t][c] === 'timestamp with time zone');
      const r = await one(`SELECT count(*)::bigint AS n${col ? `, max(${id(col)}) AS newest` : ''} FROM ${id(t)}`);
      counts[t] = Number(r.n);
      rowRows.push([t, n(r.n), col ? `${when(r.newest)} (${col})` : '–']);
    }

    // ---- 2. users ----------------------------------------------------------------------------------------------------------------
    const usersOut = [];
    if (has('users')) {
      const MENTOR = `role IN ('mentor', 'both')`;
      const live = has('users', 'deleted_at') ? 'deleted_at IS NULL' : 'true';
      usersOut.push('**By role**\n', table(['role', 'users'], await byValue('users', 'role')));
      usersOut.push('\n**By verification status**\n', table(['verification_status', 'users'], await byValue('users', 'verification_status')));
      usersOut.push('\n**By language**\n', table(['language', 'users'], await byValue('users', 'language')));
      const del = await one(`SELECT ${has('users', 'deleted_at') ? 'count(*) FILTER (WHERE deleted_at IS NOT NULL)' : '0'}::int AS deleted,
        ${has('users', 'deletion_requested_at') ? `count(*) FILTER (WHERE deletion_requested_at IS NOT NULL${has('users', 'deleted_at') ? ' AND deleted_at IS NULL' : ''})` : '0'}::int AS requested FROM users`);
      usersOut.push('\n**Accounts being deleted**\n', table(['', 'users'], [['deleted (deleted_at)', n(del.deleted)], ['deletion requested, not deleted yet', n(del.requested)]]));
      // (null, or for text an empty string; counted among accounts that are not deleted)
      const nullRows = [];
      for (const c of ['adult_confirmed_at', 'signup_source', 'headline', 'story', 'price']) {
        if (!has('users', c)) { nullRows.push([c, '(no such column)', '']); continue; }
        const empty = ['text', 'character varying'].includes(columns.users[c]) ? `NULLIF(btrim(${id(c)}), '') IS NULL` : `${id(c)} IS NULL`;
        const r = await one(`SELECT count(*) FILTER (WHERE ${empty})::int AS e, count(*)::int AS t, count(*) FILTER (WHERE ${MENTOR} AND ${empty})::int AS me,
          count(*) FILTER (WHERE ${MENTOR})::int AS mt FROM users WHERE ${live}`);
        nullRows.push([c, `${pct(r.e, r.t)} (${n(r.e)} of ${n(r.t)})`, `${pct(r.me, r.mt)} (${n(r.me)} of ${n(r.mt)})`]);
      }
      usersOut.push('\n**Missing values** (null or empty; accounts not deleted)\n', table(['column', 'all users', 'mentors'], nullRows));
      if (has('users', 'verification_status')) {
        const v = await one(`SELECT count(*)::int AS total, min(price) AS min, percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median, max(price) AS max,
            count(*) FILTER (WHERE price IS NULL)::int AS no_price,
            ${has('users', 'story') ? "count(*) FILTER (WHERE NULLIF(btrim(story), '') IS NULL)" : '0'}::int AS no_story,
            ${has('users', 'photo_updated_at') ? 'count(*) FILTER (WHERE photo_updated_at IS NULL)' : '0'}::int AS no_photo
          FROM users WHERE ${MENTOR} AND verification_status = 'verified' AND ${live}`);
        usersOut.push('\n**Verified mentors** (price in whole lari)\n', table(['verified mentors', 'price min', 'median', 'max', 'no price', 'no story', 'no photo'],
          [[n(v.total), lari(v.min), lari(v.median), lari(v.max), n(v.no_price), n(v.no_story), n(v.no_photo)]]));
      }
      const dup = await one(`SELECT count(*)::int AS groups, COALESCE(sum(c), 0)::int AS rows FROM (SELECT count(*) AS c FROM users WHERE email IS NOT NULL
        GROUP BY lower(regexp_replace(email, '\\s', '', 'g')) HAVING count(*) > 1) d`);
      usersOut.push('\n**Duplicate email addresses** (ignoring case and spaces)\n', table(['addresses used more than once', 'accounts involved'], [[n(dup.groups), n(dup.rows)]]));
      fail('Duplicate user email addresses (ignoring case and spaces)', dup.groups, `${dup.rows} accounts`);
    }

    // ---- 3. waitlist -------------------------------------------------------------------------------------------------------------
    const waitOut = [];
    if (has('waitlist')) {
      const w = await one(`SELECT count(*)::int AS total${has('waitlist', 'prelaunch') ? `, count(*) FILTER (WHERE prelaunch)::int AS pre, count(*) FILTER (WHERE NOT prelaunch)::int AS post,
        count(*) FILTER (WHERE prelaunch IS NULL)::int AS unknown` : ''} FROM waitlist`);
      const d = await one(`SELECT count(*)::int AS groups, COALESCE(sum(c), 0)::int AS rows FROM (SELECT count(*) AS c FROM waitlist GROUP BY lower(btrim(email)) HAVING count(*) > 1) d`);
      waitOut.push(table(['total', 'prelaunch: true', 'false', 'not set', 'duplicate addresses (ignoring case)', 'rows involved'],
        [[n(w.total), n(w.pre), n(w.post), n(w.unknown), n(d.groups), n(d.rows)]]));
      fail('Duplicate waiting-list email addresses (ignoring case)', d.groups, `${d.rows} rows`);
    }

    // ---- 4. bookings -------------------------------------------------------------------------------------------------------------
    const bookOut = [];
    if (has('bookings')) {
      bookOut.push('**By status**\n', table(['status', 'bookings'], await byValue('bookings', 'status')));
      if (has('bookings', 'answer_review')) bookOut.push('\n**By answer review** (held for a check: server/probation.js)\n', table(['answer_review', 'bookings'], await byValue('bookings', 'answer_review')));
      const PAIDISH = `status IN ('paid', 'answered', 'refund_pending', 'refunded')`;
      const a = await one(`SELECT min(amount) AS min, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS median, max(amount) AS max, count(*)::int AS n,
        min(amount) FILTER (WHERE ${PAIDISH}) AS pmin, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) FILTER (WHERE ${PAIDISH}) AS pmedian,
        max(amount) FILTER (WHERE ${PAIDISH}) AS pmax, count(*) FILTER (WHERE ${PAIDISH})::int AS pn FROM bookings`);
      bookOut.push('\n**Amount**\n', table(['bookings', 'count', 'min', 'median', 'max'],
        [['all', n(a.n), gel(a.min), gel(a.median), gel(a.max)], ['paid at some point (paid, answered, refund_pending, refunded)', n(a.pn), gel(a.pmin), gel(a.pmedian), gel(a.pmax)]]));
      const checks = [];
      const check = async (label, where, opts = {}) => {
        const r = await one(`SELECT count(*)::int AS c FROM bookings b WHERE ${where}`);
        checks.push([label, n(r.c), opts.note || '']);
        if (!opts.info) fail(`bookings: ${label}`, r.c, opts.note || '');
      };
      const noDiscount = has('bookings', 'discount_code_id') ? 'b.discount_code_id IS NULL AND ' : '';
      await check('platform_fee_amount + mentor_net_amount <> amount (no discount)', `${noDiscount}b.platform_fee_amount + b.mentor_net_amount <> b.amount`);
      await check('fee or net below 0', 'b.platform_fee_amount < 0 OR b.mentor_net_amount < 0');
      const over = ['refunded_amount', 'partial_refund_amount'].filter((c) => has('bookings', c)).map((c) => `b.${c} > b.amount`);
      if (over.length) await check(`${['refunded_amount', 'partial_refund_amount'].filter((c) => has('bookings', c)).join(' or ')} greater than amount`, over.join(' OR '));
      await check("status 'paid' or 'answered' without provider_order_id", "b.status IN ('paid', 'answered') AND NULLIF(btrim(b.provider_order_id), '') IS NULL");
      await check("status 'refunded' without a refund time (refunded_at)", "b.status = 'refunded' AND b.refunded_at IS NULL");
      if (has('receipts')) {
        await check("status 'refunded' without a refunded amount: no refunded_amount and no refund receipt", `b.status = 'refunded' AND b.refunded_amount IS NULL
          AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.booking_id = b.id AND r.kind = 'refund')`, { note: 'a full refund keeps the amount on its refund receipt' });
      } else {
        await check("status 'refunded' without refunded_amount", "b.status = 'refunded' AND b.refunded_amount IS NULL", { info: true, note: 'normal for a full refund' });
      }
      if (has('ratings') && has('bookings', 'rating')) {
        const A2M = "r.booking_id = b.id AND r.direction = 'asker_to_mentor'";
        await check('bookings.rating set, no row in ratings', `b.rating IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ratings r WHERE ${A2M})`);
        await check('a rating in ratings (asker to mentor), bookings.rating empty', `b.rating IS NULL AND EXISTS (SELECT 1 FROM ratings r WHERE ${A2M})`,
          { info: true, note: 'expected: since migration 015 only ratings is written; bookings.rating is the old copy' });
        await check('bookings.rating and ratings.stars differ', `b.rating IS NOT NULL AND EXISTS (SELECT 1 FROM ratings r WHERE ${A2M} AND r.stars <> b.rating)`);
      }
      bookOut.push('\n**Consistency checks** (rows failing)\n', table(['check', 'rows', 'note'], checks));
    }

    // ---- 5. payouts and payout_batches -------------------------------------------------------------------------------------------
    const payOut = [];
    if (has('payouts')) {
      payOut.push('**payouts by status**\n', table(['status', 'payouts'], await byValue('payouts', 'status')));
      const owed = has('payouts', 'debt_settled_amount')
        ? 'COALESCE(p.debt_amount, p.amount) - p.debt_settled_amount'
        : 'CASE WHEN p.debt_settled_batch_id IS NULL THEN COALESCE(p.debt_amount, p.amount) ELSE 0 END';
      const p = await one(`SELECT COALESCE(sum(p.amount) FILTER (WHERE p.status = 'pending'), 0)::bigint AS pending, count(*) FILTER (WHERE p.status = 'pending')::int AS pending_n,
        count(*) FILTER (WHERE p.status = 'paid' AND p.debt_flagged_at IS NOT NULL AND (${owed}) > 0)::int AS debt_n,
        COALESCE(sum(${owed}) FILTER (WHERE p.status = 'paid' AND p.debt_flagged_at IS NOT NULL AND (${owed}) > 0), 0)::bigint AS debt
        FROM payouts p`);
      payOut.push('\n**Money**\n', table(['', 'payouts', 'total'], [['pending (earned, not paid out yet)', n(p.pending_n), gel(p.pending)],
        ['open debt (owed back: debt − settled > 0)', n(p.debt_n), gel(p.debt)]]));
      if (has('payout_batches')) {
        payOut.push('\n**payout_batches by status**\n', table(['status', 'batches'], await byValue('payout_batches', 'status')));
        const bad = await one(`SELECT count(*)::int AS c FROM payouts p LEFT JOIN payout_batches pb ON pb.id = p.batch_id
          WHERE p.status = 'paid' AND (pb.id IS NULL OR pb.status <> 'paid')`);
        const since = ['send_started_at', 'requested_at', 'created_at'].filter((c) => has('payout_batches', c)).map((c) => `pb.${c}`).join(', ');
        const stuck = await one(`SELECT count(*)::int AS c FROM payout_batches pb WHERE pb.status = 'sending' AND COALESCE(${since}) < now() - interval '1 day'`);
        payOut.push('\n**Checks** (rows failing)\n', table(['check', 'rows'], [["payouts marked 'paid' whose batch is not 'paid' (or missing)", n(bad.c)],
          ["batches 'sending' for more than 1 day", n(stuck.c)]]));
        fail("payouts: marked 'paid' but their batch is not 'paid' (or missing)", bad.c);
        fail("payout_batches: 'sending' for more than 1 day", stuck.c);
      }
    }

    // ---- 6. disputes -------------------------------------------------------------------------------------------------------------
    const disOut = [];
    if (has('disputes')) {
      disOut.push('**By reason**\n', table(['reason', 'disputes'], await byValue('disputes', 'reason')));
      disOut.push('\n**By status**\n', table(['status', 'disputes'], await byValue('disputes', 'status')));
      disOut.push('\n**By outcome**\n', table(['outcome', 'disputes'], await byValue('disputes', 'outcome')));
    }

    // ---- 7. Timestamps more than a day in the future -----------------------------------------------------------------------------
    // (deadlines, holds, expiries and scheduled times are meant to be in the future: listed, not counted as problems)
    const FUTURE_BY_DESIGN = /(_until|_deadline|deadline|expires_at|payable_at|starts_at|ends_at|due_at|_after|scheduled_at|scheduled_for|reveal_at|valid_to)$/;
    const futureRows = [];
    for (const t of tables) {
      for (const [c, type] of Object.entries(columns[t])) {
        if (type !== 'timestamp with time zone') continue;
        const r = await one(`SELECT count(*)::int AS c FROM ${id(t)} WHERE ${id(c)} > now() + interval '1 day'`);
        if (!r.c) continue;
        const expected = FUTURE_BY_DESIGN.test(c);
        futureRows.push([`${t}.${c}`, n(r.c), expected ? 'a deadline or hold: expected' : 'unexpected']);
        if (!expected) fail(`timestamps: ${t}.${c} more than 1 day in the future`, r.c);
      }
    }

    // ---- 8. Leftovers ------------------------------------------------------------------------------------------------------------
    const leftOut = [];
    if (has('stripe_events')) {
      leftOut.push(table(['table', 'rows'], [['stripe_events (from before the Georgian banks)', n(counts.stripe_events)]]));
      fail('stripe_events still has rows (left from the Stripe days)', counts.stripe_events);
    }
    const serverText = (function read(dir) {
      let s = '';
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) s += read(p); else if (/\.(js|sql|html)$/.test(f.name)) s += fs.readFileSync(p, 'utf8') + '\n';
      }
      return s;
    }(path.join(ROOT, 'server')));
    const unused = tables.filter((t) => counts[t] === 0 && t !== 'schema_migrations' && !new RegExp(`\\b${t}\\b`).test(serverText));
    leftOut.push('\n**Empty tables that nothing in server/ reads or writes**\n', table(['table'], unused.map((t) => [t])));
    for (const t of unused) fail(`leftover: table ${t} is empty and never used in server/`, 1);

    // ---- The report --------------------------------------------------------------------------------------------------------------
    problems.sort((x, y) => y.count - x.count || x.check.localeCompare(y.check));
    out.push(`# Data profile: ${db}\n`);
    out.push(`Generated ${when(new Date())} by scripts/profile-db.js, in one read-only transaction. Postgres ${version}; latest migration ${migration || '–'}.`);
    out.push('Counts and aggregates only: no names, email addresses, IBANs, messages, answers, notes or ids. Money in GEL (tetri ÷ 100); users.price in whole lari.\n');
    out.push('## Problems found\n');
    out.push(problems.length ? table(['check', 'count', 'note'], problems.map((p) => [p.check, n(p.count), p.note])) : 'None: every check passed.\n');
    out.push('\n## 1. Row counts\n', table(['table', 'rows', 'newest row'], rowRows));
    out.push('\n## 2. users\n', ...usersOut);
    out.push('\n## 3. waitlist\n', ...(waitOut.length ? waitOut : ['_(no waitlist table)_\n']));
    out.push('\n## 4. bookings\n', ...bookOut);
    out.push('\n## 5. payouts and payout_batches\n', ...payOut);
    out.push('\n## 6. disputes\n', ...(disOut.length ? disOut : ['_(no disputes table)_\n']));
    out.push('\n## 7. Timestamps more than 1 day in the future\n', table(['column', 'rows', ''], futureRows));
    out.push('\n## 8. Leftovers\n', ...leftOut);
  } finally {
    try { await client.query('ROLLBACK'); } catch (e) { /* the connection is gone */ }
    await client.end();
  }
  const md = out.join('\n');
  if (toStdout) { process.stdout.write(md + '\n'); return; }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md + '\n');
  process.stderr.write(`Written: ${path.relative(ROOT, OUT)}\n`);
}

main().catch((e) => {
  // (the error, never the connection string: pg's messages do not include it, and nothing here prints process.env)
  console.error('profile-db failed:', String(e && e.message).replace(/postgres(ql)?:\/\/\S+/gi, '<database url>'));
  process.exit(1);
});
