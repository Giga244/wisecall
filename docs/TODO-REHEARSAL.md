# Code changes from the launch rehearsal (October 2026)

Every change the rehearsal found, with the file, the line (on `main` at commit `bb79e98`) and the fix. Nothing here has been changed in the
app: this branch adds files only. Evidence and numbers: [`LAUNCH-REHEARSAL.md`](LAUNCH-REHEARSAL.md). Severity: 🔴 money or data wrong ·
🟠 wrong behaviour or a launch risk · 🟡 capacity, resilience or clarity · ⚪ nice to have.

No 🔴 was found: under every load and race test the money and seat invariants held (`scripts/rehearsal/invariants.js`).

## Status (October 2026)

| | Done |
|---|---|
| R-1 | `claimAnswer` also needs `declined_at IS NULL`; the answer route says `409 declined` (EN + KA on the dashboard). Test: `tests/launch-fixes.test.js`. |
| R-2 | Shutting down: `Connection: close` on every answer, `/healthz` 503, idle connections closed at once, all of them after `SHUTDOWN_GRACE_MS` (20 s). |
| R-3 | `/live` reads every mentor in one query (`models.getUsersByIds`). |
| R-4 | Mentor statistics: the two queries run together, and each mentor's are kept `MENTOR_STATS_CACHE_SECONDS` (60 in production, 0 elsewhere). |
| R-5 | `/api/config`, `/api/experts`, `/api/live`, `/api/answers`: kept `PUBLIC_CACHE_SECONDS` (30 in production) for visitors who are not signed in, sent with `Cache-Control: public`; cleared when the fields change. |
| R-6 | Pool: `DB_POOL_MAX` (15), 5 s to get a connection, statement 15 s, lock wait 10 s, idle transaction 60 s (migrations lift the limits); a request that hits one gets `503 busy_try_again`. |
| R-7 | The sign-up code and the reset link: 5 s and no retry. |
| R-8 | The video service failing is `503 video_unavailable` (the room page already says "try again"); the mentor's join marks the session live only after the token was made. |
| R-9 | `npm run backup:check` compares every table of the database. |
| R-10 | "Find me a mentor" reads every candidate in one query. |
| R-11 | Not done, on purpose: one process is enough until the CPU is (scale up to Standard first). The rate limits, the session cache and the `/sync` throttle are per process. |
| R-12 | The date formatters are made once; the indexes are in migration 040; `NODE_OPTIONS=--max-old-space-size=384` in `render.yaml`. The callback lookups and the admin overview stay as they are (fine at this size). |

---

## 🟠 R-1 · An answer can be accepted after the same question was declined

- **Where:** `server/models.js:211-215` (`claimAnswer`) and `server/routes/bookings.js:219-225` (decline).
- **What happens:** the decline sets `declined_at` but leaves `status = 'paid'` until `payments.refundBooking` claims the row. An answer
  that arrives in that gap (two tabs, two buttons) passes `claimAnswer` (`status = 'paid' AND answered_at IS NULL`). Seen once in 10 races
  (`tests/load/results/refund-race-2-starter.json`): decline 200 **and** answer 200; the buyer was emailed the answer, then refunded in
  full, and the mentor's payout was voided. Money stays consistent (invariants hold), but the buyer keeps an answer they did not pay for
  and the mentor worked for nothing.
- **Reproduce:** `DATABASE_URL=... node scripts/rehearsal/repro-answer-after-decline.js` (exit 1 when reproduced; it reproduced on the 6th
  try on 2026-10-06).
- **Fix (one line):** in `claimAnswer` add `AND declined_at IS NULL` to the `WHERE`:
  ```sql
  WHERE id = $1 AND status = 'paid' AND answered_at IS NULL AND declined_at IS NULL AND (answer_deadline IS NULL OR answer_deadline > now())
  ```
  and in `server/routes/bookings.js:179-184` answer `409 { error: 'declined' }` when `now.declinedAt` is set (today the mentor sees
  `400 not_paid`, which reads like a payment problem). Add a test next to the existing decline tests in `tests/`.

## 🟠 R-2 · Graceful shutdown never finishes while visitors keep connections open

- **Where:** `server/index.js:325` (`shutdown`).
- **What happens:** on SIGTERM the server stops the timers and calls `server.close()`, but keeps serving new requests on open keep-alive
  connections. With 50 visitors browsing it exited only when the traffic stopped (18 s, `tests/load/results/` notes in LAUNCH-REHEARSAL.md
  §4). Under steady traffic it would not exit before Render's shutdown window (30 s by default [VERIFY "maxShutdownDelaySeconds" in
  Render's docs]) and is then killed in the middle of requests. Money is safe (every payment step is a transaction and the sweep repairs a
  lost callback, drill "crash"), but people see errors during every deploy.
- **Fix:**
  ```js
  let draining = false;
  app.use((req, res, next) => { if (draining) res.set('Connection', 'close'); next(); });      // (mount first)
  // /healthz: if (draining) return res.status(503).json({ ok: false, draining: true });
  const shutdown = () => {
    if (draining) return; draining = true; stopJobs();
    server.close(() => db.close().then(() => process.exit(0)));
    server.closeIdleConnections();                                     // Node >= 18.2
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 20000).unref();   // never past Render's window
  };
  ```

## 🟡 R-3 · /live makes one database round trip per mentor (N+1)

- **Where:** `server/live/listing.js:26-27`.
- **What happens:** `for (const r of rows) ... await getUserById(r.mentor_id)` — 21 sessions = 21 sequential queries before the page can
  be written. `/live` had the worst tail of all pages under load (p95 8.7 s on Starter at 200 visitors, vs 2.1 s for the home page) and
  grows with every published session (up to 100 per page).
- **Fix:** one query for all mentors:
  ```js
  const ids = [...new Set(rows.map((r) => r.mentor_id))];
  const { rows: us } = await query(`${USER_SELECT} WHERE users.id = ANY($1::uuid[])`, [ids]);   // the same SELECT getUserById uses
  const mentors = new Map(us.map((u) => [u.id, userFromRow(u)]));
  ```
  (export a `getUsersByIds(ids)` next to `getUserById` in `server/models.js` so the listable check stays identical).

## 🟡 R-4 · Mentor statistics are recomputed over every booking on every home and Browse view

- **Where:** `server/models.js:230-262` (`mentorStatsFor`), called by `server/routes/experts.js:14` (every `/api/experts`), the profile
  page and the expert page.
- **What happens:** two aggregates over `ratings ⨝ bookings` and `bookings` for all listed mentors. Fast today (0.5 ms), but on the
  inflated copy (100,000 bookings, `scripts/rehearsal/inflate.sql`) they cost **44 ms + 30 ms per call** (`tests/load/results/scale-explain.json`):
  at 30 page views per second that is more database time than a small Postgres plan has. This is the first thing that will break as the
  site grows.
- **Fix (pick one):**
  1. Cache the result per mentor id for 60 s in memory (a `Map` with a timestamp) — ratings are revealed by a sweep anyway, so a minute's
     delay is invisible; or
  2. keep `answered_count`, `avg_answer_seconds`, `rating_count`, `rating_sum` on a small `mentor_stats` table updated in the same
     transaction as an answer / a revealed rating / a refund (exact, constant-time reads).
  Also run the two queries with `Promise.all` instead of one after the other (`server/models.js:236` and `:242`).

## 🟡 R-5 · Public lists are never cached

- **Where:** `server/routes/experts.js:20-37` (`GET /api/experts`), `server/index.js:227-268` (`GET /api/config`), `server/routes/live.js:46`
  (`GET /api/live`), `server/routes/answers.js` (`GET /api/answers`).
- **What happens:** no `Cache-Control` on any of them, and the home page calls four of them on every view. On Starter the CPU is the
  limit (0.5 core used 100 % from ~100 active visitors), so every repeated computation costs capacity directly.
- **Fix:** for anonymous requests (no cookie), keep the JSON for 30–60 s in memory, keyed by the query string, and send
  `Cache-Control: public, max-age=30`. `/api/config` changes only when an admin edits niches: cache it until then. Expect roughly a third
  less CPU per home-page view.

## 🟡 R-6 · The database pool: 10 connections, no timeouts

- **Where:** `server/db.js:7`.
- **What happens:** `new Pool({ max: 10 })` with no `connectionTimeoutMillis`, no `statement_timeout`, no `idle_in_transaction_session_timeout`.
  In the 150-buyers-for-100-seats rush all 10 connections were busy and 9 waited on the session's row lock; ordinary browsing halved for
  ~10 s (p95 0.9 s). A stuck query or a long lock would make every request wait without limit. The sweep also keeps one connection for
  its whole run (`server/jobs.js:176`, the advisory lock), so the web requests really have 9.
- **Fix:**
  ```js
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: Number(process.env.DB_POOL_MAX) || 15,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    options: '-c statement_timeout=15000 -c idle_in_transaction_session_timeout=20000 -c lock_timeout=10000' });
  ```
  Keep `max × instances` below the database plan's connection limit [VERIFY on Render: basic-256mb allows ~100]. In
  `server/live/tickets.js:62-99` consider `SELECT ... FOR UPDATE` with `lock_timeout` set locally (`SET LOCAL lock_timeout = '3s'`) and a
  friendly `try_again` error, so a rush can never hold all connections.

## 🟡 R-7 · Sign-up and "forgot password" wait for the email provider (31 s when it hangs)

- **Where:** `server/routes/auth.js:73` (sign-up code) and `server/routes/auth.js:183` (reset link); `server/email.js:17` (15 s timeout)
  plus one retry (`server/email.js:105-107`).
- **What happens:** with the email API hanging, sign-up took 31.1 s and "forgot password" 30.9 s before answering (drill "email"). When the
  API answers 503 it fails fast (1 s) and the account is still created (the person can ask for the code again).
- **Fix:** for messages sent while a person waits, use a 5 s timeout and no retry (pass `{ timeoutMs: 5000, retry: false }` through
  `sendTemplate` → `sendEmail` → `postJson`); the background notifications can keep 15 s + retry.

## 🟡 R-8 · The video provider failing shows a generic error, and the session is marked live anyway

- **Where:** `server/live/room.js:39-42` (mentor join), `:51` (participant join), `server/live/rooms.js:31-38` (`token`), `server/live/daily.js:13-27`.
- **What happens:** with Daily answering 503, joining answers `500 server_error`; with Daily hanging, after 10 s. The mentor's join sets
  `status = 'live'` before asking Daily for a token, so the session is "live" although nobody could enter.
- **Fix:** in `rooms.token` wrap the provider call: `catch (e) { throw new LiveError('video_unavailable'); }` and map it to 503 with a
  message ("the video service is not answering, try again in a minute") in `server/routes/live.js` (`run`, line 39). Move the
  `UPDATE live_sessions SET status = 'live'` after the token was created.

## 🟡 R-9 · The backup check skips most tables

- **Where:** `scripts/backup.js:15` (`TABLES`).
- **What happens:** `npm run backup:check` compares 11 tables; the live-session tables (sessions, tickets, series orders, replays),
  public answers, disputes, withdrawals and 40+ others are never compared. The drill compared all 64 (`scripts/rehearsal/backup-drill.sh`).
- **Fix:** read the table list from the database instead of a constant:
  ```js
  const TABLES = (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).rows.map((r) => r.table_name);
  ```

## 🟡 R-10 · A "find me a mentor" request reads up to 500 mentors one at a time

- **Where:** `server/mentorRequests.js:86-89`.
- **What happens:** `for (const m of rows) { ... await notifyFor(await getUserById(m.id), r.id) ... }` — up to 500 sequential queries in the
  background after each request. Harmless at 50 mentors, slow at 500.
- **Fix:** select the needed columns for all candidates in the first query (it already filters with `listableSql()`), then loop in memory.

## 🟡 R-11 · No way to use more than one CPU

- **Where:** `server/index.js` (no cluster), `server/rateLimit.js:3`, `server/routes/bookings.js:142`, `server/auth.js` (session cache).
- **What happens:** the server is one Node process, so a 2-CPU plan gave only +20 % (696 vs 582 requests/s; the second core sits idle) and
  `WEB_CONCURRENCY` does nothing. Running two processes (cluster, or 2 Render instances) is possible — the sweep is protected by an
  advisory lock — but the rate limiter, the `/sync` throttle and the session cache are per process, so limits would multiply by the number
  of processes.
- **Fix (only when one CPU is no longer enough):** move the rate-limit counters to Postgres (or Redis), then add a small `cluster` entry
  (`WEB_CONCURRENCY` workers, default 1). Until then, scale **up** (Standard), not out.

## ⚪ R-12 · Small things

- `server/pages.js:437-440` (`liveWhen`), `server/live/share.js:34`, `server/live/notices.js:12`: build each `Intl.DateTimeFormat` once
  per language and reuse it (0.22 ms → 0.002 ms per date; ~5 ms per `/live` page).
- Foreign keys without an index (deleting an account checks these tables with a sequential scan): add in one migration
  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS ratings_rater_idx ON ratings (rater_id);
  CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_sender_idx ON messages (sender_id);
  CREATE INDEX CONCURRENTLY IF NOT EXISTS live_questions_ticket_idx ON live_questions (ticket_id);
  CREATE INDEX CONCURRENTLY IF NOT EXISTS live_questions_author_idx ON live_questions (author_id);
  CREATE INDEX CONCURRENTLY IF NOT EXISTS live_waitlist_user_idx ON live_waitlist (user_id);
  CREATE INDEX CONCURRENTLY IF NOT EXISTS live_ratings_session_idx ON live_ratings (session_id);
  CREATE INDEX CONCURRENTLY IF NOT EXISTS mentor_requests_user_idx ON mentor_requests (user_id);
  CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_booking_idx ON notifications (booking_id);
  CREATE INDEX CONCURRENTLY IF NOT EXISTS public_answers_asker_idx ON public_answers (asker_id);
  ```
  (the full list of 50+ unindexed foreign keys is in `tests/load/results/db-report.json`; most point at admin columns and do not matter).
  Note: the migration runner wraps each file in a transaction, where `CONCURRENTLY` is not allowed — drop `CONCURRENTLY` (tables are small).
- `render.yaml`: set `NODE_OPTIONS=--max-old-space-size=384` on Starter (`1536` on Standard) so Node collects garbage before the plan's
  memory limit instead of being killed (peak RSS seen: 185 MB, so there is room today).
- `server/routes/paymentCallback.js` / `server/payments.js:153-173`: a callback for an unknown order makes four lookups (bookings, tickets,
  series, replays) one after the other; fine, but an index-only `UNION` would make a callback storm cheaper.
- `server/routes/admin.js:122`: the admin overview reads the whole `bookings` table (32 ms at 100,000 bookings) — fine for an admin page.
