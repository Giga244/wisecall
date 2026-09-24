# Deploying Wisecall

This is the complete, in-order guide: test everything locally, then put Wisecall on the internet with a database, real email, your own domain, and Stripe payments.

Everything below uses **Render** (render.com). Railway works the same way; the environment variables are identical.

> **Do these yourself.** Creating accounts, verifying a domain, and switching Stripe to live mode need your own logins and identity. Nothing here can be done for you.

**Contents**

1. [Try it locally first](#1-try-it-locally-first)
2. [Test payments with Stripe test mode](#2-test-payments-with-stripe-test-mode)
3. [Put the code on GitHub](#3-put-the-code-on-github)
4. [Create the database](#4-create-the-database)
5. [Create the web service](#5-create-the-web-service)
6. [Environment variables](#6-environment-variables)
7. [Email: send from your own domain](#7-email-send-from-your-own-domain)
8. [Custom domain](#8-custom-domain)
9. [Stripe live mode](#9-stripe-live-mode)
10. [First launch checklist](#10-first-launch-checklist)
11. [Backups](#11-backups)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Try it locally first

You need Node 20 or newer and a PostgreSQL database on your computer.

```bash
npm install
```

Copy `.env.example` to `.env` and fill in at least `DATABASE_URL` and `JWT_SECRET`. Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Start the server (it creates and updates the database tables by itself):

```bash
npm start
```

Open http://localhost:4242. Run the automated tests (they use `TEST_DATABASE_URL`, a separate throwaway database that is wiped every run):

```bash
npm test
```

Want it to look busy while you build? Add fake demo mentors to your **local** database (it refuses to run in production or on a remote database):

```bash
npm run seed:dev
```

Remove them again with `npm run seed:dev -- --remove`.

Without any Stripe keys, payments are **simulated**: a booking is marked paid instantly. That is fine for trying the site, and it is switched off for real once `STRIPE_SECRET_KEY` is set.

## 2. Test payments with Stripe test mode

This checks the real Stripe flow with fake money. You need a free Stripe account, and the [Stripe CLI](https://docs.stripe.com/stripe-cli).

1. In the Stripe Dashboard, make sure **Test mode** is on. Copy your test keys from **Developers → API keys** into `.env`:
   - `STRIPE_SECRET_KEY=sk_test_...`
   - `STRIPE_PUBLISHABLE_KEY=pk_test_...`
2. Turn on **Connect** in the Dashboard (Settings → Connect). Mentors are paid through Connect Express accounts.
3. Log in to the CLI:

   ```bash
   stripe login
   ```

4. Forward Stripe's webhooks to your computer:

   ```bash
   stripe listen --forward-to localhost:4242/api/webhook/stripe
   ```

   It prints a signing secret starting with `whsec_`. Put it in `.env` as `STRIPE_WEBHOOK_SECRET`. Leave this command running.
5. If you also want to see Connect events, run a second listener in another terminal:

   ```bash
   stripe listen --forward-connect-to localhost:4242/api/webhook/stripe
   ```

   That prints a second `whsec_` secret. Put both in `.env`, separated by a comma: `STRIPE_WEBHOOK_SECRET=whsec_first,whsec_second`.
6. Restart `npm start`.

Now click through the whole flow:

1. **Sign up** a mentor, verify the email, and apply as a mentor in **Settings** (title, niche, price, proof link, sample answer).
2. Sign up a second account, put its email in `ADMIN_EMAILS`, restart, and approve the mentor at `/admin.html`.
3. As the mentor, open **Settings → Payouts** and finish Stripe's test onboarding. In test mode, Stripe lets you fill everything with test data (for example test bank number `000123456789` and the test ID number `000000000`).
4. As a seeker, open the mentor's profile and ask a question. Pay with the test card **4242 4242 4242 4242**, any future expiry date, any CVC and any ZIP.
5. The mentor answers from the **Dashboard**. Check the Stripe Dashboard (test mode): a payment, then a transfer to the mentor's connected account.
6. As the seeker, leave a review.
7. Try a refund from `/admin.html → Bookings and refunds`, and see the money go back in Stripe.

Other test cards: `4000 0000 0000 9995` (declined for insufficient funds) and `4000 0025 0000 3155` (asks for 3-D Secure). To try the automatic refund quickly, set `ANSWER_DEADLINE_DAYS=1` and move a booking's `answer_deadline` into the past in the database; the background job refunds it within `SWEEP_INTERVAL_SECONDS`.

## 3. Put the code on GitHub

1. Create a free account at github.com and a new empty repository (private is fine).
2. Push this project to it. `.env` is git-ignored, so your secrets stay on your computer.

## 4. Create the database

Wisecall needs PostgreSQL. It creates and updates its own tables on every start, so there is nothing to import.

1. In Render, choose **New → PostgreSQL**. Name it `wisecall-db`, pick the region closest to your users (for Georgia, Frankfurt is a good choice), and choose a **paid** plan for a real launch. Free databases can expire or be deleted after a short time, and do not include real backups. Check Render's current plans and prices.
2. When it is ready, copy the **Internal Database URL** (use the internal one when the web service is in the same region: it is faster and needs no extra settings).

## 5. Create the web service

You can use the included `render.yaml` blueprint (**New → Blueprint**, pick your repository), or do it by hand:

1. **New → Web Service**, connect your GitHub repository.
2. Settings:
   - **Runtime**: Node
   - **Build command**: `npm ci`
   - **Start command**: `npm start`
   - **Health check path**: `/healthz`
   - **Instance type**: use a paid one (Starter) for a real launch. Free instances go to sleep, and Wisecall's background job (auto-refunds, reminders, payout retries) only runs while the server is awake.
3. Keep it at **one instance**. The login rate limiter and the background job both live inside the server process.
4. Add the environment variables from the next section, then deploy.

The server checks its own settings when it starts. If something required is missing it stops and prints exactly what to fix in the deploy logs.

## 6. Environment variables

Set these in Render under **Environment**. `.env.example` lists all of them with explanations.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | The Internal Database URL from step 4 |
| `JWT_SECRET` | 32+ random characters (generate one with the command in step 1) |
| `APP_URL` | Your public address, starting with `https://`, no slash at the end (for example `https://wisecall.onrender.com`, later your own domain) |
| `PLATFORM_FEE_PERCENT` | `20` (your cut; the mentor gets the rest) |
| `CURRENCY` | `usd` (or another currency your Stripe account supports) |
| `ANSWER_DEADLINE_DAYS` | `7` (also written in the Terms; keep them in step) |
| `ADMIN_EMAILS` | Your email (comma-separated for more people). These accounts can approve mentors and issue refunds |
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | From resend.com. **Create a new key**; do not reuse one that was ever pasted into a chat |
| `EMAIL_FROM` | `Wisecall <hello@yourdomain.com>` (an address on the domain you verify in step 7) |
| `SUPPORT_EMAIL` | The inbox where contact-form messages arrive, and the Reply-To on every email |
| `STRIPE_SECRET_KEY` | Leave empty until step 9 |
| `STRIPE_PUBLISHABLE_KEY` | Leave empty until step 9 |
| `STRIPE_WEBHOOK_SECRET` | Leave empty until step 9 |
| `STRIPE_CROSS_BORDER_PAYOUTS` | `false`, unless your mentors live in a different country than your Stripe account |
| `ALLOW_SIMULATED_PAYMENTS` | `false`. In production the server refuses to start without `STRIPE_SECRET_KEY` so questions can never be free by accident. Set `true` **only** for a demo deploy before step 9, where nobody is charged |

The server will not start in production without `STRIPE_SECRET_KEY`. To get a first deploy online before Stripe is ready, temporarily set `ALLOW_SIMULATED_PAYMENTS=true`: payments are then simulated and nobody is charged. Remove it in step 9, and do not tell real people about the site before that.

## 7. Email: send from your own domain

Resend's shared test address can only email its own account owner. To email everyone, verify your domain:

1. In Resend, go to **Domains → Add Domain** and enter your domain (or a sub-domain such as `mail.yourdomain.com`).
2. Resend shows DNS records. Add them at the company where you bought the domain (its "DNS" or "Nameservers" page):
   - **SPF**: a `TXT` record that says which servers may send for your domain. Resend gives you the exact value. If you already have an SPF record, do not add a second one; merge the `include:` part into it.
   - **DKIM**: a `TXT` (or `CNAME`) record, usually named `resend._domainkey`. It lets receivers check that mails were not changed.
   - Return-path / MX record if Resend lists one (it handles bounces).
3. Also add a **DMARC** record so Gmail and others trust you more. A safe starting point is a `TXT` record named `_dmarc` with the value `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`.
4. In Resend, click **Verify**. DNS changes can take from a few minutes to a few hours.
5. Set `EMAIL_FROM` in Render to an address on that domain, redeploy, and test: sign up with a new email address and check that the code arrives in the inbox (and not in spam).

Changing provider later? Set `EMAIL_PROVIDER=postmark` and `POSTMARK_TOKEN`. No code changes are needed.

## 8. Custom domain

1. Buy a domain (a `.com`, or `.ge` from a Georgian registrar).
2. In Render, open the web service → **Settings → Custom Domains → Add**. Render shows the DNS record to create at your registrar (a `CNAME`, or an `A` record for the bare domain). Add it, then wait for Render to say it is verified. It creates the HTTPS certificate on its own.
3. Change `APP_URL` in Render to `https://yourdomain.com` and redeploy. Emailed links, Stripe redirects, the sitemap and the page canonical links all use this value.
4. In Stripe (step 9), make sure the webhook URL uses the new domain.
5. Update the "About"/"Terms" text if it mentions the old address, and submit `https://yourdomain.com/sitemap.xml` in Google Search Console.

## 9. Stripe live mode

Do this only after the test-mode flow in section 2 worked end to end.

1. **Activate your Stripe account** (business or individual details, bank account). Stripe will ask for links to your Terms and Privacy Policy: `https://yourdomain.com/terms.html` and `/privacy.html`. Have these [reviewed by a lawyer](LEGAL-REVIEW.md) first.
2. **Check Georgia support.** Stripe's list of supported countries changes. Look at https://stripe.com/global for two things: can *you* run a Stripe account, and can mentors in Georgia receive payouts as *connected accounts*? If mentors cannot be paid out through Stripe, you need a different payout method before launching.
3. Turn on **Connect** in live mode and finish its setup (platform profile, branding).
4. Copy your **live** keys from **Developers → API keys** (Test mode off) into Render: `STRIPE_SECRET_KEY` (`sk_live_...`) and `STRIPE_PUBLISHABLE_KEY` (`pk_live_...`).
5. Create **two webhook endpoints** in **Developers → Webhooks**, both with the URL `https://yourdomain.com/api/webhook/stripe`:
   - **Endpoint 1, events from "Your account"**: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`.
   - **Endpoint 2, events from "Connected accounts"**: `account.updated`.
6. Each endpoint has its own signing secret (`whsec_...`). Put **both** in Render as `STRIPE_WEBHOOK_SECRET`, separated by a comma: `whsec_first,whsec_second`. Redeploy. (If a secret is missing, the server refuses to start in production.)
7. Test with a real card and a small price (a mentor priced at $1 is enough): ask a question, answer it, then refund it from the admin page. Check that the money arrives and returns in the Stripe Dashboard.
8. Consider Stripe's **Radar** and email receipts settings, and set up **payout** and **dispute** notifications in Stripe.

## 10. First launch checklist

- [ ] `https://yourdomain.com/healthz` shows `{"ok":true}`
- [ ] Sign up with a new email: the code arrives by email (not on screen)
- [ ] "Forgot password" email arrives and the link works
- [ ] Apply as a mentor, approve yourself at `/admin.html`, connect payouts, appear in **Browse experts**
- [ ] A second account can pay for a question with a real card, and the mentor gets the email
- [ ] Mentor answers, mentor receives the transfer, the buyer can review
- [ ] An admin refund works
- [ ] Terms and Privacy open, and the footer shows About / Contact / Terms / Privacy on every page
- [ ] `/robots.txt` and `/sitemap.xml` load, and a shared link shows the preview image
- [ ] The contact form delivers to `SUPPORT_EMAIL`
- [ ] Georgian text checked by a native speaker, especially money and legal text
- [ ] You rotated any API key that was ever shared in a chat

## 11. Backups

Your users and money records live in the database, so back it up.

- **Use the host's backups.** Render paid PostgreSQL plans include automatic daily backups. Find them in the database's **Backups** tab and try one restore before you need it.
- **Also keep your own copy.** From any computer with the PostgreSQL tools, using the **External** Database URL from Render:

  ```bash
  pg_dump "EXTERNAL_DATABASE_URL" --format=custom --file=wisecall-backup.dump
  ```

  Restore into an empty database with:

  ```bash
  pg_restore --no-owner --dbname "TARGET_DATABASE_URL" wisecall-backup.dump
  ```

- **Schema changes** are SQL files in `migrations/`. They run automatically at start, each file once. Never edit a file that has already been applied. Add a new numbered file instead. Take a backup before deploying a new migration.

## 12. Troubleshooting

| Symptom | What to check |
|---|---|
| Deploy stops with "Cannot start — fix these environment variables" | The logs list exactly which variables are missing or wrong |
| Site works but no emails arrive | Check Render logs for `[email]` lines. Resend `403` means the domain is not verified or `EMAIL_FROM` is not on it |
| Payments stay "pending" | Stripe webhook not reaching the server: check **Developers → Webhooks → your endpoint → Recent deliveries**. `400` means the signing secret is wrong |
| Mentor never appears in Browse experts | They need admin approval **and** finished Stripe payout onboarding (Settings → Payouts) |
| "Too many requests" on login | The built-in limiter. It resets after 15 minutes |
| Site sleeps or is slow to wake | Free instance type. Use a paid one |
| A page shows blank or unstyled | Open the browser console: a blocked resource means the Content-Security-Policy in `server/security.js` needs updating for whatever you added |

Useful logs: every request is logged as `[req] METHOD /path status time`, and payment or email problems are logged with `[payments]`, `[webhook]`, `[email]` or `[jobs]` prefixes.
