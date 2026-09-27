# Wisecall operations runbook

For whoever runs wisecallge.ge day to day. It describes the app as it is at commit `2b99ada`. Setup and first deploy are in `DEPLOY.md`;
this file is about **running** it. Code changes that would make these tasks easier are listed in `docs/TODO-FROM-CLOUD.md`.

**Where things are**
- Admin panel: `https://wisecallge.ge/admin.html`. Your account's email must be in `ADMIN_EMAILS` and verified, and you pass two-step
  verification (an authenticator app) every `ADMIN_2FA_SESSION_HOURS` (12 h).
- Hosting: Render — web service `wisecall` (one instance, region Frankfurt) and PostgreSQL `wisecall-db` (see `render.yaml`).
- Logs: Render → `wisecall` → **Logs**. Every line starts with a tag: `[req]`, `[payments]`, `[jobs]`, `[kyc]`, `[email]`, `[admin]`,
  `[error]`, `[ledger]`, `[WARNING]`.
- Health: `GET /healthz` → `{"ok":true}` (checks the database too). Render uses it as the health check.
- Background jobs run inside the web process every `SWEEP_INTERVAL_SECONDS` (600 s): automatic refunds, reminders, refund retries and
  confirmations, missed-payment checks, deleting unpaid attempts and old documents, releasing held answers, licence checks, waiting-list
  emails, ratings, verification housekeeping. If the web service is down, **none of these run**.
- Secrets live only in Render → Environment and in the team password manager. Never in git, chat or email.

---

## 1. Daily routine (15–30 minutes)

Do it at the same time every day, in this order (most urgent first).

1. **Is the site up?** Open `https://wisecallge.ge/healthz`. Glance at Render → Metrics (errors, restarts, memory).
2. **Logs since yesterday.** Search the logs for `[error]`, `rejected callback`, `amount mismatch`, `refund`, `owed back`,
   `sweep failed`, `failed:`. Each is explained in section 9.
3. **Bookings and refunds** tab: filter **Refund in progress** (`refund_pending`). Anything older than 2 days, or with an error shown,
   needs action (section 4). Filter **Paid**: a booking close to its deadline is normal; nothing to do.
4. **Review queue**: held answers of new mentors (release, hold or reject — decide within 24 h, otherwise they are released
   automatically), then open **reports** (dismiss or uphold, always with a note).
5. **Mentor applications** → queue "Needs a person": review the oldest/riskiest first (section 2). Target: a decision within
   [2 working days].
6. **Reviews** tab: reported reviews.
7. **Support inbox** (`SUPPORT_EMAIL` and the admin inboxes that receive the contact form): answer everything within 1 working day.
8. **Payouts** — on payout day only ([e.g. every Monday]): section 5.

Weekly: check that yesterday's backup exists (section 7); read Render's email notices; look at the AI cost line in the admin panel
(`/api/admin/verification/costs`).

---

## 2. Reviewing a mentor application

Open **Mentor applications** → a mentor → **Review application**. The page shows every required step, the evidence, the automatic
analysis (risk, AI summary, link checks, account signals), flags and the full audit log.

1. **Identity.** Email: automatic. ID check: comes only from Didit's signed webhook — you cannot pass it by hand. If Didit says
   "in review", wait for it, or press **Refresh from provider** after Didit decides. Age 18+ and name match are decided automatically
   when clear; otherwise you decide them. **A failed age step is final: never approve anyone under 18.**
2. **Name mismatch.** Compare the name on the ID (shown to admins only) with the profile name, the licence holder and the payout
   account holder. Accept only obvious variants (Latin ↔ Georgian spelling, a middle name). Otherwise fail the step with a reason
   (the mentor is told what to fix).
3. **Experience.** Read the story and the sample answer yourself. Open every evidence link. A page that shows the mentor's name or
   brand and matches the story is good evidence. Warning signs: a brand-new domain, URL shorteners, a link that redirects elsewhere,
   the same link or text on another account (listed under "account signals"), text that tries to instruct the reviewer
   ("prompt injection" flag). The AI summary is advice only.
4. **Regulated fields** (medicine, law, finance…): check the licence number yourself in the official register shown on the page, and
   that it is valid. Download the document if one was uploaded (each download is logged; do not save it to your computer).
5. **Video interview** only if something is unclear: add slots in **Video interviews**, send the meeting link when the mentor books,
   record the result.
6. **Decide.** **Approve** is possible only when every required step passed. **Reject** always needs a reason the mentor will read:
   be specific and kind ("The link you gave does not show your name; add a page that does"). The mentor can apply again.

After approval the mentor becomes visible only after saving payout details.

**Removing a mentor.** Failing a required step of a listed mentor delists them at once. **Suspend now** hides them immediately, refunds
every open question, holds their payouts and emails the reason. **Reinstate** puts them back to review (or re-approves in one click
when every step is still valid).

> Known gap (docs/AUDIT.md #8): if the **system** (not an admin) fails a step of a listed mentor — e.g. a new ID result says under 18 —
> the mentor stays listed. If you ever see a listed mentor with a red step, fail that step yourself or suspend them.

---

## 3. Handling a dispute

There is no dispute feature yet (another branch is building one). Until then a "dispute" is: a buyer's report on an answer, an email
to support, or a card chargeback.

**A buyer is unhappy with an answer**
1. Find the booking: **Bookings and refunds** (filter by status; the list shows both people's names and emails, newest first — there is
   no search box yet). Read the question and the answer.
2. Check it against the Refund Policy (`docs/legal/en/refund-policy.md` §2): empty or meaningless, off-topic, abusive, copied, or asking
   to pay outside Wisecall, and reported within 7 days of the answer.
3. Write to the mentor (from the support address) for their side if it is not obvious. Give them [2 working days].
4. Decide and write it down: reply to the buyer and the mentor with the decision and the reason. If you refund, do section 4. If the
   mentor broke the rules, uphold the report (with a note) — two upheld reports, a pattern, or anything unsafe → **Suspend**.
5. Never share one party's email address or personal data with the other.

**A card chargeback (the bank tells you a buyer disputed a payment)**
1. Find the booking by the bank's order id (the booking's `provider_order_id`) or by the amount and date.
2. Send the bank what it asks for, before its deadline: the question, the answer and its date, the payment record, the Terms and the
   Refund Policy in force at that time.
3. If the chargeback succeeds, the money has left your account: record it with an admin **Refund in full** only if the bank says the
   money was **not** already returned (otherwise the buyer is refunded twice) — ask the bank. [DEV: there is no "chargeback" status yet;
   see docs/TODO-FROM-CLOUD.md.]

---

## 4. Issuing a manual refund

1. **Bookings and refunds** → find the booking → **Refund in full** (always the whole price; there are no partial refunds in Wisecall).
2. Status becomes **Refund in progress**. The bank confirms later; the sweep checks every run and the buyer is emailed when it is
   done (status **Refunded**).
3. If the mentor was already paid for that answer, the panel warns you first; the amount becomes a debt deducted from their next payout.
4. **"Refund failed" / an error on the booking**: the bank refused or did not answer. The sweep retries automatically each run. If it
   still fails after a day:
   - Look up the order in the bank's merchant portal. **If the bank already shows it refunded**, the app does not notice by itself
     (docs/AUDIT.md #5): tell the developer — the fix is to clear `refund_error` on that booking so the confirmation check picks it up.
   - If the bank refuses (card closed, too old), refund the buyer by bank transfer after asking for their IBAN, and record what you
     did in the support thread. [DEV: no "refunded outside the bank" status exists yet.]
5. **Never** refund the same payment twice from the bank's portal *and* from Wisecall.

---

## 5. Paying mentors (payout day)

1. **Payouts** tab. Each mentor shows payable now, on hold, owed back, and their payout name + IBAN.
2. Mentors with a **name-mismatch** flag or who are **suspended** are excluded from the CSV and cannot be marked paid: resolve the flag
   first.
3. **Download transfers to make (CSV)** and make the transfers from the business account (the CSV is safe to open in Excel; keep it off
   shared drives — it contains IBANs).
4. For each transfer: type the bank's reference and press **Mark as paid**. If the amount changed since you opened the page, it refuses —
   reload and check.
5. Keep enough money in the account to cover refunds and upcoming payouts: buyers' money that is not yet paid out is not yours.

---

## 6. Deploying and rolling back (Render)

**Deploy.** Render deploys automatically from `main` (the other branches never deploy). Before merging to `main`:
1. `npm test` is green (and `node --test --test-concurrency=1 tests/cloud/*.test.js`).
2. If the change adds a file in `migrations/`: **take a manual backup first** (section 7). Migrations run automatically at start, each
   file once, inside a transaction; a failing migration stops the server from starting (the old instance keeps serving until the new
   one is healthy).
3. After the deploy: open `/healthz`, the home page, sign in, open the admin panel, and read the startup lines in the logs
   (`Payments: …`, `ID check: …`, `Launch mode: …`, any `[WARNING]`).

**Roll back.** Render → `wisecall` → **Events** → a previous successful deploy → **Rollback**. This redeploys old code but **does not
undo database migrations**. Migrations only add things, so old code usually still works. If a migration must really be undone, there
are hand-written down files in `migrations/down/` — run them only with a fresh backup and with the developer. Alternatively `git revert`
the bad commit on `main` and let it deploy.

**Environment variable change** = a restart. After changing one, check the startup lines. The server refuses to start (and says why) if a
required value is missing or unsafe; the previous instance keeps running.

---

## 7. Backup and restore (PostgreSQL)

- **Automatic:** Render paid PostgreSQL plans keep daily backups (Render → `wisecall-db` → **Backups**; check your plan's retention).
  Test a restore once a quarter.
- **Manual, before every migration and weekly** (needs the PostgreSQL client tools; `PG_BIN` can name their folder):
  ```bash
  npm run backup -- "$EXTERNAL_DATABASE_URL"      # -> backups/wisecall-<date-time>.dump (pg_dump custom format; backups/ is git-ignored)
  ```
  (the same as `pg_dump "$EXTERNAL_DATABASE_URL" --format=custom --no-owner --file=wisecall-$(date +%F).dump`).
- **Check that a backup really restores** (monthly, and after changing plans):
  ```bash
  BACKUP_SOURCE_URL="$EXTERNAL_DATABASE_URL" npm run backup:check -- backups/wisecall-<date-time>.dump
  ```
  It restores the file into a new, empty scratch database on the same server, compares the row counts of the main tables (users,
  bookings, payouts, payout batches, receipts, ratings, verification, inbox, waiting list) with the source, prints `ok`/`DIFF` per
  table and drops the scratch database. The source is only read. Counts can differ if people used the site after the backup was made;
  run it right after the backup for a clean comparison. The database user needs permission to create databases (on Render, run it
  against a local PostgreSQL instead: restore there with `BACKUP_SOURCE_URL` pointing at the local copy you restored).
  Tested on 2026-09-28 against the local test database: every table matched (`The backup restores completely.`).
  Store the file encrypted (it contains personal data), outside Render, and delete copies older than [90 days].
- **Restore** into a new database first, never straight over production:
  ```bash
  createdb wisecall_restore   # or a new Render database
  pg_restore --no-owner --dbname "$TARGET_DATABASE_URL" wisecall-2026-09-27.dump
  ```
  Check it (user count, latest bookings), then point `DATABASE_URL` at it (restart) or restore into production during a maintenance
  window.
- **`DATA_ENCRYPTION_KEY` must match the backup.** IBANs, licence numbers, verified names/dates of birth, documents and admin 2FA secrets
  in the backup can only be read with the key that was in use when they were written. Keep every key ever used in the password manager,
  labelled with dates.
- After a restore, bank payments made after the backup time are not in the database: reconcile with the bank's merchant portal
  (order ids) before opening again.

---

## 8. Rotating secrets safely

### `SESSION_SECRET` (signs login sessions)
Effect of changing it: **everyone is signed out** (including admins, who must pass 2FA again), and Google sign-ins in progress fail
(10-minute window). Nothing is lost.
1. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Render → Environment → `SESSION_SECRET` → save (restart). Do it at a quiet hour.
3. Rotate it immediately if it may have leaked, and every [12 months] otherwise. (Until docs/AUDIT.md #3 is fixed, this is also the only
   way to force-sign-out a stolen session.)

### `DATA_ENCRYPTION_KEY` (encrypts IBANs, licence numbers, verified names/dates of birth, documents, admin 2FA secrets)
**Do not simply change it.** The app has one key and no key version: with a new key every stored encrypted value becomes unreadable
(`decrypt` returns empty) — payouts show no IBAN, documents cannot be opened, admins cannot pass 2FA, and name-match and account-signal
hashes stop matching old ones.
Until a rotation script exists (docs/TODO-FROM-CLOUD.md), rotate only if the key leaked, like this:
1. Take a backup (section 7). Keep the old key.
2. Put the site in maintenance (or at least a quiet hour).
3. With the developer, run a one-off script that reads each encrypted column with the old key and writes it with the new key:
   `users.payout_iban_enc`, `mentor_credentials.license_number_enc`, `kyc_sessions.verified_name_enc`, `kyc_sessions.birth_date_enc`,
   `verification_documents.data_enc`, `admin_two_factor.secret_enc`.
4. Set the new key in Render, restart, check a payout IBAN, a document download and an admin 2FA sign-in.
5. Admins may need `npm run admin:reset-2fa -- email` if their 2FA secret was not re-encrypted.

### Other keys (bank, Didit, Resend, Anthropic, Google)
Create the new key in the provider's dashboard, put it in Render, restart, check (`npm run check:launch` from a machine with the
production env, or the startup lines), then revoke the old key. For `DIDIT_WEBHOOK_SECRET`, change it in Didit and Render at the same
moment (webhooks signed with the old one are refused; press **Refresh from provider** on affected mentors afterwards).

### An admin lost their phone
Recovery code first. No codes left → someone with server access runs `npm run admin:reset-2fa -- their@email` (Render shell); they set up
2FA again at the next sign-in.

---

## 9. When an outside service is down

| Service | Symptoms | What the app does | What you do |
|---|---|---|---|
| **Email (Resend)** | `[email] … failed` in logs; users say codes never arrive | Codes and links are not shown on screen in production; every other action still works; each send is retried once | Check status.resend.com and the domain (SPF/DKIM). Tell affected users by another channel. If it lasts, switch `EMAIL_PROVIDER=postmark` with `POSTMARK_TOKEN` (restart). Sign-up codes expire in 15 min, so users press "resend" afterwards. |
| **Didit (ID check)** | Mentors stuck on "in review"/"started"; `[kyc] rejected webhook` or `refresh failed` | Nothing is approved without a Didit result; applications wait | Check Didit status. When it is back, open each waiting mentor and press **Refresh from provider**. If webhooks were refused, check `DIDIT_WEBHOOK_SECRET` and the webhook URL (`/api/kyc/webhook`) in Didit. |
| **Bank (BOG/TBC) — payments** | Buyers get "Could not start the payment" (`[payments] could not start`) | Booking is closed as expired; nobody is charged | Check the bank status/merchant support. If it lasts, switch `LAUNCH_MODE=prelaunch` (restart) so the site shows the waiting list instead of failing payments. |
| **Bank — callbacks/status** | Bookings stay "waiting for payment"; `status check failed` | The sweep asks the bank again every run; after `PAYMENT_TTL_MINUTES + 10` it closes the booking | After the outage, compare the bank's list of completed payments with Wisecall's paid bookings for that period. **A payment completed at the bank but closed as expired in Wisecall is a known gap (docs/AUDIT.md #4): refund it from the bank portal and tell the buyer.** |
| **Bank — refunds** | Refunds stay "in progress" with an error | Retried every sweep | Section 4, step 4. |
| **Anthropic (AI review)** | Analysis shows an AI error | Application goes to a person without the AI summary | Nothing urgent; press **Run the analysis again** later. |
| **Render / database** | `/healthz` returns 503 or nothing | Site down; background jobs stop | Render status page and dashboard. After recovery, the first sweep catches up (refunds due, reminders). Check `[jobs]` lines. |

**Personal data breach** (a leaked database dump, a stolen admin account, secrets exposed): contain it (rotate the secrets involved,
suspend compromised accounts), write down what happened and when, and inform the lawyer at once — the Personal Data Protection Service
may have to be notified within **72 hours** [LAWYER: confirm the 2024 Law's requirement], and the people affected in some cases.

---

## 10. Data requests (privacy)

There is no self-service export or delete yet (docs/TODO-FROM-CLOUD.md). Handle requests by hand, from the support address, within the
legal deadline [LAWYER: 10 working days?]:
- **Confirm identity**: reply only to the email address on the account.
- **Access/export**: the developer exports that user's rows (account, profile, bookings as asker and mentor, ratings, reports,
  verification steps and audit, payout records) as JSON.
- **Delete**: close the account; keep payment/payout/tax records for the legal period; delete or anonymise the rest. Mentor documents are
  deleted automatically 90 days after a decision.
- Keep a short log of each request (date, what was done).

---

## 11. Launch day: prelaunch → live

**Before (days ahead)**
- [ ] A lawyer approved the Terms, Privacy Policy, Mentor Agreement and Refund Policy (`docs/legal/`), and they are on the site.
- [ ] The 🔴 items of `docs/AUDIT.md` are fixed (#1 rate limits, #2 email-code attempts), and ideally #3–#8.
- [ ] Every address in `ADMIN_EMAILS` has signed up, verified its email and set up 2FA (docs/AUDIT.md #2), with recovery codes stored.
- [ ] Bank merchant contract signed; production keys in hand; sandbox test passed (`docs/BANK-GOLIVE.md`).
- [ ] Didit production keys, workflow (ID + liveness + face match) and webhook URL `https://wisecallge.ge/api/kyc/webhook` set up.
- [ ] Email domain verified (SPF, DKIM); `EMAIL_FROM` on that domain; a test email arrives in Gmail and not in spam.
- [ ] Render database on a paid plan with backups; a restore was tested; `DATA_ENCRYPTION_KEY` in the password manager.
- [ ] At least one mentor fully approved **and** with payout details (otherwise buyers see an empty Browse page).

**On the day**
1. Take a manual backup.
2. Render → Environment: set `PAYMENT_PROVIDER` (`bog` or `tbc`) and its keys; `KYC_PROVIDER=didit` with `DIDIT_API_KEY`,
   `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`. Leave `LAUNCH_MODE=prelaunch` for now. Save (restart).
3. Run `npm run check:launch` against production values (or read the startup lines): payments on, ID check on, no `[WARNING]` you
   did not expect.
4. Register the callback URL with the bank: `https://wisecallge.ge/api/payments/callback`.
5. Set `LAUNCH_MODE=live`. Save (restart). The server refuses to start in `live` without the bank and Didit keys — if it does not come
   up, read why in the logs; the old instance keeps running.
6. **Real smoke test with a real card and a small price** (e.g. a test mentor at 5 ₾): ask → pay → the booking turns **Paid** (the
   callback reached us) → the mentor gets the email → answer → the buyer gets the email. Then refund one test booking from the admin
   panel and see it reach **Refunded**. Then take the test mentor off the site.
7. Watch the logs for the first hours: `[payments]`, `[error]`, `rejected callback`.
8. The waiting list is emailed automatically by the sweep (a few hundred per run) once the site is live and a matching mentor is listed.

**If something goes wrong:** set `LAUNCH_MODE=prelaunch` (restart). Bookings stop at once; paid questions stay and are answered or
refunded as normal.
