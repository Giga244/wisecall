# TODO from the cloud session (branch `cloud/prelaunch-pack`)

This branch adds **only new files** (docs and tests). Everything below needs a change in existing code or config, and is written here
instead so it can be picked up by whoever works on `main`, without merge conflicts. Numbers refer to `docs/AUDIT.md` (#n) and
`docs/BANK-GOLIVE.md` (Bn).

## Top 5 (do before opening payments)

1. **#1 + #2 — rate-limit bypass + unlimited email-code guesses (admin takeover path).** `server/rateLimit.js:11`: lower-case and
   normalise the key. `server/routes/auth.js:155` (and `credentials.js:97`): count wrong codes per account, kill the code after 5.
   Also: sign up and verify every `ADMIN_EMAILS` address before launch. Tests: `auth.test.js` (2 todo).
2. **#4 — a late "paid" on an expired booking is lost.** `server/payments.js:102` and `handleCallback`: when the bank says `paid` for an
   `expired` booking, revive it or refund at once and alert admins; `server/jobs.js:78` must not purge bookings the bank has not
   confirmed failed. Test: `money.test.js` (todo).
3. **#5 — a refund whose response was lost stays "refund in progress" forever.** `server/payments.js:131-165`: before re-sending a
   refund that has `refund_error`, ask the bank's status; run `syncBooking` after a failed refund call too. Test: `money.test.js` (todo).
4. **#8 — a required step failed by the system does not delist a listed mentor.** Move the delist rule from
   `server/verification/review.js:67` into `steps.setStep` (any actor), or make `listableSql`/`isListable` exclude failed required steps.
   Test: `verification.test.js` (todo).
5. **#3 — sessions survive password reset/change/logout.** Add `users.session_version`, put it in the JWT, check it in
   `requireAuth`/`optionalAuth`/`whoIsAsking`, bump it on reset/change. Tests: `auth.test.js` (2 todo).

If TBC is the launch bank, **B1 and B2** (below) move into the top 5: either could make every TBC payment fail.

## Tests marked `todo` (they fail today, on purpose)

Run: `node --test --test-concurrency=1 tests/cloud/*.test.js`. Result on this branch: **34 tests: 23 pass, 11 todo, 0 fail.**
When a finding is fixed, remove its `{ todo: … }` so the test guards the fix.

| File | Test | Finding |
|---|---|---|
| `tests/cloud/auth.test.js` | a session opened before a password RESET is signed out | #3 |
| `tests/cloud/auth.test.js` | other sessions are signed out after a password CHANGE in Settings | #3 |
| `tests/cloud/auth.test.js` | after 5 wrong codes the code stops working | #2 |
| `tests/cloud/auth.test.js` | a rate limit cannot be dodged by changing the letter case of the address | #1 |
| `tests/cloud/auth.test.js` | someone else's answer is refused with 403 (not 400) | #14 |
| `tests/cloud/money.test.js` | a late "paid" from the bank on a booking the sweep already expired is not lost | #4 |
| `tests/cloud/money.test.js` | a refund whose response was lost (timeout) but that the bank carried out ends "refunded" | #5 |
| `tests/cloud/money.test.js` | an answer racing an admin refund never leaves a pending payout on a refunded booking | #6 — a race: it **passed** on the recorded run; keep it `todo` until the fix, since it can fail on any run |
| `tests/cloud/money.test.js` | an answer after the deadline is refused | #7 |
| `tests/cloud/money.test.js` | 17.5%: fee rounded to the nearest tetri | #18 |
| `tests/cloud/verification.test.js` | a required step failed by the SYSTEM also takes a listed mentor off the site | #8 |

## Code changes (existing files)

| Priority | Where | What | Ref |
|---|---|---|---|
| 🔴 | `server/rateLimit.js` | Normalised, lower-cased key | #1 |
| 🔴 | `server/routes/auth.js`, `server/verification/credentials.js`, new migration | Per-account wrong-code counter (email + work email) | #2 |
| 🟠 | `server/auth.js`, `server/adminAuth.js`, `server/routes/auth.js`, `server/routes/me.js`, new migration | Session versioning; "log out everywhere" | #3 |
| 🟠 | `server/payments.js`, `server/jobs.js` | Late paid on expired bookings; don't purge unconfirmed | #4 |
| 🟠 | `server/payments.js`, `server/jobs.js` | Refund retry checks bank status first | #5 |
| 🟠 | `server/ledger.js` (`onAnswered`) | Insert the payout only if the booking is still `answered` (same statement or locked transaction) | #6 |
| 🟠 | `server/models.js` (`claimAnswer`) | `AND answer_deadline > now()`; new error `deadline_passed` (+ i18n key) | #7 |
| 🟠 | `server/verification/steps.js` or `server/models.js`/`server/util.js` | Delist on any failed required step | #8 |
| 🟠 | `server/routes/adminVerification.js:494` | `res.attachment(filename)` so Georgian filenames download | #9 |
| 🟠 | new migration + sign-up | Default `profile_visibility = 'contacts'` for non-mentors | #10 |
| 🟡 | `server/reports.js` | Only verified accounts with a paid booking count towards the "reports" flag | #11 |
| 🟡 | `server/payments.js` | Handle `refunded_partially` (record + alert, stop polling) | #12 |
| 🟡 | `server/routes/bookings.js:113` | 403 for someone else's booking | #14 |
| 🟡 | `server/routes/bookings.js:34` or `server/config.js` | Integer fee maths, or whole-number fee percents only | #18 |
| 🟡 | new migration | `CREATE INDEX ON account_signals (user_id, created_at DESC)` | #17 |
| 🟡 | `package.json` | Make `npm test` also run `tests/cloud/*.test.js` (e.g. `node --test --test-concurrency=1 tests/*.test.js tests/cloud/*.test.js`) | — |

## Bank integration (from `docs/BANK-GOLIVE.md`)

| Ref | Where | What |
|---|---|---|
| B1 | `server/pay/tbc.js:51`, `server/config.js` | Confirm TBC's max `expirationMinutes`; cap what we send (default `PAYMENT_TTL_MINUTES` is 30) |
| B2 | `server/pay/tbc.js:46` | Confirm `subTotal` vs `subtotal` and use TBC's spelling |
| B3 | ops | Register the callback URL on TBC's merchant dashboard |
| B6 | `server/pay/bog.js:45`, `server/payments.js:44` | Pass the buyer's language to BOG (`Accept-Language: ka`) — `createPayment` already receives `language` |
| B7 | `server/pay/bog.js:64` | Send an `Idempotency-Key` (e.g. derived from the booking id) on order creation |
| B9 | `server/pay/tbc.js` | Decide and send `methods` (card / Apple Pay / Google Pay; probably not installments) |
| B10 | Render env | Set `BOG_CALLBACK_PUBLIC_KEY` explicitly after confirming it with BOG |

## Operations features the runbook had to work around (`docs/RUNBOOK.md`)

- **Data-protection requests:** an admin (or script) to export one user's data as JSON, and to delete/anonymise an account while keeping
  payment records. Today: by hand.
- **`DATA_ENCRYPTION_KEY` rotation:** versioned ciphertext (`v2:<keyId>:…`) with old keys still readable, plus a re-encrypt script for
  `users.payout_iban_enc`, `mentor_credentials.license_number_enc`, `kyc_sessions.verified_name_enc`/`birth_date_enc`,
  `verification_documents.data_enc`, `admin_two_factor.secret_enc`. Note that `server/verification/signals.js:9` and
  `server/verification/names.js:119` also derive HMAC keys from it.
- **Admin bookings list:** search by email/name/order id (today: status filter only).
- **Chargebacks / refunds made outside Wisecall:** a way to record them (status or note) so the ledger and the mentor's debt are right.
- **Automatic retention:** delete KYC results, licence details and closed accounts after the period the lawyer sets (Privacy Policy §4).

## Legal (from `docs/legal/`)

- After lawyer review, move the approved Terms/Privacy text into `public/i18n/en.json` and `ka.json` (`legal.*`), and add pages for the
  Mentor Agreement, Refund Policy and Cookie Notice (and links in the footer).
- The question form probably needs a consent line for the consumer-law withdrawal exception (Terms §4.7) — needs an i18n key and a
  checkbox or text.
- The mentor application needs explicit consent to the biometric ID check before it starts (Privacy §2) — i18n key + checkbox.
- The Mentor Agreement must be accepted on submit (checkbox + stored acceptance time/version) — needs a column.
