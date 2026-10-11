# Wisecall security and correctness review 2

Reviewed: everything added to `main` after `2a90c51` up to `bb79e98` (107 commits): the Inbox and follow-ups, disputes and partial
refunds, receipts and statements (PDF/CSV), account deletion and the data export, two-step verification for every account, the
breached-password check, the server-rendered SEO pages, `/ka` routes, the help centre, the admin overview, Sentry, Plausible, backups,
live sessions (tickets, seat holds, series, gifts, waiting list, refunds, Daily.co tokens, the question panel, replays, payouts) and
the richer profiles.

Method: a read of the new server code and of the client code that draws user text, then probes against the real server (started by
the tests with the mock bank, the fake TBC bank of `tests/fakeBank.js`, the fake video provider, or a fake Daily API). Nothing in the
application was changed: this branch only adds this file and the tests in `tests/cloud-2/`.

Severity: 🔴 critical · 🟠 important · 🟡 nice to have · ⚪ note.
Numbers are stable: the tests in `tests/cloud-2/` refer to them as `REVIEW-2 #n`. A test marked `{ todo: 'REVIEW-2 #n' }` fails today
and shows the problem; it should pass once the finding is fixed (then drop the `todo`).

**Run them:** `node --test --test-concurrency=1 tests/cloud-2/*.test.js` (they need `TEST_DATABASE_URL`, like the other suites, and
must not run at the same time as another suite: they share the test database). They are not yet in `npm test` (this review only adds
files); to include them, add `tests/cloud-2/*.test.js` to the `test` script in `package.json`. Last run: 36 tests, 25 pass, 11 todo
(each todo fails for the reason described below), 0 fail.

| # | | Area | Finding | Test |
|---|---|---|---|---|
| 1 | 🔴 | 2FA | The "second step" cookie works as a full session: the password alone signs in | `two-factor.test.js` |
| 2 | 🟠 | Money | A full refund after a partial one asks the bank for the whole price again | `money.test.js` |
| 3 | 🟠 | Money | A partial refund whose bank answer was lost is sent again (TBC returns the money twice) | `money.test.js` |
| 4 | 🟠 | Live payouts | "The mentor was there" is only the mentor's own heartbeats; an empty call still earns the payout | `live-payout.test.js` |
| 5 | 🟠 | Rate limits | The password asked before deleting the account can be guessed at full speed | `account.test.js` |
| 6 | 🟡 | Deletion | Text the person wrote in disputes and reports stays after the account is deleted | `account.test.js` |
| 7 | 🟡 | Privacy (Daily) | An anonymous "Guest" is identified by their account id to Daily, the call and the mentor | `privacy.test.js` |
| 8 | 🟡 | Live seats | Waiting-list offers are counted without the session lock: two offers for one seat | (read) |
| 9 | 🟡 | Robustness | Malformed unsubscribe/unfollow tokens and ticket ids give 500 instead of 400/404 | `access.test.js` |
| 10 | 🟡 | Privacy (Sentry) | The route tag keeps usernames for `/api/users/<username>…` | `privacy.test.js` |
| 11 | 🟡 | 2FA | Turning 2FA on keeps other devices signed in; turning it off sends no notice | `two-factor.test.js` |
| 12 | ⚪ | Live rooms | A room token stays valid after a refund, until the room ends + 30 min | (read) |
| 13 | ⚪ | Rate limits | Opening a dispute has no limit of its own | (read) |
| 14 | ⚪ | Backups | The database password is on the `pg_dump` command line; dumps are not encrypted | (read) |

## Status (October 2026): all fixed

Every finding is fixed on `main`; `tests/cloud-2/` runs with `npm test` and in CI, with no `todo` left.

| # | Fix |
|---|---|
| 1 | `server/auth.js` refuses any token with a `purpose` or an audience and requires a session id (tokens without one only count if signed before sessions existed, 2026-09-28). The "second step" cookie is signed with its own key and audience and names the person as `uid` (`server/routes/auth.js`). |
| 2 | A full refund after a partial one sends only what is left, as a partial return (`server/payments.js` `refundBooking`). |
| 3 | A partial refund remembers its amount (`partial_refund_amount`, migration 040) until the bank confirms it. On a lost answer the bank is asked what it returned first: recorded if it went back; released only if the bank refused outright or dedupes requests (`idempotentRefunds`: BOG yes, TBC no); otherwise kept "sent, answer unknown" (the decision stands, the payout waits) until the sweep (`settleUnconfirmedRefunds`) records it or, 15 minutes of "nothing returned" later, opens the dispute again. The same for live tickets and series shares (a retried share is checked against the series payment's returned total first). |
| 4 | A mentor heartbeat counts only while the video service lists the mentor in the call (`isPresent`, Daily's presence list). A session that ends normally with paid tickets but nobody seen gets an automatic open report, which holds the payout for an admin. |
| 5 | `DELETE /api/me` and `POST /api/me/password`: 10 an hour per address, and 10 wrong passwords an hour per account (`server/reauthGuard.js`). |
| 6 | Deleting an account empties its dispute and report details and its live questions; the data export now includes them. |
| 7 | Daily and the mentor know a participant by their ticket id, never the account id; the speaker controls take the ticket id. |
| 8 | Waiting-list seats are counted and offered under the session's row lock. |
| 9 | Unsubscribe and unfollow signatures are compared as bytes; every id in the live API is checked to be a uuid ("not found", never a database error). |
| 10 | The Sentry route tag replaces `/users/<username>` too. |
| 11 | Turning two-step verification on ends every other session; turning it off ends them too and emails the owner (EN + KA). |
| 12 | A ticket refunded while its session is live takes its holder out of the call (Daily's eject: check its request body against Daily's docs before turning live sessions on). Tokens still last until the end + 30 minutes: shorter ones would cut people out of a running call. |
| 13 | Opening a dispute: 10 an hour per address (questions and tickets). |
| 14 | `scripts/backup.js` passes the password in `PGPASSWORD`, writes the dump readable by its owner only and says to encrypt it and keep it no longer than the privacy policy promises. Encrypting is left to whoever moves the file (e.g. `age`). |

---

## Findings

### #1 🔴 The "second step" cookie works as a full session: the password alone signs in
- **Where:** `server/routes/auth.js:129` signs the pending cookie as `jwt.sign({ id: user.id, purpose: 'second_step' }, SESSION_SECRET)`;
  `server/auth.js:57-67` (`sessionValid`, used by `requireAuth`, `optionalAuth` and `tokenFrom`) accepts any token signed with that
  same secret that has a user `id`, as long as `sv` matches (a missing `sv` counts as 0) and either has no `sid` or a live one:
  `(!payload.sid || …)`. The pending cookie has no `sid`, and `users.session_version` is 0 for every account that never changed or
  reset its password.
- **What:** someone who knows the password (exactly the case two-step verification is for) posts it to `/api/auth/login`, receives
  `wisecall_2fa`, copies its value into the `wisecall_token` cookie, and is signed in as the account for 10 minutes without a code.
  In that time `/api/me/2fa/disable` with the same password turns two-step verification off for good, and from then on a normal sign-in
  works. Same through Google sign-in (it uses the same pending cookie). Confirmed on the running server.
- **Why it matters:** two-step verification protects nothing for accounts with `session_version = 0` (most of them). Admins are not
  affected (they never get this cookie; their step is checked through `mfaAt`).
- **Fix:** (a) in `sessionValid`, refuse any payload with a `purpose` and require `sid` (the tokens without `sid` are the pre-sessions
  ones from before 2026-09-27; they expire within 30 days, or refuse only those with `iat` after the sessions release); (b) sign the
  pending cookie with its own key and audience, e.g. `jwt.sign({ uid, purpose }, SESSION_SECRET + ':second-step', { audience: 'wisecall-2fa' })`
  and verify it the same way, so it can never be read as a session.
- **Test:** `two-factor.test.js` "the "second step" cookie, copied into the sign-in cookie, does not sign anybody in".

### #2 🟠 A full refund after a partial one asks the bank for the whole price again
- **Where:** `server/payments.js:205-207` (`refundBooking` sends `amount: claimed.amount`, never subtracting `refunded_amount`, and no
  `partial` flag). Reachable after a dispute's partial refund through the admin's "Refund" button (`server/routes/admin.js:361`) and a
  probation rejection (`server/probation.js:59`). `server/pay/tbc.js:82-85` sends that amount as the TBC "cancel" amount.
- **What:** a 25 GEL question, 10 GEL already returned by a dispute: the admin presses Refund and TBC is asked to return 25 GEL (35 GEL
  in all on a 25 GEL payment). Confirmed against the fake TBC bank. TBC either refuses (the booking then stays `refund_pending` and the
  sweep retries it for ever) or returns more than is left. (BOG's full refund sends no amount, and the mock bank ignores it, so the
  existing tests did not see this; the receipt and the ledger already use "price − refunded".)
- **Fix:** `const left = claimed.amount - (claimed.refundedAmount || 0)`; send `{ amount: left, partial: left < claimed.amount }`
  (the ticket refund in `server/live/tickets.js:231` already does this).
- **Test:** `money.test.js` "a full refund after a partial one asks the bank only for what is left".

### #3 🟠 A partial refund whose bank answer was lost is sent again (TBC returns the money twice)
- **Where:** `server/payments.js:241` and `server/live/tickets.js:290` clear `partial_refund_started_at` on **any** error, including a
  timeout after the bank already returned the money; the dispute is then reopened (`server/disputes.js:143`) and the admin decides
  again. `server/pay/tbc.js:82` ignores `idempotencyKey` (TBC has none). Series tickets: `server/live/tickets.js:222` re-claims a
  `refund_pending` series ticket and the sweep (`server/live/tickets.js:384`) calls `refund()` again for any series ticket in
  `refund_pending` (and for any ticket with a `refund_error`), each time sending another partial "cancel" of the series payment.
- **What:** the bank returns 10 GEL but the answer is lost (504). The server says "refund failed", the admin decides 10 GEL again, and
  TBC returns another 10 GEL: 20 GEL out for a 10 GEL decision. Confirmed against the fake TBC bank behind a proxy that drops one answer.
  BOG is protected by its `Idempotency-Key` header.
- **Fix:** before releasing a claim (or retrying a series share), ask the bank what was returned: TBC's payment details carry
  `returnedAmount`, BOG's `refund_amount`. Keep a third state ("sent, answer unknown") that only a status check can clear; never resend
  a partial refund on TBC without that check. For series shares, record the bank's acceptance per ticket before calling it again.
- **Test:** `money.test.js` "a partial refund whose answer from the bank was lost is not sent again".

### #4 🟠 "The mentor was there" is only the mentor's own heartbeats; an empty call still earns the payout
- **Where:** `server/live/room.js:62-66` adds up to 45 s per `POST /api/live/:id/heartbeat` from the mentor; `server/live/settle.js:21`
  decides a normal end (and the payout, `ledger.onLiveEnded`) from that number alone. Nothing asks the video service.
- **What:** a mentor asks for a token once (`/join`, which marks the session live) and then runs a script that posts a heartbeat every
  30 s without ever opening the call. With the fake Daily API reporting an empty room, the presence still grew (3 s in the test).
  After half the planned time the session ends "normally" and the tickets' money becomes the mentor's payout. Participants can dispute
  within the window, but each one must notice and complain.
- **Fix:** count presence only when Daily confirms it: call `GET /rooms/:name/presence` (already used for recordings,
  `server/live/daily.js:85`) in the mentor's heartbeat, or use Daily's meeting webhooks; also hold the payout for review when no
  participant was seen (`live_tickets.attended_seconds` all 0).
- **Test:** `live-payout.test.js` "heartbeats count as presence only when the video service sees the mentor in the call".

### #5 🟠 The password asked before deleting the account can be guessed at full speed
- **Where:** `server/routes/me.js:278` (`DELETE /api/me` checks the password and answers `wrong_password`); the limiter in
  `server/index.js:156` is mounted on `/api/me/delete`, which covers `/delete/cancel` and `/delete/check` but not `DELETE /api/me`.
  (The older `PUT /api/me/password`, `server/routes/me.js:254`, has the same gap.)
- **What:** 25 wrong passwords in a row, with real limits (`RATE_LIMIT_MULTIPLIER=1`): every answer was 400, none 429.
- **Why it matters:** anyone holding a stolen session cookie can find the password (and then use it elsewhere, or pass the re-check
  for payout details and withdrawals), and the account owner is never warned.
- **Fix:** `app.delete('/api/me', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }))` and the same for `PUT /api/me/password`; better,
  count wrong re-authentication passwords per account like `server/loginGuard.js` does for sign-in.
- **Test:** `account.test.js` "cannot be guessed at full speed".

### #6 🟡 Text the person wrote in disputes and reports stays after the account is deleted
- **Where:** `server/account.js:161-174` (`anonymize`) clears ratings, messages, profile reports and more, but not `disputes.details`
  (`opened_by`), `message_reports.details` (`reporter_id`), `live_reports.details` (`reporter_id`), nor `live_questions.body`
  (`author_id`; those go only with the 30-day purge in `server/live/settle.js:90`). Free text like this often carries personal details.
- **What:** after deletion the test still finds "my brother lost his job…" in the dispute and in the message report.
- **Fix:** add `UPDATE disputes SET details = NULL WHERE opened_by = $1`, `UPDATE message_reports SET details = NULL WHERE reporter_id = $1`,
  `UPDATE live_reports SET details = NULL WHERE reporter_id = $1` and `UPDATE live_questions SET body = '[deleted]' WHERE author_id = $1`
  (the body has a length check of 3-300) to the list. (The data export also leaves these out: add them there too.)
- **Test:** `account.test.js` "the words the person wrote in reports and disputes are gone too".

### #7 🟡 An anonymous "Guest" is identified by their account id to Daily, the call and the mentor
- **Where:** `server/live/room.js:49` passes `userId: user.id` for every participant, also when they joined as "Guest N";
  `server/live/daily.js:58` puts it in the meeting token as `user_id`, which Daily shares with everyone in the call. The mentor's room
  state lists `id: r.holder_id` for each person (`server/live/room.js:167`).
- **Why it matters:** the account id appears in public places (photo addresses `/api/photo/<id>`, profile data), so "Guest 3" can be
  matched to a person by the mentor or by anyone in the call who opens the browser tools.
- **Fix:** give Daily and the mentor an opaque id per ticket (the ticket id, or an HMAC of it); keep the mentor's own id (or an opaque
  one stored on the session) for the recording, which looks the mentor up in Daily's presence list (`server/live/daily.js:86`), and
  map the speaker controls by ticket id.
- **Test:** `privacy.test.js` "an anonymous guest is not identified by their account id".

### #8 🟡 Waiting-list offers are counted without the session lock: two offers for one seat
- **Where:** `server/live/waitlist.js:81-95` (`offerFreedSeats`) reads `taken` and loops without locking the session row; it runs from
  the sweep and after each cancellation (`server/live/tickets.js:321`). `SKIP LOCKED` keeps two runs from offering to the same person,
  not from offering the same seat to two people.
- **What:** one cancellation while the sweep runs: both see one free seat and each offers it. Kept offers count as taken, so the first
  person who tries to buy is then told "sold out" until the other offer expires (no overselling: buying is locked).
- **Fix:** do the count and the offers in one transaction that starts with `SELECT … FROM live_sessions WHERE id = $1 FOR UPDATE`, as
  `tickets.buy` does.

### #9 🟡 Malformed unsubscribe/unfollow tokens and ticket ids give 500 instead of 400/404
- **Where:** `server/inbox.js:422` and `server/live/follows.js:39` compare string lengths, then call `crypto.timingSafeEqual` on Buffers
  whose byte lengths differ for non-ASCII input (it throws `RangeError`). `server/routes/live.js:202` (ticket sync) and `:220` (calendar)
  pass the raw id to Postgres, which throws on a non-uuid.
- **What:** each answers 500, and each is an error report to Sentry: anyone can fill the error budget with one request.
- **Fix:** compare `Buffer.byteLength` (or build both Buffers first and compare their `.length`); check `UUID.test(req.params.id)` as the
  series and replay routes already do.
- **Test:** `access.test.js` "an unsubscribe or unfollow link with a non-ASCII signature", "a ticket id that is not an id".

### #10 🟡 The Sentry route tag keeps usernames for `/api/users/<username>…`
- **Where:** `server/errorReport.js:78` replaces `/u/<username>` but not the API form used by the profile page and the report button
  (`/api/users/:username`, `/api/users/:username/report`).
- **Fix:** also `.replace(/\/users\/[^/]+/, '/users/:username')` (and the same for any other route with a username or slug that names a
  person).
- **Test:** `privacy.test.js` "…including the profile API, which has the username in its address".

### #11 🟡 Turning 2FA on keeps other devices signed in; turning it off sends no notice
- **Where:** `server/routes/twoFactorUser.js:55` (enable) and `:73` (disable).
- **What:** a device signed in with the password before 2FA was turned on stays signed in; turning it off (password only) neither
  emails the owner nor ends other sessions. With #1 fixed this is defence in depth.
- **Fix:** on enable, end every other session (`auth.endAllSessions` then start a fresh one for this device); on disable, send an email
  ("two-step verification was turned off") with the device, and end the other sessions.
- **Test:** `two-factor.test.js` "turning it on signs out the other devices that only passed the password".

### #12 ⚪ A room token stays valid after a refund, until the room ends + 30 min
- **Where:** `server/live/rooms.js:38` (token expiry); refunds (`server/live/tickets.js:211`) do not eject the person from Daily. The
  token is also a bearer link in the iframe address, so a holder can pass it to someone else.
- **Fix:** shorter tokens (e.g. 20 minutes, re-issued by the page while the ticket is still paid) and, on a refund during a session,
  Daily's eject endpoint for that participant.

### #13 ⚪ Opening a dispute has no limit of its own
- **Where:** `server/routes/bookings.js:197`, `server/routes/live.js:209`. One dispute per booking or ticket (unique indexes) bounds it,
  and each sends one admin email. Adding the same `rateLimit` as the other report routes keeps it consistent.

### #14 ⚪ Backups: the database password is on the `pg_dump` command line; dumps are not encrypted
- **Where:** `scripts/backup.js:50` passes `--dbname <DATABASE_URL>` (visible in the process list of the machine running it); the dump
  is written unencrypted to `backups/` (git-ignored, good). Old dumps also keep deleted accounts until they are thrown away.
- **Fix:** pass the password through `PGPASSWORD` (and strip it from the URL), write the file with mode 0600, encrypt it (e.g. `age`)
  before it leaves the machine, and keep dumps no longer than the deletion promise (14 days + the retention you state in the privacy
  policy).

---

## Checked and found sound (with tests in `tests/cloud-2/`)

- **Conversations** (`access.test.js`): another account cannot find a booking's thread, read it, post to it, report a message in it,
  or mark someone else's notifications read. Internal notes never leave the admin view (`server/inbox.js:157`). Message bodies are
  plain text and escaped by `public/js/inbox.js`; event texts escape every value they insert.
- **Disputes and receipts:** only the asker can report an answer (not the mentor, not another account). A receipt PDF opens for the
  person who paid and admins only (not the mentor, not another account, not a visitor); a gift's receipt stays with its buyer.
  Statements are per mentor and name no asker.
- **Money:** a partial refund of the whole price or more is refused before the bank is asked; two admins deciding one dispute at once
  produce one decision and one bank request; Refund pressed twice reaches the bank once (`money.test.js`). Ticket refunds subtract an
  earlier partial refund; the payout is created only by a normal end (`server/live/settle.js:21-25`) and waits while a ticket dispute is
  open (`server/ledger.js:20`).
- **The data export** holds the person's own data and no other account's email address (asker and mentor exports checked).
- **Deletion:** signed out at once; after the grace period the old email and password do not sign in and no reset link is sent; the
  booking, its receipt and the payout stay (pointing at "Deleted user"); the follow-up text is emptied (`account.test.js`).
- **Live sessions:** only a ticket holder or the mentor gets a room token; a participant gets no audio/video until allowed; outsiders
  cannot read the question panel, ask, vote or moderate; a participant cannot moderate or allow speakers; nobody sees who asked; the
  mentor's view has no email addresses; another account cannot cancel, dispute, sync, download (.ics) or re-send someone else's ticket.
  Single tickets and a series bought at the same moment never take more seats than there are (the session rows are locked, the series
  locks its sessions in id order).
- **CSRF:** twelve new kinds of write (inbox, support, email settings, disputes, account deletion, 2FA, tickets, questions, gifts,
  unsubscribe, profile items) are refused without `X-Requested-With: wisecall` and when the `Origin` is another site.
- **Server-rendered pages:** a live session title with `</script><script>…` is text on `/live/<slug>` and stays the real title inside
  the JSON-LD (`<` is written as `<`); the template fill is one pass with a function replacement (no `$&` surprises).
- **Content-Security-Policy:** only `/live/<slug>/room` (frame-src of the video provider) and the replay page (media-src or frame-src
  of the provider) relax it; `/`, `/ka/`, the session page, inbox, dashboard, profiles and the help centre keep the strict policy.
- **Sentry** messages lose emails, IBANs, card-like numbers and tokens; ids, `/u/<username>` and queries leave the route tag; nothing
  else is sent. **Plausible** gets the path without its query, the referrer without its query, no admin pages, and nothing under Do
  Not Track or Global Privacy Control (the IP goes only as `X-Forwarded-For`, which Plausible uses for its daily hash). **Daily** gets
  a first name or "Guest N", never an email (but see #7).
- **2FA flows:** without the password step the code step says "sign in again"; five wrong codes lock even the right one; a code in
  another script is refused, not an error; one account cannot act on another's 2FA.
- **Breached-password check:** only the first 5 characters of the SHA-1 leave the server, with a timeout; it fails open (a signup is
  not blocked when the service is down), which is the usual trade-off.
