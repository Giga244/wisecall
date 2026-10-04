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
Tests: unit 691, cloud 34, e2e 143 passed / 5 skipped + 2 fixed and rerun (an ambiguous locator in the old payout test; the known
flaky dev-setup recovery-code test passed on rerun).

## PART 6 — XSS check
Every place people's text is shown was reviewed (page scripts, server-rendered pages, JSON-LD, meta tags, emails, CSV, PDFs, admin)
and is escaped or set as text; links only http(s); CSP unchanged (no inline scripts). e2e/xss.spec.js stores both payloads in every
text field (names, profile, application, question, answer, review, note, reply, follow-up, support, report, dispute, contact form) and
opens every page and admin tab: nothing runs, nothing is injected, the text shows as text. Nothing needed fixing.
docs/SECURITY-XSS.md lists where and how.

## PART 6B — quality pack
Already done earlier and only checked here: profiles rendered on the server (Phase 5), Georgian addresses, hreflang, canonical,
dynamic bilingual sitemap and JSON-LD (Phase 5), the informal Georgian, „ანაზღაურება“ and names without hyphenated endings (PART 4),
network errors vs "not found", "your rating is visible", "in review" instead of "continue", readable admin AI errors, Terms on review
names, the password field size (Phase 5 UX fixes), the four test.fixme browser tests (PART 3), help articles published and linked from
the footer and FAQ (Phase 5; 07 in PART 5). New here: the cloud pack's journey test follows the form changes, and `npm run test:e2e` now
runs tests/e2e-cloud too (30 passed: journey and known issues, desktop and phone).

Parts 1–6B all green together: unit 691, cloud 34, e2e 152 passed / 5 skipped (plus tests/e2e-cloud 30 passed).

## PART 7A — public answers
After a 4–5★ rating the asker can offer the answer for the public library (question cleaned of names and contact details, editable,
1,000 characters max); the mentor agrees and may edit (Settings: always / ask each time / never); an admin approves (regulated fields only
with explicit permission); either can withdraw (410 at once). /answers (search, field, newest / most helpful) and /answers/<slug> (QAPage
JSON-LD, mentor card with "Ask", 3 related, Helpful once per visitor), both languages, sitemap; "Public answers" on mentor profiles; the
home page shows real answers once there are three. Migration 032 (undo script). Tests: public-answers.test.js (9), e2e public-answers (3).

## PART 7B — "Find me a mentor"
/find-a-mentor.html (field in your own words, closest category, need 20–500, language, optional budget, "show anonymously"; a hidden
honeypot, 5 per hour per IP). Browse offers it when a search finds nobody (with the words filled in) and under the list. Visitors confirm
by email; one active request per email and field; ONE email when a matching mentor is listed, with a remove link; 60 days. Public board
/requests from 5 requests; admin tab "Mentor requests" (by field and week, fields with no mentor + copyable outreach text, every request,
CSV, merge two spellings). Privacy drafts, help article 15 (EN+KA), LEGAL-REVIEW 51–52. Migration 033 (undo script).
Tests: mentor-requests.test.js (6), e2e mentor-requests (2).

## PART 8.1 — Turnstile
Sign-up, login, forgot password, contact, the waiting list and "find me a mentor" need a Turnstile token when TURNSTILE_SITE_KEY and
TURNSTILE_SECRET_KEY are set (off without them: development and tests). Server-side check (server/turnstile.js), 400 for a refused token,
503 when Cloudflare is unreachable; CSP allows Cloudflare only when on; widget loads on first use of a form (public/js/turnstile.js), EN+KA
errors. Tests: turnstile.test.js (5, fake Cloudflare); a live check with Cloudflare's test keys passed.

## PART 8.2 — login lockout
10 wrong passwords for one email in 15 minutes → that email waits 5 minutes (429 account_locked + Retry-After; the login page says how
long), the owner gets one email ("someone is trying to sign in", EN/KA) per lock; unknown emails behave the same; a password reset clears
it; old rows purged daily. Migration 034 (undo script). Settings LOGIN_LOCK_* and the Turnstile/withdrawal settings added to .env.example.
Tests: login-lockout.test.js (4).

## PART 8.3 — dependency scanning
.github/dependabot.yml (npm and GitHub Actions, weekly) and .github/workflows/ci.yml: on every push and pull request, `npm audit
--audit-level=high`, the unit + cloud tests and the browser tests against a throwaway Postgres 16 (fake bank, fake ID check, mail log, no
real keys), and gitleaks over the whole history. `npm audit --audit-level=high` today: 0 vulnerabilities, nothing to fix. The workflow has
not run on GitHub yet (nothing is pushed); the first push will show whether the browser tests need any Linux-specific adjustment.

## PART 8.4 — secrets in git history
gitleaks could not run on this computer: there is no Docker, and the npm package called "gitleaks" is an unrelated third-party package
(not the real tool), so it was not used. Instead scripts/secret-scan.js (`npm run check:secrets`) scanned all 128 commits (72,736 added
lines) with the main gitleaks rules (cloud keys, private keys, Anthropic/OpenAI/Resend/Google/GitHub/Slack/Stripe/Cloudflare/Sentry,
JWTs, database URLs with passwords, generic secret assignments): **nothing found**. Two first hits were false positives (a translation key
name, and the fake webhook secret of the test ID-check server); the script now skips those kinds. No key needs rotating, so nothing was
added to docs/QUESTIONS.md; history was not rewritten. The real gitleaks runs in CI on every push.

## PART 8.5 — trimmed API responses
Bookings sent to askers and mentors no longer carry reminderSentAt, answerFlaggedAt, answerHeldUntil, partialRefundStartedAt,
refundRequestedAt or answerReview, and a mentor no longer gets the asker's account id. The export includes public answers and mentor
requests. Tests: api-trim.test.js (7): one per route (answering, one question, dashboard, inbox list/conversation/notifications, dispute,
receipts + statements, export, admin overview + support inbox), checking for internal fields, IBANs, other people's emails and ids.

**PART 7 and PART 8 test runs.** After PART 7: unit 710/710 (after a fix to the email-template test's sample), cloud 34/34, browser
154 passed / 5 skipped (one navigation abort in e2e/dev-setup on that run; the spec passes 6/6 when re-run), browser-cloud 30/30.
After PART 8: unit 726/726, cloud 34/34, browser 157 passed / 5 skipped, browser-cloud 30/30.

## PART 9.1 — UTM tracking
server/attribution.js: on the first page view with utm_source/medium/campaign/content or from another site, a first-party cookie
`wc_src` (30 days, HttpOnly, cleaned values and the referrer's domain only; none under DNT/GPC; ATTRIBUTION_COOKIE=off disables it).
Saved on sign-up (email and Google), on every question and on a mentor application (migration 035, undo script); Admin → Overview
"Where people come from" shows sign-ups, mentor applications and first paid questions per source and campaign (EN+KA). Privacy Policy and
Cookie Notice drafts updated (also for Turnstile, login lockout and the Helpful id); LEGAL-REVIEW 53–54. Tests: attribution.test.js (5).

## PART 9.2 — Copy link
public/js/copy-link.js (Clipboard API with the older fallback; the button says "Copied!" for two seconds, announced to screen readers):
on a mentor's profile (the address without its ?query), on a public answer (next to Helpful), and on the mentor's dashboard a new "Your
profile link" card (only for a listed mentor), EN+KA. There was no share card yet; this card is it. Tests: e2e/ux-extras.spec.js (2,
reading the clipboard).

## PART 9.3 — confirmation dialog
All 12 window.confirm() calls (admin: suspend, reject an answer, hide a review, refunds, payouts, withdrawals; dashboard: decline; public
answer: take down; settings: sign out other devices, delete account, edit application) now use public/js/dialog.js: a native <dialog>
with showModal(), Tab kept inside, Esc / Cancel / a click outside = no, focus back to the button that opened it, Cancel focused first,
and an action button that says what happens ("Refund 25.00 ₾", "Decline and refund …", "Delete my account"), red when it cannot be
undone (own colour in the dark theme). No alert() existed. Hiding a review now checks the reason before asking. Tests: the dialog in
e2e/ux-extras.spec.js; the specs that used to accept browser pop-ups press the dialog's button (e2e/support.js confirm()).

## PART 9.4 — Back to top
public/js/back-to-top.js on the home page, help, FAQ, Terms and Privacy: appears after 1.5 screens, scrolls up smoothly (at once with
reduced motion), moves the keyboard focus to the top, rises above the footer's language switch, icon-only on phones (the label stays for
screen readers), EN+KA. Checked in a browser: desktop, phone, Georgian dark theme, reduced motion.

## PART 9.5 — print stylesheet
One @media print block in style.css: no header, footer, menus, buttons, dialogs or "back to top"; black text on white; full width; links
in the content show their address; headings kept with their text. Receipts and statements are PDFs already. Checked by rendering Terms,
a help article and the FAQ as print in a browser.

## PART 9.6 — reading progress
public/js/reading-progress.js on help article pages only (and any future `article.blog-article`): a 4px bar at the top showing how far
through the article the reader is; not on the help list; hidden from screen readers; no animation with reduced motion. Checked in a
browser (0 at the top, half at the middle of the article, full at its end).
