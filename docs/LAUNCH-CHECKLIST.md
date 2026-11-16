# Launch checklist — everything needed to go live, in order

Wisecall launches with **paid questions only** (docs/LAUNCH-PLAN.md): live sessions stay in the code, switched off (`LIVE_SESSIONS=off`),
until the site has good reviews. The provider is **Flitt** (docs/BANK-GOLIVE.md §0). Every secret goes into **Render → Environment**,
never into git, chat or email. `npm run check:launch` (Render → Shell) checks the settings below and says what is missing.

Legend: **required** (the server refuses to start in production without it, or the step blocks the launch) · *recommended* · optional.

---

## A. Weeks before — only you can do these

1. **Business** registered (individual entrepreneur or LLC at the Public Service Hall; ask an accountant which). You get the name,
   identification number and legal address for `LEGAL_NAME`, `LEGAL_ID`, `LEGAL_ADDRESS` (printed on receipts, shown in the footer).
2. **Flitt** contract signed (business category allows paid consultations). From the Flitt portal: merchant id, payment secret key,
   payout (credit) secret key. Ask Flitt: the fee per IBAN withdrawal, that IBAN withdrawal is enabled, and the [VERIFY] points in
   docs/BANK-GOLIVE.md §0.
3. **Didit** account (ID checks for mentors): API key, a workflow (ID + liveness + face match), webhook secret, webhook URL
   `https://wisecall.ge/api/kyc/webhook`.
4. **Email** domain verified at Resend (SPF, DKIM: DEPLOY.md §9); a new API key; a test email reaches Gmail, not spam.
5. **Cloudflare Turnstile** (the "are you a person?" check on sign-up, login and forms): site key and secret key.
6. **Lawyer** reviewed `docs/legal/` and docs/LEGAL-REVIEW.md; the approved texts are on the site.
7. **Mentors**: at least 15 in 5+ fields signed up, ID-checked, approved and with payout details (Admin → Mentors).
8. Optional: Anthropic API key (AI summaries of mentor applications), Google sign-in (DEPLOY.md §2c), Plausible, Sentry.

## B. Render — the service and the database

1. Database on a paid plan with daily backups; one **restore tested** (`npm run backup` then `npm run backup:check -- <file>`, which
   compares every table).
2. Web service on **Standard** (Starter serves only about 100 visitors at once: docs/LAUNCH-REHEARSAL.md); health check `/healthz`;
   one instance (the rate limits and caches are per process: docs/TODO-REHEARSAL.md R-11).
3. Custom domain `wisecall.ge` with HTTPS (DEPLOY.md §10).

## C. Environment variables

### Always required (also in prelaunch)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PUBLIC_URL` | `https://wisecall.ge` (https, no trailing slash, never localhost) |
| `DATABASE_URL` | from the Render database (render.yaml fills it) |
| `SESSION_SECRET` | 32+ random characters (render.yaml generates it) |
| `DATA_ENCRYPTION_KEY` | 32+ random characters, different from the above; **copy it into your password manager** (IBANs, verified names and documents are unreadable without it) |
| `ADMIN_EMAILS` | the admins' addresses (comma-separated); each sets up two-step verification on first sign-in (`ADMIN_2FA` must stay unset: `off` is refused in production) |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | `resend`, the key, `Wisecall <hello@wisecall.ge>` |
| `SUPPORT_EMAIL` | `support@wisecall.ge` (public: footer, Terms, Reply-To) |
| `LAUNCH_MODE` | `prelaunch` until launch day, then `live` |
| `LIVE_SESSIONS` | `off` (the production default; render.yaml sets it) |

### Payments and payouts (required for `LAUNCH_MODE=live`)

| Variable | Value |
|---|---|
| `PAYMENT_PROVIDER` | `flitt` |
| `FLITT_MERCHANT_ID`, `FLITT_SECRET_KEY` | from the Flitt portal |
| `FLITT_PAYOUT_SECRET_KEY` | the payout key (needed with `PAYOUT_METHOD=flitt_iban`) |
| `PAYOUT_METHOD` | `flitt_iban` (an admin sends each payout with a 2FA code) or `manual` (transfers by hand) |
| `PAYOUT_DAILY_LIMIT_GEL` | `3000` (at most this much sent through Flitt per day) |
| `BANK_FEE_PERCENT` | `2` (Flitt's fee; for the admin's money overview) |
| `FLITT_CALLBACK_IPS` | leave unset (Flitt's two addresses); set it empty only if callbacks are refused because of the address |
| `PAYMENT_TTL_MINUTES` | `30` (default) |

### ID checks (required for `LAUNCH_MODE=live`)

| Variable | Value |
|---|---|
| `KYC_PROVIDER` | `didit` |
| `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET` | from Didit |

### Recommended

| Variable | Value |
|---|---|
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | from Cloudflare (without them: rate limits only) |
| `LEGAL_NAME`, `LEGAL_ID`, `LEGAL_ADDRESS` | before the first real payment (receipts) |
| `NODE_OPTIONS` | `--max-old-space-size=1536` on Standard (render.yaml has 384 for Starter) |
| `SENTRY_DSN` | errors, without personal data |
| `PLAUSIBLE_DOMAIN` | `wisecall.ge` (visitor counts without cookies) |
| `ANTHROPIC_API_KEY` | AI summaries of mentor applications (`ANTHROPIC_MODEL`, `AI_MONTHLY_BUDGET_USD`, `AUTO_APPROVE=off`) |

### Business rules (defaults match the Terms; change only together with them)

`PLATFORM_FEE_PERCENT=20`, `ANSWER_DEADLINE_DAYS=7`, `PAYOUT_HOLD_DAYS=7`, `DISPUTE_DAYS=7`, `PAYOUT_MIN_GEL=100`,
`PAYOUT_CHANGE_HOLD_HOURS=72`, `REAUTH_MINUTES=10`, `BOOKINGS_PER_HOUR=10`, `MAX_OPEN_UNPAID_BOOKINGS=3`.

### Optional

`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (both or neither) · `SOCIAL_FACEBOOK`, `SOCIAL_INSTAGRAM`, `SOCIAL_LINKEDIN`, `SOCIAL_X`,
`SOCIAL_TIKTOK`, `SOCIAL_YOUTUBE` · `FOUNDER_NAME`, `FOUNDER_ROLE`, `FOUNDER_PHOTO`, `FOUNDER_STORY_EN`, `FOUNDER_STORY_KA` ·
`ATTRIBUTION_COOKIE` (`on`) · capacity: `DB_POOL_MAX` (15), `PUBLIC_CACHE_SECONDS` (30), `MENTOR_STATS_CACHE_SECONDS` (60),
`SHUTDOWN_GRACE_MS` (20000) · `ADMIN_2FA_SESSION_HOURS` (12).

### Not now (live sessions, later)

`LIVE_SESSIONS=on`, `LIVE_PROVIDER=daily`, `DAILY_API_KEY`, and only after the bank confirms several partial refunds per payment:
`LIVE_SERIES=on`. Before turning them on: check Daily's eject request body (docs/REVIEW-2.md #12).

## D. Launch day, in order

1. Every admin in `ADMIN_EMAILS` has signed up, verified the email, set up 2FA and stored the recovery codes.
2. Manual backup (Render, or `npm run backup`).
3. Render → Environment: the payment, payout and ID-check values above (keep `LAUNCH_MODE=prelaunch`), Turnstile, `BANK_FEE_PERCENT=2`,
   `LIVE_SESSIONS=off`. Settings → Instance type: **Standard**. Save (restart).
4. `npm run check:launch` in Render → Shell: no ❌; Flitt and Didit answer and accept the keys.
5. In the Flitt portal: the callback address is this site (`https://wisecall.ge/api/payments/callback` is sent with every order).
6. `LAUNCH_MODE=live`, save. If the server does not come up, the logs say why; the old instance keeps running.
7. **Real test**: ask yourself one 5 ₾ question with a real card → it turns Paid → answer it → the email arrives → refund it from the admin
   panel → Refunded. With `PAYOUT_METHOD=flitt_iban`, one small payout to your own IBAN with a 2FA code.
8. Watch the logs for the first hours: `[payments]`, `[error]`, `rejected callback`, `[busy]`.
9. Email the waiting list (sent automatically once matching mentors are listed); start the ads (UTM links: Admin → Overview shows
   sign-ups per campaign). Use only ads that do not promise live calls.

**If something goes wrong:** `LAUNCH_MODE=prelaunch` (restart): bookings stop at once; paid questions are answered or refunded as normal.
For the first week, compare the Flitt portal's payments with Wisecall's paid questions every day.
