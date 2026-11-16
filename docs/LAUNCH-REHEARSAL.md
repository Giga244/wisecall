# Launch rehearsal (5–6 October 2026)

Wisecall was run locally with Postgres 16 and seeded test data, and put through load, race, resilience and backup drills. Everything ran
against the **fake** bank, fake ID check, a fake email API and a fake Daily API: no real key, payment or person was involved. The code
changes this found are in [`TODO-REHEARSAL.md`](TODO-REHEARSAL.md) (file:line and the fix for each); this page is the evidence.

**Verdict.** The money is right under every load and race we could make: no oversold seat, no double payment, ledger always balanced.
The limit is CPU: **Render Starter (0.5 CPU) saturates at about 100 actively-clicking visitors**. Launch on **Standard (1 CPU, 2 GB)**,
`WEB_CONCURRENCY` unset (=1: the app is one process), and fix R-1 (answer after decline) and R-2 (shutdown) before launch day.

## Top 5 findings

| # | Finding | Severity | Where | Evidence |
|---|---|---|---|---|
| 1 | Starter's 0.5 CPU is the bottleneck: past ~100 active visitors every page queues (p95 0.7 s at 100, 2.6 s at 150, 3.2 s at 200). Standard handles ~2.7× more. | 🟡 capacity | plan | §1, `results/capacity-*.json` |
| 2 | A mentor's answer can be accepted after they declined the same question: the buyer gets the answer **and** a full refund | 🟠 | `server/models.js:211` | R-1, `scripts/rehearsal/repro-answer-after-decline.js` |
| 3 | Mentor stats are recomputed over all bookings on every home/Browse view: 74 ms of DB time per view at 100,000 bookings | 🟡 scale | `server/models.js:230` | R-4, `results/scale-explain.json` |
| 4 | Graceful shutdown never completes under traffic (keep-alive): every deploy will be killed mid-request | 🟠 | `server/index.js:325` | R-2, §4 |
| 5 | `/live` does one DB query per mentor (N+1), the slowest page under load; and public lists are never cached | 🟡 | `server/live/listing.js:27`, R-5 | R-3, §1, §3 |

No 🔴 finding: every invariant held after every test (§2).

## Recommendation

- **Render plan: Standard (1 CPU, 2 GB) for the web service.** Starter works for a quiet soft launch but has no headroom for a spike
  (a post on social media, a TV mention): at 150 active visitors it answers in 2.6 s (p95) and the `/live` page in 5 s. Prices at the time of
  writing: Starter $7, Standard $25, Pro $85 per month [VERIFY on render.com/pricing — Render reportedly changed its plans in September 2026].
- **Not Pro (2 CPU):** the app is a single Node process and used 102 % of one core on Pro; +20 % throughput for 3.4× the price. Pro only
  pays once clustering exists (R-11).
- **`WEB_CONCURRENCY`:** leave unset. Nothing reads it (no cluster); setting it changes nothing.
- **`NODE_OPTIONS=--max-old-space-size=1536`** on Standard (`384` on Starter): memory peaked at 185 MB under the heaviest load, so this is a
  safety net, not a need.
- **Database:** `basic-256mb` is fine for launch (no query > 20 ms under load except row-lock waits). Fix R-4 before ~50,000 bookings, or
  plan the next database tier then.
- **One instance.** Two instances would work for money (the sweep is advisory-locked) but rate limits are per process (R-11).

**How many people the current setup handles** (one Starter instance, as `render.yaml` sets it up today):

| | Starter (0.5 CPU) | Standard (1 CPU) |
|---|---|---|
| Comfortable (p95 < 200 ms) | ≤ 75 active visitors · ~190 requests/s | ≤ 200 active visitors · ~540 requests/s |
| Breaking point (p95 > 1 s) | ~100–110 active visitors · 214 requests/s ceiling | ~280–300 active visitors · ~580 requests/s ceiling |
| Simultaneous paying buyers (tested) | 50 at once: all paid in 2.1 s | not needed |
| Rough "people on the site at once"* | ~800–1,000 | ~2,500 |

\* "Active visitor" = a virtual visitor who opens a page every 1–3 s (much faster than people). A real visitor reads for ~30 s between
pages, so one active visitor ≈ 10–15 real ones; the last row is that conversion, an estimate, not a measurement.

---

## How it was run

| | |
|---|---|
| Data | `scripts/rehearsal/seed.js`: 50 listable mentors (12 fields, 2 regulated), 500 buyers + 1 admin, 21 published live sessions (30 seats; one "last seats" session), 2,000 answered questions with payouts, 1,333 ratings, 300 public answers. Scale copy: `scripts/rehearsal/inflate.sql` (+20,000 buyers, +100,000 answered questions). |
| Server | `scripts/rehearsal/start-server.sh <plan>`: the app inside a Linux cgroup with Render's CPU and memory (Starter 0.5 CPU / 512 MB, Standard 1 / 2 GB, Pro 2 / 4 GB). Entry `scripts/rehearsal/server-prodlike.js`: production caching on (pages and asset versions cached, as with `NODE_ENV=production`), the fake bank/ID check kept on, email and Daily pointed at `scripts/rehearsal/fake-upstreams.js`, bank faults injectable. |
| Database | Postgres 16 on the same 4-CPU machine, **not** throttled (stronger than Render's `basic-256mb`; see "Limits" below). `pg_stat_statements` and `log_min_duration_statement = 20 ms`. |
| Tests | `tests/load/*.js` (no dependencies; Node 22 `fetch`). `scripts/rehearsal/run.sh` wraps each with the monitor (CPU, RSS, DB connections each second) and the invariants. Raw results: `tests/load/results/`. |

**Limits of this rehearsal.** The database ran unthrottled and on the same machine (no network latency); Render's database is smaller and
a few ms away, so DB-heavy pages will be somewhat slower there. The load generator ran from one address (rate limits raised with
`RATE_LIMIT_MULTIPLIER`, as the project allows outside production). TLS, Render's proxy and the internet are not in the numbers.

---

## 1. Load tests

### 1.1 200 visitors browsing for 5 minutes (Starter)

`node tests/load/browse.js --vus 200 --duration 300` — home (EN and `/ka/`), Browse (`/advice/<field>`), profiles, `/live`, a live
session, `/answers`, an answer; each page = the HTML + the API calls the page really makes (recorded with Playwright), 20 % signed in,
first visits also load the CSS/JS. Think time 1–3 s.

| | requests | p50 | p95 | p99 | errors |
|---|---|---|---|---|---|
| all | 57,546 (211/s) | 414 ms | 3,190 ms | 7,926 ms | 0 |
| HTML pages | | 428 ms | 8,038 ms | 8,778 ms | 0 |
| API calls | | 414 ms | 2,198 ms | 2,691 ms | 0 |
| home / home-ka | | 321 ms | 2,106 ms | 2,397 ms | 0 |
| Browse | | 347 ms | 2,103 ms | 2,366 ms | 0 |
| profile (9 requests per view) | | 608 ms | 3,790 ms | 4,202 ms | 0 |
| **/live** | | 78 ms | **8,734 ms** | 10,192 ms | 0 |
| /answers | | 79 ms | 574 ms | 802 ms | 0 |

Resources: CPU 50 % of one core for the whole run = **100 % of Starter's 0.5 CPU** (3,012 throttled periods), memory 121 → 163 MB, at most
11 DB connections (3 active). The database was never the limit (busiest statement 0.54 ms on average). Invariants ✅.

(A first run with the server in plain development mode — no page cache, every file re-read and re-hashed per request — was ~20 % slower:
`server-prodlike.js` exists so the numbers match production.)

### 1.2 Breaking point (`scripts/rehearsal/capacity.sh`, 60 s per step)

| Starter | 25 | 50 | 75 | 100 | 150 visitors |
|---|---|---|---|---|---|
| requests/s | 69 | 138 | 197 | 214 | 213 |
| p95 / p99 | 25 / 79 ms | 68 / 110 ms | 187 / 447 ms | **682 / 1,498 ms** | 2,584 / 8,201 ms |
| CPU (of 1 core) | 19 % | 33 % | 43 % | 48 % | 48 % |

| Standard | 100 | 150 | 200 | 300 visitors |
|---|---|---|---|---|
| requests/s | 278 | 415 | 543 | 582 |
| p95 / p99 | 23 / 38 ms | 32 / 61 ms | 79 / 228 ms | **962 / 2,385 ms** |
| CPU | 51 % | 67 % | 83 % | 95 % |

Pro (2 CPU) at 300 visitors: 696 requests/s, p95 433 ms, CPU 102 % of one core (the second core idle). No step produced an error: past the
limit the site gets slow, it does not fail. Memory never above 185 MB on any plan.

### 1.3 50 buyers ask and pay at the same moment (Starter)

`tests/load/pay.js --buyers 50`: ask → fake bank page → pay (the fake bank sends its signed callback) → the buyer's `/sync`.
**50/50 paid, 50 receipts**, 2.1 s for all of them. End to end p50 1.56 s, p95 1.87 s; ask p95 1.04 s; one `/sync` each. Invariants ✅.

### 1.4 31 buyers for the last 30 seats (Starter)

`tests/load/seats.js --buyers 31`: **30 held, 1 × `409 sold_out`**, all 30 paid; buy step p95 397 ms (457 ms for all). Not oversold. The
session row lock serialises the buyers: 7 connections waited on it at the peak.

Bigger rush, with 50 visitors browsing at the same time: **150 buyers for 100 seats → 100 paid, 50 sold out, not oversold**; buy step
p95 2.1 s. All 10 pool connections were busy (9 waiting on the lock) and the background browsing halved for ~10 s (p95 0.9 s), then
recovered → R-6.

### 1.5 Bank callback storm (Starter)

`tests/load/callbacks.js --orders 40`: 40 bookings; at the same instant the fake bank page "pay" for each (its own callback) + 100 signed
duplicate callbacks (2–3 per order) + 10 for unknown orders + 10 forged → **40/40 paid, exactly 40 payment receipts**; genuine callbacks
p95 889 ms, unknown orders 200, forged signatures 400. Invariants ✅.

### 1.6 Refunds racing answers (Starter, two runs of 3 × 10)

`tests/load/refund-race.js`:

| Race | Result | Consistent? |
|---|---|---|
| A. answer vs decline (same mentor, same moment) | run 1: 10 declines won; run 2: 9 answers won, 1 decline won — **but in that one the answer also got 200** | money ✅, behaviour ❌ → R-1 |
| B. answer at the deadline vs the refund sweep | 4+5 answered in time (payout), 6+5 `409 deadline_passed` and refunded | ✅ |
| C. decline vs 3 duplicate callbacks + 3 buyer status checks | 20/20 refunded once, one refund receipt each | ✅ |

## 2. Correctness under load

`scripts/rehearsal/invariants.js` (17 checks + the ledger equation) ran after every test:

- no session oversold (counting paid + refunding, and counting live holds); one active ticket per attendee per session
- no orphan seat hold (expired holds closed, every hold got a bank order)
- no booking or ticket paid twice; no bank order used twice; every paid booking/ticket has exactly one payment receipt; every refund one
  refund receipt
- no live payout for a refunded booking; no payout for an unanswered booking; every released answer has its payout; payout + refunded
  share = mentor share; a live payout = the net of its paid tickets; fee + share = price
- **ledger:** payments − refunds − fees = payouts + held for mentors + refunds in progress — **diff 0 after every test**

Result: ✅ after every load test, every race and every resilience drill. (One drill once inserted a test ticket without a receipt and the
checks flagged it at once — the harness bug was fixed; it shows the checks work.)

## 3. Database

`scripts/rehearsal/db-report.js` (`results/db-report.json`), after ~250,000 requests:

- **Statements over 20 ms:** only row-lock waits — `SELECT * FROM live_sessions WHERE id = $1 FOR UPDATE` (369×, avg 79 ms, max 487 ms,
  during the seat rushes) and `bookings … FOR UPDATE` (7×, races). Their plans are a primary-key lookup (0.1 ms): the time is the
  intended serialisation, not a missing index.
- **Top by total time:** `mentorStatsFor`'s two aggregates (53,174 calls each, 0.54 ms) → negligible today, **44 + 30 ms at 100,000
  bookings** (`scripts/rehearsal/scale-explain.js`) → R-4. Everything else stayed ≤ 2.3 ms at scale (a mentor's dashboard 0.8 ms,
  balances 2.3 ms, `/api/experts` list 0.4 ms); the admin overview reads all bookings (32 ms at scale; fine).
- **Sequential scans:** `bookings` 55,386 scans / 111 M rows read — all from those aggregates over the whole table (the planner is right
  to scan 2,000 rows; it is the design that does not scale).
- **N+1:** `/live` (R-3, 1 + N queries), "find me a mentor" matching (R-10, up to 500 sequential queries). The profile page makes 9 HTTP
  requests per view (chatty, each cheap).
- **Missing indexes:** none on hot paths. 50+ foreign keys have no index; the ones that matter when an account is deleted are listed in R-12.
- **Slow endpoints under load:** `/live` (N+1), profile (9 requests), then everything equally once the CPU is saturated.

## 4. Resilience

`tests/load/resilience.js` (`results/resilience-*.json`), each with 10 visitors + a health probe running:

| Drill | What happened | Verdict |
|---|---|---|
| **Postgres stops for 7.3 s** | Requests failed fast (500 pages, 503 `/healthz`, p95 30 ms — nothing hung); healthy 117 ms after the database was back; the server process survived; a payment right after went through. | ✅ (Render may restart the web service if `/healthz` fails long enough — harmless) |
| **Email API answers 503** | Payments unaffected (3 paid in 80 ms); sign-up 201 in 1 s (code not sent, can be re-sent); reset 0.8 s. | ✅ |
| **Email API hangs** | Payments unaffected (39 ms); **sign-up waits 31 s, "forgot password" 31 s** (15 s timeout + retry inside the request). | 🟡 R-7 |
| **Daily answers 503 / hangs** | Join → `500 server_error` (in 10 ms / after 10 s); the session page still loads; joins work again as soon as Daily is back. The session is marked `live` although the mentor could not get in. | 🟡 R-8 |
| **Bank API times out when a buyer asks** | `502 payment_error` after 20 s; the booking is closed (`expired`), nothing charged. | ✅ |
| **Bank refund API times out, then errors, then recovers** | Decline answers after 40 s (refund + status check timeouts) with the booking `refund_pending` and the error saved; the sweep keeps retrying while the bank errors; once the bank is back the next sweep refunds it, one refund receipt. | ✅ (40 s is long for the mentor; covered by R-7's idea: a shorter timeout when someone waits) |
| **Bank slow (3 s)** | Ask 3.0 s, `/sync` 3.0 s. | ✅ |
| **Server dies right after the bank took the money** | The callback died with the process; booking left `pending_payment`; restart in 1.6 s; the sweep (`reconcilePending`) asked the bank and recorded it: **paid, one receipt**. | ✅ |
| **SIGTERM (deploy) with 50 visitors browsing** | Kept serving on open connections and exited only after 18 s, when the traffic stopped. | 🟠 R-2 |

**Memory / soak (30 min, Starter, 60 visitors + 2 buyers paying every 10 s; `scripts/rehearsal/soak.sh`, `results/soak-30min.*`):**
~165 requests/s for 29.8 minutes, **0 errors**, 359 questions paid along the way, invariants ✅ (ledger diff 0). p95 stayed under 100 ms most
of the time, with short peaks of 0.4–0.8 s when the background sweep ran (CPU 36 % → 52 % of one core on a 50 % plan). Memory per
5 minutes: 137 → 141 → 141 → 142 → 143 → 143 MB (max 144 MB); after the warm-up it grows 0.13 MB/min, and part of that is the fake
bank's in-memory order list (one entry per payment; it does not exist in production). Every cache in the app is bounded (`auth.js` and
`/sync` clear at 5,000 entries, the rate limiter is swept every 10 min, the page cache holds one entry per page). **No leak found**; keep
the Render memory alert of §6 on during the first week to confirm it over days.

## 5. Backup drill

`scripts/rehearsal/backup-drill.sh` (`npm run backup` → `pg_restore` into a fresh database → compare **all 64 tables** → decrypt the
encrypted IBANs → start the app on the copy → invariants):

| | today's data (12,714 rows) | after a busy year (399,420 rows) |
|---|---|---|
| dump size | 1.0 MB | 23.6 MB |
| backup | 0.44 s | 2.8 s |
| create + restore | 0.17 + 0.67 s | 4.4 s |
| app up on the copy | 0.8 s | 0.8 s |
| **total** | **2.1 s** | **8.1 s** |
| tables that differ | 0 of 64 | 0 of 64 |
| IBANs decrypt with the same key | 50/50 | 50/50 |
| pages on the copy | all 200 | all 200 |
| invariants on the copy | ✅ | ✅ |

The project's own `npm run backup:check` compares only 11 tables (R-9). Render's managed backups and point-in-time recovery depend on the
database plan [VERIFY which plan includes PITR on render.com]; restoring from Render is a separate drill to do once in the dashboard.

## 6. Monitoring to set up before launch

| Where | Alert | Threshold | Why (from the rehearsal) |
|---|---|---|---|
| **Uptime checker** (Better Stack, UptimeRobot, Checkly…) | `GET https://wisecall.ge/healthz` | down for 2 checks at 1-min interval | DB down = 503 here (§4) |
| | `GET /api/status` JSON `status` | `degraded` for 15 min (jobs delayed) or `down` | the sweep repairs lost callbacks and refunds: if it stops, money waits |
| | `GET /` and `/ka/` | response > 2 s for 5 min | Starter's p95 crosses 1 s at ~100 active visitors |
| **Render** (service → Metrics / Notifications) | CPU | > 80 % of the plan for 10 min | CPU is the limit (§1.2) |
| | Memory | > 70 % of the plan (Standard 1.4 GB, Starter 360 MB) for 10 min | peak seen 185 MB; growth = a leak |
| | Deploy failed / service restarted | every time | R-2: restarts kill requests until fixed |
| | Database: connections | > 80 % of the plan's limit | 10–15 per web process (R-6) |
| | Database: storage | > 75 % | ~150 MB per 100,000 questions incl. indexes (§5) |
| **Sentry** (`SENTRY_DSN`, already supported: `server/errorReport.js`) | new issue | every new error type | 500s and unhandled rejections are reported without personal data |
| | error rate | > 1 % of requests for 5 min, or > 20 errors/min | normal load had 0 errors at every level (§1) |
| | any event whose message contains `amount mismatch`, `late bank payment`, `refund failed`, `owed back` | every time | money that needs a person |
| **Logs** (Render log stream → a log alert, or a daily search) | `[jobs] sweep failed`, `[payments] callback processing failed`, `[db] idle client error` (bursts), `[unhandledRejection]` | > 0 in 10 min (sweep), bursts of > 10 (others) | |
| **Daily SQL check** (read-only user) | `node scripts/rehearsal/invariants.js` against production | any violation | the same 18 checks that held all through the rehearsal |
| | `SELECT count(*) FROM bookings WHERE status = 'refund_pending' AND refund_requested_at < now() - interval '1 hour'` (and the same for `live_tickets`) | > 0 | a refund the bank has not confirmed |
| | `SELECT count(*) FROM bookings WHERE status = 'paid' AND answer_deadline < now() - interval '30 minutes'` | > 0 | the deadline refund did not run |
| **Email provider** (Resend dashboard) | bounce rate / failed sends | > 5 % in a day | sign-up codes are sent inside the request (R-7) |
| **Bank** (BOG/TBC merchant portal) | daily: payments in the portal = payment receipts in the admin overview | any difference | the callback + sweep design makes them equal; a difference means a missed case |

## 7. Re-running it

```bash
# once: a local Postgres with pg_stat_statements, log_min_duration_statement = 20 and log_line_prefix = '%m [%p] %q%u@%d '
createdb wisecall_rehearsal
export DATABASE_URL=postgresql://USER:PASS@localhost:5432/wisecall_rehearsal
npm run migrate && node scripts/rehearsal/seed.js
scripts/rehearsal/start-server.sh starter            # or standard / pro / none
scripts/rehearsal/run.sh browse-200 node tests/load/browse.js --vus 200 --duration 300
scripts/rehearsal/capacity.sh starter 60 25 50 75 100 150
scripts/rehearsal/run.sh pay-50 node tests/load/pay.js --buyers 50
scripts/rehearsal/run.sh seats-31 node tests/load/seats.js --buyers 31 --offset 100
scripts/rehearsal/run.sh callbacks node tests/load/callbacks.js --orders 40 --offset 200
scripts/rehearsal/run.sh refund-race node tests/load/refund-race.js --k 10 --offset 300
node tests/load/resilience.js --plan starter          # postgres, email, daily, bank, crash
scripts/rehearsal/soak.sh 30 60
node scripts/rehearsal/db-report.js
scripts/rehearsal/backup-drill.sh
```
Each run reuses different buyers (`--offset`), because a buyer with an open payment is refused a second one. Re-seed for a clean slate
(drop and re-create the database). Never point any of this at a hosted database: the scripts refuse a database whose name does not
contain `rehearsal`, `test` or `restore`, and `lib.js` refuses Render/AWS host names.
