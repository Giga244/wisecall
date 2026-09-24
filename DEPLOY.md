# Deploying Wisecall

The complete, in-order guide: try it locally, then put Wisecall on the internet with a database, real email, your own domain, and card payments through a Georgian bank in GEL.

The steps use **Render** (render.com). Railway works the same way; the environment variables are identical.

> **Some steps are yours alone.** Opening a bank merchant account, getting API keys, verifying a domain and buying a domain need your own identity and logins. Nothing here can be done for you.

**Contents**

1. [Try it locally](#1-try-it-locally)
2. [Get your bank account and API keys](#2-get-your-bank-account-and-api-keys)
3. [Test the bank connection](#3-test-the-bank-connection)
4. [Put the code on GitHub](#4-put-the-code-on-github)
5. [Create the database](#5-create-the-database)
6. [Create the web service](#6-create-the-web-service)
7. [Environment variables](#7-environment-variables)
8. [Register the bank callback URL](#8-register-the-bank-callback-url)
9. [Email: send from your own domain (SPF and DKIM)](#9-email-send-from-your-own-domain-spf-and-dkim)
10. [Custom domain and HTTPS](#10-custom-domain-and-https)
11. [Launch checklist](#11-launch-checklist)
12. [Running the business: paying mentors and handling refunds](#12-running-the-business-paying-mentors-and-handling-refunds)
13. [Backups](#13-backups)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Try it locally

You need Node 20 or newer and a PostgreSQL database on your computer.

```bash
npm install
```

Copy `.env.example` to `.env` and fill in at least `DATABASE_URL`, `SESSION_SECRET` and `DATA_ENCRYPTION_KEY`. Generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Start the server (it creates and updates the database tables by itself):

```bash
npm start
```

Open http://localhost:4242. With `PAYMENT_PROVIDER=mock` (the default on your computer) clicking "Ask for advice" sends you to a **fake bank page** with Pay and Cancel buttons, so the whole flow works without a bank. No money moves. The fake bank does not exist in production.

The site starts empty. To click through everything:

1. Sign up a **mentor**, apply in **Settings** (title, niche, price in ₾, proof link, sample answer).
2. Put a second account's email in `ADMIN_EMAILS`, restart, and approve the mentor at `/admin.html`.
3. As the mentor, add **payout details** (full name and a Georgian IBAN) in Settings. Without them the mentor is not listed.
4. As a seeker, ask the mentor a question and pay at the fake bank.
5. The mentor answers from the **Dashboard**; the seeker leaves a review.
6. As the admin, open **Payouts**. Earnings become payable after `PAYOUT_HOLD_DAYS`; to skip the wait while testing, set `PAYOUT_HOLD_DAYS=0` and restart.

Run the automated tests (they use `TEST_DATABASE_URL`, a separate throwaway database that is wiped every run):

```bash
npm test
```

## 2. Get your bank account and API keys

Wisecall takes card payments through **Bank of Georgia (BOG)** or **TBC Bank**. You choose one with `PAYMENT_PROVIDER=bog` or `tbc`. You need a merchant agreement with that bank first.

**Before you sign, ask the bank and a lawyer** (see [LEGAL-REVIEW.md](LEGAL-REVIEW.md)): may a platform collect money for third parties and pay them out later, or does the bank need to offer a split-payment product? What are the card fees? How long can refunds be made?

### Bank of Georgia

1. Ask BOG for **Online Payment API** (BOG Payments) access for your business. When your business is registered for it, BOG gives you a `client_id` and `client_secret`. Documentation: https://api.bog.ge/docs/en/
2. Ask BOG for the **sandbox** access details (test credentials and the sandbox web addresses). They are not published; BOG has to give them to you.
3. You will use: `BOG_CLIENT_ID`, `BOG_CLIENT_SECRET`, and, only if BOG gives you different addresses for testing, `BOG_API_URL` and `BOG_AUTH_URL`.

### TBC Bank

1. Create a developer account at https://developers.tbcbank.ge and create an app to get an **API key**. Ask TBC to enable **E-Commerce (tpay)** for your merchant and give you a `client_id` and `client_secret`.
2. TBC's public documentation does not describe a sandbox. Ask TBC how to test (a test merchant, or a small real payment that you then refund).
3. You will use: `TBC_API_KEY`, `TBC_CLIENT_ID`, `TBC_CLIENT_SECRET`.

Both banks may also ask you to **whitelist a callback URL** or to give it to them; see [step 8](#8-register-the-bank-callback-url).

## 3. Test the bank connection

Do this before real customers, with the bank's test access.

1. In `.env` set `PAYMENT_PROVIDER=bog` (or `tbc`) and the keys, plus the sandbox addresses if BOG gave you any.
2. The bank must reach your server to send callbacks, and your computer is not on the internet. Two options:
   - **Recommended:** use a tunnel such as [ngrok](https://ngrok.com) or Cloudflare Tunnel, set `PUBLIC_URL` to the tunnel's `https://` address, restart, and register that callback URL with the bank ([step 8](#8-register-the-bank-callback-url)).
   - Without a tunnel it still works: when the buyer returns to the site, and every few minutes in the background, Wisecall asks the bank for the payment status itself. You just do not get the instant callback.
3. Ask a question and pay. BOG's sandbox test cards (any expiry date and CVV): `4000 0000 0000 0001` succeeds everywhere, `4000 0000 0000 0002` is declined (insufficient funds), `4000 0000 0000 0003` pays but then refunds are rejected. Mastercard and AMEX equivalents are listed in BOG's docs.
4. Check three things: the question shows as paid in the **Dashboard** and the mentor gets the email; an unpaid or declined payment does **not** mark the question as paid; and **Refund** in `/admin.html → Bookings and refunds` starts a refund (it shows "Refund in progress" until the bank confirms).

How Wisecall treats payments (useful when something looks odd): a question is marked paid **only** when the server asks the bank for the payment status and the bank says it is completed for the right amount. A callback (or the buyer coming back from the bank) only triggers that check. Forged callbacks are rejected: BOG's are signed and Wisecall verifies the signature; TBC's are unsigned, so Wisecall never trusts them and only believes the status lookup.

The code was written from the banks' public documentation and tested against a simulator that follows it. **Your first real sandbox run is the true test**, so watch the server logs (`[payments]` lines) during it.

## 4. Put the code on GitHub

1. Create a free account at github.com and a new empty repository (private is fine).
2. Push this project to it. `.env` is git-ignored, so your secrets stay on your computer.

## 5. Create the database

Wisecall needs PostgreSQL. It creates and updates its own tables on every start, so there is nothing to import.

1. In Render, choose **New → PostgreSQL**. Name it `wisecall-db`, pick the region closest to your users (for Georgia, Frankfurt is a good choice), and choose a **paid** plan for a real launch. Free databases can expire or be deleted after a short time and do not include real backups. Check Render's current plans and prices.
2. When it is ready, copy the **Internal Database URL** (use the internal one when the web service is in the same region: it is faster and needs no extra settings).

## 6. Create the web service

You can use the included `render.yaml` blueprint (**New → Blueprint**, pick your repository), or do it by hand:

1. **New → Web Service**, connect your GitHub repository.
2. Settings:
   - **Runtime**: Node
   - **Build command**: `npm ci`
   - **Start command**: `npm start`
   - **Health check path**: `/healthz`
   - **Instance type**: a paid one (Starter) for a real launch. Free instances go to sleep, and Wisecall's background job (automatic refunds, reminders, payment checks) only runs while the server is awake.
3. Keep it at **one instance**. The login rate limiter and the background job both live inside the server process.
4. Add the environment variables from the next section, then deploy.

The server checks its own settings when it starts. If something required is missing it stops and prints exactly what to fix in the deploy logs.

## 7. Environment variables

Set these in Render under **Environment**. `.env.example` lists every variable with an explanation.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PUBLIC_URL` | Your public address with `https://` and no slash at the end. First your Render address (for example `https://wisecall.onrender.com`), later your own domain. Must not be localhost |
| `DATABASE_URL` | The Internal Database URL from step 5 |
| `SESSION_SECRET` | 32+ random characters (generate with the command in step 1) |
| `DATA_ENCRYPTION_KEY` | 32+ random characters, different from the one above. Encrypts mentors' IBANs. **Save a copy somewhere safe**: if it is lost, stored IBANs cannot be read |
| `PAYMENT_PROVIDER` | `bog` or `tbc` |
| `BOG_CLIENT_ID`, `BOG_CLIENT_SECRET` | From BOG (when `PAYMENT_PROVIDER=bog`) |
| `TBC_API_KEY`, `TBC_CLIENT_ID`, `TBC_CLIENT_SECRET` | From TBC (when `PAYMENT_PROVIDER=tbc`) |
| `PLATFORM_FEE_PERCENT` | `20` (Wisecall's cut; the mentor gets the rest) |
| `ANSWER_DEADLINE_DAYS` | `7` (also written in the Terms; keep them in step) |
| `PAYOUT_HOLD_DAYS` | `7` (also written in the Terms) |
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | From resend.com. **Create a new key**; do not reuse one that was ever pasted into a chat |
| `EMAIL_FROM` | `Wisecall <hello@yourdomain.com>` (an address on the domain you verify in step 9) |
| `SUPPORT_EMAIL` | Optional. Where contact-form messages go, and the Reply-To on every email. If empty they go to the first `ADMIN_EMAILS` address |
| `ADMIN_EMAILS` | Your email (comma-separated for more people). These accounts can approve mentors, refund bookings and record payouts |

The server will not start in production with a missing required value, with `PAYMENT_PROVIDER=mock`, or with `PUBLIC_URL` pointing at localhost.

## 8. Register the bank callback URL

The bank tells Wisecall about payment results by calling one address:

```
https://YOUR-PUBLIC-URL/api/payments/callback
```

For example `https://wisecall.ge/api/payments/callback`. Wisecall also prints it in the server log when it starts.

- **BOG:** the callback address is sent with every order, so nothing has to be set up in a dashboard. Ask BOG whether your merchant needs the address on an allow-list, and make sure your site is reachable over HTTPS (BOG requires it).
- **TBC:** the address is also sent with every payment, and TBC's merchant dashboard has a default callback address. Set it to the same URL. TBC sends the callbacks from the addresses 193.104.20.44, 193.104.20.45, 185.52.80.44 and 185.52.80.45; if you use a firewall, allow them.

Whenever you change your domain, change this address with the bank too. If callbacks ever stop, nothing breaks: the background job checks payment status every few minutes; it just takes longer.

## 9. Email: send from your own domain (SPF and DKIM)

Resend's shared test address can only email its own account owner. To email everyone, verify your domain:

1. In Resend, go to **Domains → Add Domain** and enter your domain (or a sub-domain such as `mail.yourdomain.com`).
2. Resend shows DNS records. Add them at the company where you bought the domain (its "DNS" page):
   - **SPF**: a `TXT` record saying which servers may send for your domain. Resend gives you the exact value. If you already have an SPF record, do not add a second one; merge the `include:` part into it.
   - **DKIM**: a `TXT` (or `CNAME`) record, usually named `resend._domainkey`. It lets receivers check that mails were not changed.
   - The return-path / MX record if Resend lists one (it handles bounces).
3. Also add a **DMARC** record so Gmail and others trust you more. A safe start is a `TXT` record named `_dmarc` with the value `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`.
4. In Resend, click **Verify**. DNS changes can take from a few minutes to a few hours.
5. Set `EMAIL_FROM` in Render to an address on that domain, redeploy, and test: sign up with a new address and check that the code arrives in the inbox (and not in spam).

Every email Wisecall sends goes through this: verification codes, password resets, a new paid question, an answer ready, mentor approved or rejected, refunds, payout sent, and contact-form messages. Each goes out in the recipient's language (English or Georgian). In production nothing is ever shown on screen instead of emailed. If sending fails, the person sees a "could not send, try again" message, and the server log shows `[email]` with the reason (Resend `403` means the domain is not verified yet or `EMAIL_FROM` is not on it).

Changing provider later? Set `EMAIL_PROVIDER=postmark` and `POSTMARK_TOKEN`. No code changes are needed.

## 10. Custom domain and HTTPS

1. Buy a domain (a `.com`, or `.ge` from a Georgian registrar).
2. In Render, open the web service → **Settings → Custom Domains → Add**. Render shows the DNS record to create at your registrar (a `CNAME`, or an `A` record for the bare domain). Add it and wait for Render to say it is verified. Render creates the HTTPS certificate on its own; there is nothing to buy or install.
3. Change `PUBLIC_URL` in Render to `https://yourdomain.com` and redeploy. Emailed links, the bank's return and callback addresses, the sitemap and the page canonical links all use this value.
4. Tell the bank the new callback address ([step 8](#8-register-the-bank-callback-url)) and verify your domain for email if you have not ([step 9](#9-email-send-from-your-own-domain-spf-and-dkim)).
5. Submit `https://yourdomain.com/sitemap.xml` in Google Search Console.

## 11. Launch checklist

- [ ] `https://yourdomain.com/healthz` shows `{"ok":true}`
- [ ] Sign up with a new email: the code arrives by email (not on screen)
- [ ] "Forgot password" email arrives and the link works
- [ ] Apply as a mentor, approve yourself at `/admin.html`, add payout details, appear in **Browse experts**
- [ ] A second account pays a **small real amount** (set a low price, 5 ₾ is the minimum) with a real card; the mentor gets the email
- [ ] Mentor answers; the buyer receives the answer email and can review
- [ ] **Refund** that payment from the admin page and confirm the money returns on the card (this can take days)
- [ ] `/admin.html → Payouts` shows the mentor's earnings (after the hold), the CSV downloads, **Mark as paid** works, and the mentor gets the email
- [ ] The bank's callback reaches the server (look for `[payments]` and `[req] POST /api/payments/callback 200` in the logs)
- [ ] Terms and Privacy open, and the footer shows About / Contact / Terms / Privacy on every page
- [ ] `/robots.txt` and `/sitemap.xml` load with your real domain, and a shared link shows the preview image
- [ ] The contact form reaches your inbox
- [ ] A lawyer reviewed the legal text ([LEGAL-REVIEW.md](LEGAL-REVIEW.md)); a native speaker reviewed the Georgian text
- [ ] You rotated any API key that was ever shared in a chat
- [ ] `DATA_ENCRYPTION_KEY` is saved in a safe place

## 12. Running the business: paying mentors and handling refunds

**Approving mentors.** `/admin.html → Mentor applications`. Check the proof link and the sample answer, tick the three boxes, and approve, or reject with a reason (the mentor is emailed either way). An approved mentor appears publicly once they have saved payout details.

**Paying mentors (manual).** Each answered question earns the mentor its price minus the platform fee. It becomes payable `PAYOUT_HOLD_DAYS` (7) days after the answer, which is the buyer's refund window.

1. Open `/admin.html → Payouts`. Each mentor shows what is payable now, what is on hold, and their name and IBAN.
2. Click **Download transfers to make (CSV)** for a spreadsheet, or copy the IBAN. Send the bank transfer yourself from your business bank account.
3. Type the transfer's reference (any note or bank reference) and click **Mark as paid**. Wisecall records the date and reference and emails the mentor. If the amount changed since you loaded the page (a new refund, say), it refuses and asks you to check again.

**Refunds.** A buyer who is not answered within `ANSWER_DEADLINE_DAYS` (7) is refunded automatically. For other cases use `/admin.html → Bookings and refunds → Refund in full`. Refunds go through the bank and show "Refund in progress" until the bank confirms. If the mentor was already paid for that answer, Wisecall warns you first, refunds the buyer, and records the amount as owed back by the mentor; it is deducted from their next payout.

**Money you hold.** Buyers' payments arrive in your bank account. Between a payment and the mentor payout you are holding money that belongs to others, so keep enough in the account to cover refunds and payouts.

## 13. Backups

Your users and money records live in the database, so back it up.

- **Use the host's backups.** Render paid PostgreSQL plans include automatic daily backups. Find them in the database's **Backups** tab, and try one restore before you need it.
- **Also keep your own copy.** From any computer with the PostgreSQL tools, using the **External** Database URL from Render:

  ```bash
  pg_dump "EXTERNAL_DATABASE_URL" --format=custom --file=wisecall-backup.dump
  ```

  Restore into an empty database with:

  ```bash
  pg_restore --no-owner --dbname "TARGET_DATABASE_URL" wisecall-backup.dump
  ```

- **Keep `DATA_ENCRYPTION_KEY` with the backup** (in a password manager, not in the database). A restored database is useless for payouts without it.
- **Schema changes** are SQL files in `migrations/`. They run automatically at start, each file once. Never edit a file that has already been applied; add a new numbered file. Take a backup before deploying a new migration.

## 14. Troubleshooting

| Symptom | What to check |
|---|---|
| Deploy stops with "Cannot start — fix these environment variables" | The logs list exactly which variables are missing or wrong |
| Payments stay "pending" | The bank's callback is not arriving or the status check fails. Look for `[payments]` lines. Wisecall re-checks pending payments every few minutes by itself. Check the bank keys and that `PUBLIC_URL` is right |
| "payments_unavailable" or a payment error when asking a question | `PAYMENT_PROVIDER` or its keys are wrong, or the bank is down. The server log shows the bank's answer |
| A refund stays "Refund in progress" | Banks confirm refunds later (up to days). If it shows a problem on the booking in the admin panel, the bank rejected it; Wisecall retries automatically |
| Site works but no emails arrive | Look for `[email]` lines. Resend `403` means the domain is not verified or `EMAIL_FROM` is not on it |
| A mentor never appears in Browse experts | They need admin approval **and** saved payout details (Settings → Payout details) |
| "Too many requests" on login | The built-in limiter. It resets after 15 minutes |
| Site sleeps or is slow to wake | Free instance type. Use a paid one |
| A page shows blank or unstyled | Open the browser console: a blocked resource means the Content-Security-Policy in `server/security.js` needs updating for whatever you added |

Useful logs: every request is logged as `[req] METHOD /path status time`, and payment, payout or email problems are logged with `[payments]`, `[ledger]`, `[email]` or `[jobs]` prefixes.
