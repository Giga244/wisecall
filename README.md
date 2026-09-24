# Wisecall

A paid advice marketplace for Georgia: seekers pay in lari (GEL) to ask a question, mentors answer it, the platform keeps a fee and pays mentors by bank transfer. Built in English and Georgian (EN/KA).

**Going live?** Read [DEPLOY.md](DEPLOY.md): bank account, database, environment variables, callback URL, email DNS, domain, and a launch checklist. Legal text needs a lawyer: see [LEGAL-REVIEW.md](LEGAL-REVIEW.md).

## What it does

- **Accounts**: signup, login, logout, hashed passwords (bcrypt), httpOnly session cookie, email verification (6-digit code, 15 minutes), forgot/reset password (single-use links, 1 hour).
- **Mentors are verified, step by step.** Every mentor needs a verified email, an ID + selfie check through a provider interface (Didit; a fake one for local development only), an automatic name match (Georgian ↔ Latin) across the ID, profile, license and payout account, a sample answer and a proof link. Regulated niches (Medicine, Law, Finance) also need a license number, a private supporting document and a video interview; Business needs a company ID or proof of role; other niches need a work email, a diploma or a portfolio. All rules live in `server/verification/rules.js`. Nobody is listed until every required step passed and an admin approved; each admin decision needs a reason, is written to an audit log and emailed to the mentor with what is still missing. ID images are never stored (only the provider's id, result, verified name, date of birth and country, encrypted); uploaded documents are encrypted, admin-only and deleted 90 days after a decision. A mentor is listed and bookable only when approved **and** payout details are saved, enforced on the server.
- **Ongoing checks.** A new mentor's first 5 answers are held for an admin (released after 24 hours if nobody flags them); buyers can report a mentor; low ratings, repeated reports and expiring licenses are flagged; an expired license takes a mentor off the site; an admin can suspend a mentor at once (open questions are refunded). Profiles show trust badges only for checks really passed.
- **Card payments in GEL through a Georgian bank** (Bank of Georgia or TBC Bank). One provider interface (`server/pay/`); a fake bank exists for local development only. See below.
- **Manual mentor payouts.** Mentors save their name and IBAN (encrypted at rest). Every answered question earns price minus the platform fee, payable 7 days after the answer. Admins see who to pay in **Payouts**, download a CSV, send the bank transfer, and click **Mark as paid**. Mentors see earnings and payout history on their dashboard.
- **Refunds**: automatic after 7 days without an answer, or by an admin. They go through the bank's refund API and stay "in progress" until the bank confirms. A refund after the mentor was paid becomes a debt deducted from their next payout.
- **Admin panel** (`/admin.html`, emails in `ADMIN_EMAILS`): mentor applications (per-step review), review queue (held answers, reports), video interviews, bookings and refunds, payouts.
- **Reviews and ratings**, search and sort on Browse experts, real "questions answered" counts.
- **Email** (Resend, swappable to Postmark): every message in English or Georgian, in each person's saved language. Retried once on temporary failures. Nothing is ever shown on screen instead of emailed in production.
- **Pages**: a home page with hero, field strip, how it works, labelled example answers, trust and verification sections, pricing, expert list, mentor pitch, FAQ and call to action; full expert profiles; a dashboard with tabs, a progress line and a countdown for every question; two-column sign up / log in; settings with tabs and an application progress bar; About, Contact (emails the admin), Terms, Privacy (EN/KA); branded 404 and 500 pages; one shared header and footer (contact email and social links appear only when set in the environment). Nothing on the site is invented: examples are labelled "Example", and there are no fake reviews, ratings or user counts.
- **Waiting list**: visitors can ask to be told when a mentor in their field joins; each gets one email (EN/KA) with an unsubscribe link, and admins can see and export the list.
- **SEO**: `robots.txt`, `sitemap.xml` (includes approved experts), canonical links, unique titles and descriptions, share image, per-expert titles, all built from `PUBLIC_URL`.
- **Security**: strict Content-Security-Policy, CSRF protection, rate limiting, input validation everywhere, secure cookies in production, fail-fast configuration check.
- **Two languages everywhere**: every string lives in `public/i18n/en.json` and `ka.json`.
- **No demo data.** The site launches with the real empty state.

## Run it

Requires Node 20+ and PostgreSQL.

```bash
npm install
```

Copy `.env.example` to `.env`, then set at least `DATABASE_URL`, `SESSION_SECRET` and `DATA_ENCRYPTION_KEY`.

```bash
npm start
```

That applies database migrations automatically and serves http://localhost:4242. Locally the payment provider is `mock`: asking a question sends you to a fake bank page with Pay and Cancel buttons, so you can try the whole flow with no bank. Run the tests with:

```bash
npm test
```

They use `TEST_DATABASE_URL`, a separate database that is **wiped on every run**, and a simulator of both banks' APIs.

Sign up, open **Settings** to apply as a mentor, approve yourself at **/admin.html** with an account whose email is in `ADMIN_EMAILS`, then add payout details in Settings so you appear in Browse experts.

## How payments work

1. The buyer is sent to the bank's secure payment page (in GEL). Nothing reaches the mentor yet.
2. A booking becomes **paid only when the server asks the bank for the payment status** and the bank reports it completed for the right amount and currency. A bank callback (BOG's is RSA-signed and verified; TBC's is unsigned, so it is never trusted) or the buyer's return to the site only triggers that check. Everything is idempotent, so replays and duplicates change nothing.
3. Failed, cancelled and abandoned payments close the booking. A background job re-checks pending payments in case a callback is missed.
4. The mentor has `ANSWER_DEADLINE_DAYS` (7) to answer, with a reminder 48 hours before. If nobody answers, the buyer is refunded in full automatically.
5. When the mentor answers, their share (price minus `PLATFORM_FEE_PERCENT`) is recorded in the payout ledger and becomes payable `PAYOUT_HOLD_DAYS` (7) days later.
6. Refunds are requested from the bank and confirmed later; a rejected refund is recorded, shown to the admin, and retried.

The default fee is 20%. The bank charges its own card fee, so very low percentages lose money.

To add another bank, write a module with `createPayment`, `verifyCallback`, `getPaymentStatus` and `refund` in `server/pay/` and register it in `server/pay/index.js`. Booking code never talks to a bank directly.

## Security notes

- Production (`NODE_ENV=production`) refuses to start without a strong `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, an https `PUBLIC_URL` that is not localhost, email credentials, `EMAIL_FROM`, `ADMIN_EMAILS`, a real `PAYMENT_PROVIDER` (`bog` or `tbc`) with its keys, and `KYC_PROVIDER=didit` with its keys. It never shows codes or reset links on screen and does not contain the fake bank.
- Content-Security-Policy allows scripts only from the site's own files (no inline scripts). If you add a third-party script, update `server/security.js`.
- CSRF: every state-changing `/api` request needs the `X-Requested-With: wisecall` header (added by `public/js/api.js`) and a same-host Origin, on top of the SameSite cookie. The bank callback is exempt and verified separately.
- Mentors' IBANs are encrypted (AES-256-GCM) and readable only by the mentor and admins. CSV exports neutralise spreadsheet formulas.
- Rate limits are in memory per IP (they reset on restart, so run one instance). Behind a proxy such as Render, production trusts one proxy hop.
- Public API responses use a whitelist (no emails, payout details or proof links).
- If a secret was ever pasted into a chat, rotate it before going live.

## Project layout

```
server/           Express API: auth, users, experts, bookings, admin, payments, payouts, email, jobs
server/pay/       bank integrations behind one interface (bog.js, tbc.js, mock.js)
server/kyc/       ID-check providers behind one interface (didit.js, mock.js)
server/verification/  mentor verification: rules.js (all the rules), steps, review, credentials, interviews, monitoring, badges
server/mail/      email templates (EN/KA)
public/           Frontend: plain HTML/CSS/JS, no build step (css/style.css shared, css/home.css home page, css/app.css inner pages)
public/i18n/      en.json / ka.json dictionaries (all user-facing text)
migrations/       SQL schema migrations (applied in filename order, each once)
scripts/          migrate.js
tests/            end-to-end tests (npm test), including a fake BOG/TBC bank
DEPLOY.md         step-by-step launch guide      render.yaml   optional Render blueprint
```

## Configuration

Every setting is an environment variable, fully explained in `.env.example`. The main ones:

| Key | Meaning |
|---|---|
| `PUBLIC_URL` | Public address of the site (https, not localhost in production) |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Signs login sessions (24+ random characters) |
| `DATA_ENCRYPTION_KEY` | Encrypts mentors' IBANs (32+ random characters) |
| `PAYMENT_PROVIDER` | `bog` or `tbc` in production (`mock` locally only) |
| `BOG_CLIENT_ID` / `BOG_CLIENT_SECRET`, `TBC_API_KEY` / `TBC_CLIENT_ID` / `TBC_CLIENT_SECRET` | Bank credentials |
| `KYC_PROVIDER` (`didit`), `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET` | ID + selfie check for mentors (`mock` locally only) |
| `PLATFORM_FEE_PERCENT` | Wisecall's cut of each paid question (default 20) |
| `ANSWER_DEADLINE_DAYS` / `PAYOUT_HOLD_DAYS` | Answer deadline before an automatic refund; days until earnings are payable (both default 7) |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL` | Email delivery and the contact-form inbox |
| `ADMIN_EMAILS` | Comma-separated emails allowed to use `/admin.html` |
