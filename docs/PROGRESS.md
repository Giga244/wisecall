# Progress on docs/CLAUDE-CODE-MASTER-PROMPT.md

## PART 0.2 — up to date
Pulled main with both cloud packs merged (prelaunch pack: AUDIT, TODO-FROM-CLOUD, legal drafts, RUNBOOK, BANK-GOLIVE, tests/cloud;
quality pack: QUALITY-AUDIT, TODO-QUALITY, help, seo, e2e-cloud). The local first-pass AUDIT.md was moved aside (see DECISIONS.md).

## PART 1 — a failed required step never shows as verified (AUDIT #8)
One rule ("no required step that no longer holds") now sits in `listableSql()` and in every user read through `getUserById`, so
`isListable()` and the SQL lists agree and even a hand-edited row is hidden at once. `steps.setStep` delists an approved mentor when any
actor fails a required step (status back to review, audit `delisted`, flag `required_step_failed`, email in EN/KA, admins told); the
carry-over and the regular sweep catch older cases. Age failure is final for that ID; admins have "Re-run ID check". Settings, the progress
bar and the steps share one state (`verificationState`); admin filter "Approved, but a step failed". Tests: tests/failed-steps.test.js
(8) and the cloud AUDIT #8 test (todo removed).

## PART 0.1 / Phase 3 — Inbox (messages + notifications)
/inbox.html with a header icon and unread badge (polled every 30 s; a dot on the phone menu button). One thread per paid booking with
the question, the answer, events and ONE free follow-up question + ONE reply (then closed; unique indexes enforce it); support
conversations (also from the contact form when signed in) answered from a new admin Support tab with internal notes, assignment and
close; read-only system messages (application decisions, payouts); a notification centre; Settings → Notifications for the optional
emails with signed unsubscribe links. Contact details / outside payments are refused in booking threads (EN+KA); reports go to admins.
Tests: tests/inbox.test.js (15), e2e/inbox.spec.js (4). Migration 021 (additive, undo script).

## PART 3 early — 🔴 #1 and #2
Rate-limit keys are the limiter plus the lower-cased path without trailing slashes (#1). Wrong email / work-email codes are counted per
account; after 5 the code is cleared (#2, migration 020). Their cloud tests no longer have { todo }.

## PART 0.1 / Phase 4 — safety, disputes, receipts, account tools
Emergency questions (EN+KA, first-person) get help (112, 116 006) instead of payment and are logged for admins; mentors can decline a
question (full refund, reason shown). "Report a problem with this answer" within 7 days holds the payout; admins decide full / partial
(proportional) / no refund in a Disputes tab. Numbered receipts (email + PDF, EN/KA, Noto Sans Georgian) and monthly statements (CSV/PDF).
Account tools: signed-in devices + sign out others (AUDIT #3), data export, deletion with a 14-day grace (records kept pseudonymised),
optional two-step verification for all, a breached-password check (HIBP k-anonymity) and 18+ at sign-up. Migrations 022–027.
Tests: safety, disputes, receipts, sessions, account, account-security (+ e2e safety). Unit 627, cloud 28 + 6 todo, e2e green.

## PART 0.1 / Phase 5 — polish: SEO, info pages, help centre, observability, backups, admin overview, emails, speed
Georgian addresses under /ka with their own head, hreflang and a bilingual sitemap; mentor profiles rendered on the server with
structured data; FAQ, "How we verify", a help centre (articles 02/03/05/10/12 rewritten; 07 waits for PART 5), footer legal line and
founder block. Plausible (server-side, no cookies) and Sentry (scrubbed, off without a DSN), a public /status page. `npm run backup` and
a tested restore check (`backup:check`), an admin Overview tab (sign-ups, applications by status and risk, waiting list, questions,
refunds, disputes, money), dark-mode friendly emails, and docs/KA-REVIEW.md (467 Georgian texts for a native speaker). Lighthouse on the
test data: every page 95-100 on mobile and desktop (Settings' layout shift fixed: 89 -> 96).
Tests: unit 656 (2 site-wide checks updated for the server-filled and error pages, then green), cloud 28 + 6 todo, e2e 144 passed / 5
skipped.

## PART 2 — "Your field"
Every mentor writes their field in their own words (3–60 characters, required for new applications) and picks the closest category or
"Other". Cards, profiles and field pages show the words; search (server and Browse) matches the words, specialty tags and category
names in EN/KA; "Other" is a Browse filter. Words or titles naming a licensed profession (EN + KA) keep the application regulated;
admins can edit a mentor's field and category and mark "not a licensed profession" (audited). Migration 028 (widens a limit, adds one
column; undo script). Tests: tests/your-field.test.js (8), fixtures updated, e2e niches/full-flow.
Tests: unit 664, cloud 28 + 6 todo, e2e 145 passed / 5 skipped.

## PART 3 — security fixes from the audits
Top 5 done (#1, #2, #3, #8 earlier; now #4 late bank payments, #5 lost refund answers). 🟠: #6 answer/refund race, #7 no answer after
the deadline, #9 Georgian file names, #10 new accounts start private; also #14, #17, #18. Bank B1/B2 (TBC, settings marked [CONFIRM WITH
BANK]), B6/B7 (BOG language, idempotency key). From FIX-PROMPT: per-account asking limits, payout details need the password (email +
72-hour hold on a change), bank internals hidden from buyers and mentors. Every { todo } in tests/cloud is gone and `npm test` runs them;
the cloud pack's four test.fixme browser tests pass. Left: 🟡 #11, #12 (see DECISIONS.md).
Tests: unit 672, cloud 34 (no todo left), e2e 145 passed / 5 skipped.

## PART 4 — Georgian texts
The earnings note (fixed before), informal შენ in every non-legal text, „კითხვის ავტორი“, „ანაზღაურება“ for mentors' money (Settings tab,
payout texts, help 05/07), no case endings hyphenated onto names, „MB“ everywhere, the review's KA-1..KA-5 rewrites, and Georgian month
names in every date (formatDate). tests/i18n.test.js checks keys and placeholders (site, admin, admin 2FA), the informal form, the agreed
words and the dates. docs/KA-REVIEW.md regenerated for the native speaker.
Also fixed: right after an ID check the page said "your name doesn't match" until the comparison ran a moment later (now "checking…",
refreshed until decided). Tests: unit 685, cloud 34, e2e 145 passed / 5 skipped.

## PART 5 — mentor balance and withdrawals
A Balance card (Dashboard → Earnings and Settings → Payouts): available, on hold (with the date each part frees up), requested, paid
out, owed back, and the history. "Withdraw" from 100 ₾ (PAYOUT_MIN_GEL), the whole available amount minus debts, with the password
(or a fresh sign-in), one open request (FOR UPDATE + a unique index), the amount always computed by the server. Admin → Payouts:
money overview ("Mentor money held in your account"), the queue with the full IBAN (logged), Mark as paid / Reject, CSV for a bulk
transfer and "Mark all exported as paid". Refunds during a request recompute or close it; emails and inbox messages EN+KA; payout
method behind server/payoutMethods ('manual'). FAQ, home and help 07 updated. Migration 031 (undo script). Tests: withdrawals.test.js
(6), e2e/withdrawals.spec.js (2).
