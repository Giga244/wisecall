# Wisecall code audit (prelaunch)

Audited commit: `2b99ada` ("Mentor verification rules v2"). Method: a read of the server code (auth, bookings, payments, ledger, jobs,
banks, Didit, admin, verification, uploads, profiles) and probes against the app running locally with the mock bank and mock ID check.

**Scope note.** This audit covers security, money logic, privacy and reliability in the server. It does **not** yet cover accessibility
(axe), mobile layout, SEO or the Georgian text; those are still to do.

Severity: 🔴 critical (fix before payments open) · 🟠 important · 🟡 nice to have.
Numbers are stable: tests in `tests/cloud/` refer to them as `AUDIT #n`.

---

## Findings

### #1 🔴 Rate limits can be bypassed by changing the letter case of the URL
- **Where:** `server/rateLimit.js:11` (`const key = \`${req.ip}:${req.baseUrl}${req.path}\``), mounted in `server/index.js:56-82`.
- **What:** Express matches routes case-insensitively, but the limiter's key keeps the case the client sent. `/api/auth/login`,
  `/api/auth/LOGIN`, `/api/Auth/Login`… are the same route but each gets its own counter. Checked on the running app: after
  `/api/auth/resend-verification` returned 429, `/api/auth/Resend-Verification` still returned 401 (not limited).
- **Why it matters:** every limit (login, sign-up, email codes, password reset, 2FA verify, contact form, report, uploads) is effectively
  unlimited for a script. Password guessing and code brute force (#2) become practical.
- **Fix:** build the key from a normalised path: `` `${req.ip}:${(req.baseUrl + req.path).toLowerCase().replace(/\/+$/, '')}` ``, or
  `app.set('case sensitive routing', true)` plus `strict routing`. For regex-mounted limits (`/api/experts/:id/report`) key on the route
  pattern, not the concrete id.

### #2 🔴 No per-account limit on wrong email-verification codes (leads to admin takeover)
- **Where:** `server/routes/auth.js:155-169` (`/verify-email`), also `/work-email/verify` in `server/verification/credentials.js:97`.
- **What:** a 6-digit code (900 000 values) valid 15 minutes, checked with no attempt counter. The only brake is the per-IP limiter,
  which #1 removes.
- **Why it matters:** admin rights are "email is in `ADMIN_EMAILS` **and** verified" (`server/adminAuth.js:11`). If an address in
  `ADMIN_EMAILS` has not signed up yet, anyone can sign up with it, brute-force the code, set up 2FA themselves, and own the admin panel.
  It also lets people verify addresses they do not own.
- **Fix:** add `email_code_attempts int` to `users`; increment on every wrong code; after 5 wrong codes clear the code
  (`email_code_hash = NULL`) and require "resend". Reset the counter on success/resend. Same for the work-email code. Also: create
  every `ADMIN_EMAILS` account yourself before launch.

### #3 🟠 Sessions survive logout, password reset and password change
- **Where:** `server/auth.js:7-9` (stateless 30-day JWT), `server/routes/auth.js:95-98` (logout only clears the cookie),
  `:147-152` (reset), `server/routes/me.js:204` (change).
- **Why it matters:** someone who stole a cookie, or a device left signed in, keeps access for up to 30 days after the owner resets the
  password, which is the reason people reset it.
- **Fix:** add `users.session_version int NOT NULL DEFAULT 0`; put it in the token (`sv`); `requireAuth`/`optionalAuth`/`whoIsAsking`
  compare it with the database (one indexed lookup, or a 30 s in-memory cache); increment it on password reset/change and on
  "log out everywhere". Consider a shorter token life (7 days, sliding).

### #4 🟠 A late "paid" from the bank on an expired booking is ignored, so the buyer is charged and gets nothing
- **Where:** `server/payments.js:102` (`syncBooking` returns early unless status is pending/paid/answered/refund_pending),
  `server/jobs.js:62-75` (`reconcilePending` expires after `PAYMENT_TTL_MINUTES + 10`), `server/jobs.js:78-86` (`purgeUnpaid` deletes
  expired bookings after 7 days, after which the callback finds no booking at all).
- **Why it matters:** 3-D Secure, a slow bank, or a callback that arrives after the sweep gave up means money taken with no question
  and no automatic refund, and nobody notices.
- **Fix:** in `syncBooking`/`handleCallback`, also look at `expired` bookings. If the bank says `paid` for an expired booking, either
  revive it (`paid`, new deadline) when it is recent, or call `refundBooking(id, 'late_payment')` immediately, and alert the admins.
  Never `purgeUnpaid` a booking whose bank order was not confirmed failed/expired by the bank.

### #5 🟠 A refund whose response was lost (timeout) is retried forever and never confirmed
- **Where:** `server/payments.js:131-165`, `server/jobs.js:38-46` (`retryRefunds`), `:49-58` (`confirmRefunds` only looks at rows with
  `refund_error IS NULL`).
- **What:** if the bank accepted the refund but our request timed out, `refund_error` is set. The retry sends the refund again; the bank
  now refuses (the order is already refunded), so `refund_error` is set again, and `syncBooking` is never reached. The booking stays
  `refund_pending` forever, and the buyer is never told.
- **Fix:** in `refundBooking`, before re-sending a refund that has `refund_error`, call `getPaymentStatus`; if the bank already reports
  `refund_pending`/`refunded`, clear the error and let `applyBankStatus` finish it. Also run `syncBooking` after a failed refund call.

### #6 🟠 Refund and answer at the same moment can leave a pending payout on a refunded booking
- **Where:** `server/routes/bookings.js:125-133` (`claimAnswer`, then separately `ledger.onAnswered`), `server/payments.js:131-150`,
  `server/ledger.js:16-36`.
- **What:** `claimAnswer` commits `status='answered'`; an admin refund (allowed on `answered`) can then run `onRefundRequested` before
  `onAnswered` inserts the payout. It finds no payout to void, and then `onAnswered` inserts a `pending` payout for a refunded booking.
- **Fix:** in `ledger.onAnswered`, insert only if the booking is still answered:
  `INSERT … SELECT … FROM bookings WHERE id=$1 AND status='answered' ON CONFLICT DO NOTHING`, or do the claim and the ledger insert in
  one transaction that locks the booking row.

### #7 🟠 A mentor can answer after the deadline, until the next sweep runs
- **Where:** `server/models.js:170-178` (`claimAnswer` checks only `status='paid'`), `server/routes/bookings.js:117-118`.
- **What:** between `answer_deadline` and the next sweep (up to `SWEEP_INTERVAL_SECONDS`, 10 min by default, longer if the job is
  slow), the answer is accepted and the automatic refund never happens.
- **Why it matters:** the Terms promise a refund after `ANSWER_DEADLINE_DAYS`.
- **Fix:** add `AND (answer_deadline IS NULL OR answer_deadline > now())` to `claimAnswer` and return `deadline_passed`. (Or decide on a
  written grace period and put it in the Terms.)

### #8 🟠 A required step failed by the system does not take a listed mentor off the site
- **Where:** `server/util.js:35-39` and `server/models.js:182-185` (`isListable`/`listableSql` only check
  `verification_status='verified'`), `server/verification/kyc.js:155` (`updateAge` fails the age step without delisting),
  `server/verification/names.js` (name mismatch), license expiry is handled separately.
- **What:** only an **admin** failing a step delists (`server/verification/review.js:67`). If the ID check, age or name step becomes
  `failed` any other way, the mentor stays listed and bookable.
- **Fix:** move the "failed required step → `verification_status='pending'` + audit `delisted`" rule into `steps.setStep` (for any
  actor), or make `listableSql` also require that no required step is failed.

### #9 🟠 Admins cannot download a document whose filename has Georgian letters
- **Where:** `server/routes/adminVerification.js:494-498`, filename kept by `server/verification/credentials.js:128-132`.
- **What:** `Content-Disposition: attachment; filename="დიპლომი.pdf"` makes Node throw `ERR_INVALID_CHAR` (checked), so the admin
  gets a 500.
- **Fix:** `res.attachment(doc.meta.filename)` (Express writes an RFC 5987 `filename*=UTF-8''…`), or
  `` `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(name)}` ``.

### #10 🟠 Askers' profiles are public by default
- **Where:** `migrations/013_profiles.sql` (`profile_visibility DEFAULT 'public'`), `server/profiles.js:84-89`.
- **What:** every buyer gets a public `/u/<username>` page (name, photo, bio, city…), and usernames are made from real names
  (`nino-beridze`), so they are easy to guess. People asking about health, law or money may not expect this.
- **Fix:** default `contacts` for non-mentors (a new migration, plus the sign-up flow), and say it in the Privacy Policy.

### #11 🟡 Two throwaway accounts can flag any mentor
- **Where:** `server/reports.js:17-43`, `server/probation.js:64-70`.
- **What:** any signed-in account (email not even verified) can report any mentor; 2 reports open a `reports` flag, which also stops the
  automatic release of that mentor's held answers.
- **Fix:** count towards the flag only reports from verified-email accounts with a paid booking with that mentor; rate-limit reports per
  account.

### #12 🟡 `refunded_partially` is never handled
- **Where:** `server/payments.js:83` (only `refunded`), statuses from `server/pay/bog.js:89`, `tbc.js:66`.
- **What:** a partial refund made in the bank's dashboard leaves the booking `refund_pending` forever, polled every sweep.
- **Fix:** record it (`refund_partial` note + admin alert) and stop polling.

### #13 🟡 TBC refunds have no idempotency key, and `cancel` may not be the right call for settled payments
- **Where:** `server/pay/tbc.js:82-85`. See `docs/BANK-GOLIVE.md`.

### #14 🟡 `/api/bookings/:id/answer` answers 400 instead of 403 for someone else's booking
- **Where:** `server/routes/bookings.js:113`. No data leaks; just the wrong status.

### #15 🟡 In-memory state limits the app to one instance
- **Where:** `server/rateLimit.js` (buckets), `server/routes/bookings.js:91` (`lastSync`), mock providers.
- **What:** limits reset on every deploy/restart; a second instance doubles every limit. Fine for now (Render, one instance); write it down.

### #16 🟡 BOG's callback public key is hard-coded
- **Where:** `server/pay/bog.js:13-21`. Confirm it against BOG's current docs before go-live and set `BOG_CALLBACK_PUBLIC_KEY`
  explicitly. See `docs/BANK-GOLIVE.md`.

### #17 🟡 Missing index for account signals
- **Where:** `server/verification/signals.js:63-67` filters `account_signals` by `user_id`; there is no index on it
  (`migrations/018_verification_v2.sql:71-73`). Add `CREATE INDEX ON account_signals (user_id, created_at DESC)`.

### #18 🟡 Floating-point rounding of the platform fee (only for a non-whole fee percent)
- **Where:** `server/routes/bookings.js:34` (`Math.round(amount * (config.PLATFORM_FEE_PERCENT / 100))`).
- **What:** with a fee such as 17.5 %, `amount * 0.175` is computed in binary floating point, so an exact half tetri is sometimes just
  below .5 and rounds **down** (found by `tests/cloud/money.test.js`: prices 7, 13, 27, 29, 53 ₾… at 17.5 %). Fee + mentor share still
  add up to the price, so no money is lost, but the rounding is inconsistent. With the default 20 % there is no rounding at all.
- **Fix:** integer maths: `Math.round(amount * Math.round(PLATFORM_FEE_PERCENT * 100) / 10000)`, or accept only whole-number percents in
  `server/config.js`.

---

## What was checked and is fine
- `npm audit`: 0 vulnerabilities (prod and dev).
- No secrets in the code or the git history (keys, `.env`, private keys, database URLs).
- SQL: every query uses parameters; dynamic column names come from fixed maps (`server/models.js`).
- CSRF: custom header + Origin + `Sec-Fetch-Site` checks on every state-changing `/api` call; SameSite=Lax cookies.
- CSP: `script-src 'self'`, no inline scripts; HSTS in production; `frame-ancestors 'none'`.
- Bank callbacks: BOG RSA signature checked; TBC callbacks only trigger a status lookup; the status and amount always come from the bank's
  API; an amount/currency mismatch is refused. Payment state changes run under `SELECT … FOR UPDATE`.
- Didit webhook: HMAC (v2 sorted JSON or raw), 5-minute timestamp window, `vendor_data` must match the session's user, event ids
  de-duplicated.
- SSRF: evidence link checks resolve DNS, refuse private/reserved ranges (IPv4, IPv6, mapped, NAT64, 6to4), pin the checked address,
  re-check every redirect, limit size and time. Google photos: Google hosts only, redirects refused.
- Uploads: type from magic bytes, size limits, photos re-encoded (EXIF dropped), documents AES-256-GCM encrypted, admin-only, deleted
  90 days after a decision.
- Admin: `ADMIN_EMAILS` + verified email + TOTP 2FA (replay-protected, lockout after 5 wrong codes, recovery codes hashed); admin
  scripts/dictionaries are not served to non-admins.
- Answers: one answer per booking, enforced by a conditional `UPDATE`.
