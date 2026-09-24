# Wisecall

A paid advice marketplace: seekers pay to ask a question, mentors answer it, the platform keeps a fee. Built in English and Georgian (EN/KA) for a Georgia-first launch.

**Going live?** Read [DEPLOY.md](DEPLOY.md). It walks through the database, environment variables, Stripe, email DNS, and your domain step by step. Legal text needs a lawyer: see [LEGAL-REVIEW.md](LEGAL-REVIEW.md).

## What it does

- **Accounts**: signup, login, logout, hashed passwords (bcrypt), httpOnly session cookie, email verification (6-digit code, 15 minutes), forgot/reset password (single-use links, 1 hour).
- **Mentors are checked by a person.** Applying needs a verified email, a proof link (LinkedIn preferred) and a sample answer. The application waits as `pending` until an admin approves it at `/admin.html` with a checklist. Rejections need a reason and the mentor is emailed either way. Only approved mentors who finished payout setup are listed or bookable, enforced on the server.
- **Payments** (Stripe Checkout + Connect): the buyer pays the platform, the money is held until the mentor answers, then the mentor's share is transferred. If nobody answers within `ANSWER_DEADLINE_DAYS` (7) the buyer is refunded automatically, and the mentor gets a reminder 48 hours before. A booking is only ever marked paid by a signature-verified webhook (or the server asking Stripe itself). Details below.
- **Admin panel** (`/admin.html`, emails in `ADMIN_EMAILS`): mentor applications with proof link and sample answer, and a Bookings and refunds tab to refund any booking in full.
- **Reviews and ratings**, search and sort on Browse experts, real "questions answered" counts.
- **Email** (Resend, swappable to Postmark): branded English/Georgian templates sent in each person's saved language.
- **Pages**: About, Contact (emails the owner), Terms, Privacy (EN/KA), branded 404 and 500 pages, mobile menu, footer on every page.
- **SEO**: `robots.txt`, `sitemap.xml` (includes approved experts), canonical links, unique titles and descriptions, share image, per-expert titles.
- **Security**: strict Content-Security-Policy, CSRF protection, rate limiting on login, signup, verification, reset and contact, input validation everywhere, secure cookies in production, fail-fast configuration check.
- **Two languages everywhere**: switch EN/KA anywhere; every string lives in `public/i18n/en.json` and `ka.json`.

## Run it

Requires Node 20+ and PostgreSQL.

```bash
npm install
```

Copy `.env.example` to `.env`, then set at least `DATABASE_URL` and `JWT_SECRET`.

```bash
npm start
```

That applies database migrations automatically and serves http://localhost:4242. The site starts empty. Run the tests with:

```bash
npm test
```

They use `TEST_DATABASE_URL`, a separate database that is **wiped on every run**.

Sign up, open **Settings** to apply as a mentor, and approve yourself at **/admin.html** using an account whose email is listed in `ADMIN_EMAILS`.

With no Stripe keys, payments are simulated (a booking is marked paid instantly), which is fine for local testing. Production refuses to start that way unless you set `ALLOW_SIMULATED_PAYMENTS=true` on purpose. To test the real Stripe flow with test cards and the Stripe CLI, see [DEPLOY.md](DEPLOY.md#2-test-payments-with-stripe-test-mode).

## How payments work

1. The buyer pays the platform through Stripe Checkout. Nothing reaches the mentor yet.
2. Only a signature-verified Stripe webhook (or the server's own lookup of the Checkout Session with Stripe) marks the booking paid. The redirect back to the site never does.
3. The mentor has `ANSWER_DEADLINE_DAYS` to answer. When they do, their share (100% minus `PLATFORM_FEE_PERCENT`) is transferred to their Stripe account and Wisecall keeps the fee.
4. If nobody answers in time the buyer is refunded in full automatically. Admins can also refund from the admin panel. Refunding an answered booking reverses the mentor's transfer first.
5. Abandoned checkouts expire after 30 minutes. A failed payout is recorded and retried by the background job. Missed webhooks are caught by the same job asking Stripe directly.
6. Card disputes and refunds made in the Stripe Dashboard are picked up by webhook, and admins are emailed about disputes.

The default fee is 20%. Stripe also charges its own processing fee, so very low percentages lose money.

`npm test` covers all of this against a fake Stripe server (with real webhook signatures).

**Georgia caveat:** Stripe's list of supported countries changes. Check https://stripe.com/global to confirm that mentors in Georgia can be paid as connected accounts before you launch. If not, all payment logic is in `server/payments.js`, `server/stripeClient.js`, `server/routes/bookings.js`, `server/routes/connect.js` and `server/routes/webhook.js`.

## Security notes

- Production (`NODE_ENV=production`) refuses to start without a strong `JWT_SECRET`, an https `APP_URL`, email credentials, `ADMIN_EMAILS`, and Stripe keys plus webhook secret. It never shows codes or reset links on screen, and rejects unsigned webhooks.
- Content-Security-Policy allows scripts only from the site's own files (no inline scripts). If you add a third-party script, update `server/security.js`.
- CSRF: every state-changing `/api` request needs the `X-Requested-With: wisecall` header (added by `public/js/api.js`) and a same-host Origin, on top of the SameSite cookie.
- Rate limits are in memory per IP (they reset on restart, so run one instance). Behind a proxy such as Render, production trusts one proxy hop so the real client IP is used.
- Public API responses use a whitelist (no emails, Stripe ids or proof links).
- Login, signup and redirects are hardened (constant-time-ish login, same-site redirects only).
- If a secret was ever pasted into a chat, rotate it before going live.

## Before you publish

- Have a lawyer review the Terms and Privacy pages ([LEGAL-REVIEW.md](LEGAL-REVIEW.md)) and a native speaker review the Georgian text, especially anything about money.
- Verify an email domain with Resend so mail reaches everyone.
- Set up backups and try a restore once ([DEPLOY.md](DEPLOY.md#11-backups)).

## Project layout

```
server/           Express API: auth, users, experts, bookings, admin, Stripe, email, jobs
server/mail/      email templates (EN/KA)
public/           Frontend: plain HTML/CSS/JS, no build step
public/i18n/      en.json / ka.json dictionaries (all user-facing text)
migrations/       SQL schema migrations (applied in filename order, each once)
scripts/          migrate.js
tests/            end-to-end tests (npm test)
DEPLOY.md         step-by-step launch guide      render.yaml   optional Render blueprint
```

## Configuration

Every setting is an environment variable, explained in `.env.example`. The important ones:

| Key | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs login sessions (24+ random characters) |
| `APP_URL` | Public address, used in emailed links and Stripe redirects |
| `PLATFORM_FEE_PERCENT` | Wisecall's cut of each paid question (default 20) |
| `ANSWER_DEADLINE_DAYS` | Days a mentor has to answer before an automatic refund (default 7) |
| `CURRENCY` | Currency for charges (default `usd`) |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | Real payments. The webhook secret can list several, comma-separated |
| `EMAIL_PROVIDER`, `RESEND_API_KEY` / `POSTMARK_TOKEN`, `EMAIL_FROM`, `SUPPORT_EMAIL` | Email delivery and the contact-form inbox |
| `ADMIN_EMAILS` | Comma-separated emails allowed to use `/admin.html` |
