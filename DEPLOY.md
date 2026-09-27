# Deploying Wisecall

The complete, in-order guide: try it locally, then put Wisecall on the internet with a database, real email, your own domain, and card payments through a Georgian bank in GEL.

The steps use **Render** (render.com). Railway works the same way; the environment variables are identical.

> **You do not need the bank or Didit keys to go online.** The site can run in `prelaunch` (mentors sign up and apply, visitors join the waiting list, nobody can book or pay) while you wait for them: see [Going online first](#going-online-first-in-prelaunch-no-bank-or-id-check-keys-yet).

> **Some steps are yours alone.** Opening a bank merchant account, getting API keys, verifying a domain and buying a domain need your own identity and logins. Nothing here can be done for you.

**Contents**

0. [Going online first, in prelaunch (no bank or ID-check keys yet)](#going-online-first-in-prelaunch-no-bank-or-id-check-keys-yet)
1. [Try it locally](#1-try-it-locally)
2. [Get your bank account and API keys](#2-get-your-bank-account-and-api-keys)
   - [2b. Set up ID verification for mentors (Didit)](#2b-set-up-id-verification-for-mentors-didit)
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

## Going online first, in prelaunch (no bank or ID-check keys yet)

Getting a bank merchant agreement and a Didit workflow can take weeks. The site does not have to wait: with `LAUNCH_MODE=prelaunch` (or `LAUNCH_MODE` left empty) the server **starts in production without any bank or Didit keys**. Then:

- **Bookings and payments are closed.** There is no way to ask a paid question (the server refuses it), the fake bank does not exist in production, and the bank's callback address refuses everything. The home page says "Launching soon".
- **Mentors can still sign up, apply and wait.** Everything in their application works except the ID check: that step shows **"ID checks open soon"** (in English and Georgian) instead of a start button, and they can fill in the rest. An admin cannot approve a mentor until every step, including the ID check, has passed, so nobody is listed by mistake.
- **Visitors can join the waiting list** ([`/admin.html → Waiting list`](#opening-in-two-steps-launch_mode) shows who is waiting, with a CSV).
- **With `LAUNCH_MODE` empty the site never opens by itself without the keys.** Even with mentors listed it stays in prelaunch until the bank keys and the Didit keys are set, and the server log says so.
- The server prints `[WARNING]` lines naming what is still closed (`PAYMENTS ARE OFF`, `ID CHECKS ARE OFF`), and `npm run check:launch` shows ⚠️ warnings (not ❌ failures) for the missing keys.

What the first deploy needs (see [step 7](#7-environment-variables) for what each value is): `NODE_ENV=production`, `PUBLIC_URL=https://wisecallge.ge`, `DATABASE_URL`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `EMAIL_PROVIDER=resend` with `RESEND_API_KEY` and `EMAIL_FROM=Wisecall <hello@wisecallge.ge>`, `SUPPORT_EMAIL=support@wisecallge.ge`, `ADMIN_EMAILS` and `LAUNCH_MODE=prelaunch`. Leave the bank and Didit variables out.

**Going live later** is one change: add the bank keys (`PAYMENT_PROVIDER` and its keys, [step 2](#2-get-your-bank-account-and-api-keys)) and the Didit keys ([step 2b](#2b-set-up-id-verification-for-mentors-didit)), register the callback addresses ([step 8](#8-register-the-bank-callback-url)), run `npm run check:launch`, and set `LAUNCH_MODE=live` (or empty: it then opens when the first mentor is listed). **With `LAUNCH_MODE=live` the strict rules apply: the server refuses to start without the real bank keys and the Didit keys**, and it never accepts the fake bank or fake ID check in production, launched or not.

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

1. Sign up a **mentor**, apply in **Settings → Mentor** (title, niche, price in ₾, proof link, sample answer).
2. In **Settings → Verification** the mentor sees the checklist for their niche. With `KYC_PROVIDER=mock` (the default on your computer) "Start ID check" opens a **fake ID-check page** where you choose the result; nothing is really checked. Fill in the other steps (a Design mentor: a work email code and/or a portfolio link; a Medicine mentor: license details, a PDF or JPG, and a video interview slot).
3. Put a second account's email in `ADMIN_EMAILS`, restart, and work through the mentor at `/admin.html`: pass each step with a reason (for a video interview, first add a slot in **Video interviews**), then click **Approve**. Approval is only possible when every required step has passed.
4. As the mentor, add **payout details** (full name and a Georgian IBAN) in Settings → Payouts. Without them the mentor is not listed. The name must match the ID name, or an admin has to accept the difference.
5. As a seeker, ask the mentor a question and pay at the fake bank.
6. The mentor answers from the **Dashboard**. A new mentor's first 5 answers wait in `/admin.html → Review queue` (approve them there, or they are released after 24 hours); then the seeker sees the answer and can leave a review.
7. As the admin, open **Payouts**. Earnings become payable after `PAYOUT_HOLD_DAYS`; to skip the wait while testing, set `PAYOUT_HOLD_DAYS=0` and restart.

Run the automated tests (they use `TEST_DATABASE_URL`, a separate throwaway database that is wiped every run):

```bash
npm test
```

## 2. Get your bank account and API keys

Wisecall takes card payments through **Bank of Georgia (BOG)** or **TBC Bank**. You choose one with `PAYMENT_PROVIDER=bog` or `tbc`. You need a merchant agreement with that bank first. (Until you have the keys the site can already be online in prelaunch, see [above](#going-online-first-in-prelaunch-no-bank-or-id-check-keys-yet).)

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

## 2b. Set up ID verification for mentors (Didit)

Every mentor must pass a government-ID and selfie check. Wisecall uses **Didit** (https://didit.me) for it: the mentor sends the ID photos and the selfie to Didit, never to Wisecall, and Wisecall only receives the result. Didit was chosen because it names Georgian ID documents as supported, has a free tier and no monthly minimum, and signs its webhooks. **You must create the account yourself.**

1. Create an account and an application at https://business.didit.me.
2. Create a **workflow** that includes **ID verification**, **liveness** (selfie) and **face match**. Copy its id: `DIDIT_WORKFLOW_ID`. Copy the application's API key: `DIDIT_API_KEY`.
3. Add a **webhook** pointing at `https://YOUR-PUBLIC-URL/api/kyc/webhook` and copy its signing secret: `DIDIT_WEBHOOK_SECRET`. (Use a tunnel such as ngrok while testing on your computer.)
4. Set `KYC_PROVIDER=didit` and the three values. In production the server always refuses `KYC_PROVIDER=mock`, and with `LAUNCH_MODE=live` it refuses to start with a missing Didit value. Before launch (prelaunch) it starts without them and mentors see "ID checks open soon".
5. Test with your own passport or ID: apply as a mentor, click **Start ID check** in Settings → Verification, finish it on Didit's page, and confirm the step turns to "Passed" in the mentor's settings and in `/admin.html`.

How it is used: Wisecall decides nothing itself. The step passes only when a webhook that Didit **signed** says "approved" with a passed liveness check and face match, or when an admin presses "Refresh from provider" and Wisecall asks Didit directly with your API key. A forged or replayed webhook is rejected. Wisecall stores Didit's session id, the result, and the verified full name, date of birth and country (name and date of birth encrypted), never the ID images.

The code was written from Didit's public documentation and tested against a simulator that follows it. **Your first real check is the true test**; watch the server logs (`[kyc]` lines). If Didit's answer looks different from what the code expects, the step does not pass (or the webhook is refused, see the log), which is the safe direction.

Also sign Didit's data-processing agreement and read [LEGAL-REVIEW.md](LEGAL-REVIEW.md) (biometric data).

## 2c. Sign in with Google (optional)

"Continue with Google" lets people sign up and log in with their Google account. It is **off until you set two values**; without them the button is simply not shown and everything else works as before. **You must create the Google credentials yourself** (it is free, and takes about 15 minutes):

1. Go to https://console.cloud.google.com and sign in with the Google account that should own this. Click the project picker at the top → **New project** → name it `Wisecall` → **Create**, and make sure it is selected.
2. Open the menu → **APIs & Services** → **OAuth consent screen** (Google now also calls this **Google Auth Platform**). Click **Get started** and fill in:
   - **App name**: `Wisecall`. **User support email**: your support address.
   - **Audience**: **External**. **Contact information**: your email. Accept the policy and **Create**.
3. In **Branding** (or the same wizard) set the **Application home page** to `https://YOUR-DOMAIN`, the **Privacy policy link** to `https://YOUR-DOMAIN/privacy.html` and the **Terms of service link** to `https://YOUR-DOMAIN/terms.html`, and add your domain (`wisecallge.ge`) under **Authorized domains**. Add a logo if you like.
4. In **Data Access** click **Add or remove scopes** and tick exactly these three (they are the basic ones: no Google review is needed for them): `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. Save. Wisecall asks for nothing else.
5. In **Audience** the app starts in **Testing**: then only the Google accounts you list as **Test users** can sign in. When you are ready for everyone, click **Publish app** (**In production**). With only these three basic scopes it needs no further Google verification.
6. Open **Clients** (or **APIs & Services → Credentials → Create credentials → OAuth client ID**). **Application type: Web application**, name `Wisecall web`. Leave **Authorized JavaScript origins** empty (the whole sign-in happens on the server, and no Google script is ever loaded on your pages). Under **Authorized redirect URIs** add **every** address the site can run on, written exactly like this (the same scheme and host as `PUBLIC_URL`, no slash at the end of the host, nothing else):
   - `https://YOUR-DOMAIN/api/auth/google/callback` (production)
   - `https://wisecall.onrender.com/api/auth/google/callback` (only if you also use the Render address)
   - `http://localhost:4242/api/auth/google/callback` (to try it on your own computer)
   Click **Create**.
7. Google shows a **Client ID** and a **Client secret**. Copy them into the environment: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (in Render → Environment; on your computer in `.env`). The secret is a password: never paste it into a chat, an email or the code. If it leaks, create a new secret in the same place and change it here.
8. Restart the site, then run `npm run check:launch`: it says "Google sign-in is on" and prints the exact redirect URI Google must have. Open `/login.html`: the button appears above the email form. Try it with your own Google account, then with a second one.

How it behaves (all decided on the server):

- It is the standard "authorization code" flow with PKCE, a random `state` and a `nonce`; the ID token's signature, issuer, audience and expiry are all checked. `redirect_uri_mismatch` from Google means step 6 does not match `PUBLIC_URL` exactly.
- A **new** Google account gets a Wisecall account with the name, email address and picture Google gives (the picture is copied to Wisecall's own database). Their email counts as verified **only** if Google says `email_verified` is true; otherwise Wisecall emails the usual code.
- An email that **already has an account** is linked and signed in only when the address is verified on **both** sides (Wisecall's and Google's). Otherwise nothing is linked and the person is asked to log in with their password first and press **Connect** in Settings → Account. This stops anyone from taking over an account by creating a Google account with somebody else's address.
- Google never skips **mentor verification**: the ID check, licence, interview and the other steps are decided separately, exactly as for email sign-ups.
- Someone whose only way in is Google has no password: they cannot disconnect Google until they set one in Settings → Account.

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
| `PUBLIC_URL` | Your public address with `https://` and no slash at the end: `https://wisecallge.ge` (or, while you test, your Render address such as `https://wisecall.onrender.com`). Must not be localhost |
| `DATABASE_URL` | The Internal Database URL from step 5 |
| `SESSION_SECRET` | 32+ random characters (generate with the command in step 1) |
| `DATA_ENCRYPTION_KEY` | 32+ random characters, different from the one above. Encrypts mentors' IBANs. **Save a copy somewhere safe**: if it is lost, stored IBANs cannot be read |
| `PAYMENT_PROVIDER` | `bog` or `tbc`. **Needed for `LAUNCH_MODE=live`; leave it out in prelaunch** (nothing can be booked or paid until it is set) |
| `BOG_CLIENT_ID`, `BOG_CLIENT_SECRET` | From BOG (when `PAYMENT_PROVIDER=bog`). Required for `live`, not for prelaunch |
| `TBC_API_KEY`, `TBC_CLIENT_ID`, `TBC_CLIENT_SECRET` | From TBC (when `PAYMENT_PROVIDER=tbc`). Required for `live`, not for prelaunch |
| `KYC_PROVIDER` | `didit`. **Needed for `LAUNCH_MODE=live`; leave it out in prelaunch** (mentors then see "ID checks open soon") |
| `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET` | From Didit ([step 2b](#2b-set-up-id-verification-for-mentors-didit)). Required for `live`, not for prelaunch |
| `ANTHROPIC_API_KEY` | Optional but recommended: the key from [console.anthropic.com](https://console.anthropic.com) (Settings → API keys). With it, every mentor application gets an AI summary and scores for the admin (about 2 US cents per application with the default model; the admin panel shows what the reviews cost). Without it the AI part is skipped and every application goes to a person with the link checks only. The AI never receives ID data, dates of birth, emails, phone numbers, IBANs or documents |
| `ANTHROPIC_MODEL` | Optional. Default `claude-sonnet-5`. Set another model name to switch |
| `ANTHROPIC_FALLBACK_MODEL` | Optional. Default `claude-opus-5`: asked once when the first model declines for safety reasons. Empty = no second try |
| `AI_MONTHLY_BUDGET_USD` | Optional. Default `20` (US dollars). When the AI reviews reach this in a calendar month, the AI part is skipped until the next month and every application goes to a person with the link checks only; the admins are emailed once. The admin panel shows the month's spending against it |
| `AI_REVIEWS_PER_MENTOR_PER_DAY` | Optional. Default `4`: at most this many AI reviews per mentor per day (submissions and admin re-runs together) |
| `AUTO_APPROVE` | `off` (the default): a person approves every mentor. `on`: the analysis approves a mentor by itself only when **every** rule in `server/verification/rules.js` holds; never in a regulated field (medicine, law, finance, psychology, dentistry, pharmacy, nursing, accounting), and never a rejection |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional: both, or neither. From Google Cloud Console ([step 2c](#2c-sign-in-with-google-optional)). Empty = no "Continue with Google" button |
| `PLATFORM_FEE_PERCENT` | `20` (Wisecall's cut; the mentor gets the rest) |
| `ANSWER_DEADLINE_DAYS` | `7` (also written in the Terms; keep them in step) |
| `PAYOUT_HOLD_DAYS` | `7` (also written in the Terms) |
| `DISPUTE_DAYS` | `7`: how long the asker can report a problem with an answer; earnings are held at least this long |
| `LEGAL_NAME`, `LEGAL_ID`, `LEGAL_ADDRESS` | Your company or individual entrepreneur's name, identification number and legal address, printed on every receipt and shown in the footer. Each one is hidden while empty; set them before the first real payment |
| `FOUNDER_NAME`, `FOUNDER_ROLE`, `FOUNDER_PHOTO`, `FOUNDER_STORY_EN`, `FOUNDER_STORY_KA` | Optional: the founder section on the About page (hidden while the name is empty). The photo must be a file on the site, such as `/brand/founder.jpg` |
| `PLAUSIBLE_DOMAIN` | Optional: the domain as added in Plausible (`wisecallge.ge`) to count visitors without cookies. Empty = off |
| `SENTRY_DSN` | Optional: a Sentry project DSN to be told about server errors (no personal data is sent). Empty = off |
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | From resend.com. **Create a new key**; do not reuse one that was ever pasted into a chat |
| `EMAIL_FROM` | `Wisecall <hello@wisecallge.ge>` (an address on the domain you verify in step 9) |
| `SUPPORT_EMAIL` | Your **public** contact address: `support@wisecallge.ge`. It is shown in the footer, the contact page, the Terms and the Privacy Policy, and is the Reply-To of every email. If empty, no address is shown anywhere. Contact-form messages do **not** go here: they go to `ADMIN_EMAILS`, which stays private |
| `SOCIAL_FACEBOOK`, `SOCIAL_INSTAGRAM`, `SOCIAL_LINKEDIN`, `SOCIAL_X`, `SOCIAL_TIKTOK`, `SOCIAL_YOUTUBE` | Optional. Full `https://` addresses of your pages. Each one that is set gets an icon in the footer; empty ones are simply not shown |
| `ADMIN_EMAILS` | Your email (comma-separated for more people). These accounts can approve mentors, refund bookings and record payouts. **Every admin must pass two-step verification**: the first time an admin opens `/admin.html` the site shows a QR code to scan with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy), asks for the first 6-digit code, and shows 8 one-time recovery codes **once** (keep them somewhere safe, not on the same phone). After that every sign-in needs a code, and a verified session lasts `ADMIN_2FA_SESSION_HOURS` (12). It cannot be switched off in production (`ADMIN_2FA=off` is refused; it exists only for automated tests). If an admin loses the phone **and** the recovery codes, run `npm run admin:reset-2fa -- their@email` on the server: they set it up again at their next sign-in |
| `LAUNCH_MODE` | **`prelaunch` for the first deploy** (no bank or Didit keys needed): mentors can sign up and apply, visitors join the waiting list, nobody can book or pay. **`live`** when the bank and Didit keys are set: the server then refuses to start without them. Empty = automatic: `prelaunch` until the bank keys and the Didit keys are set **and** the first mentor is listed, then `live` by itself (it never opens without them). The server warns at startup (and `npm run check:launch` warns) if you force `live` with no mentor listed |

The server will not start in production with a missing required value, with `PAYMENT_PROVIDER=mock` or `KYC_PROVIDER=mock` (the fake bank and fake ID check are never allowed), or with `PUBLIC_URL` pointing at localhost. The bank and Didit values are required only when `LAUNCH_MODE=live`.

### Opening in two steps (`LAUNCH_MODE`)

Recruit mentors and collect a waiting list first, open to buyers later:

1. **`LAUNCH_MODE=prelaunch`.** Works **without bank or Didit keys**. Mentors can sign up, apply and add payout details (the ID check says "ID checks open soon" until the Didit keys are set, and nobody can be approved before it is passed), and visitors can join the waiting list. Nobody can pay: the home page says "Launching soon · Join the waitlist", Browse experts shows the waiting-list form instead of the experts, an expert's profile offers the waiting list instead of the question box, and the server refuses new bookings. Expert profiles are left out of `sitemap.xml`. Mentors' approval emails and their Settings / Dashboard say the site opens on launch day. The admin page shows a reminder, and `/admin.html → Waiting list` shows how many people are waiting per field, with a CSV download.
2. **`LAUNCH_MODE=live`** on launch day (needs the real bank keys and Didit keys: the server refuses to start without them), or leave `LAUNCH_MODE` empty and, once the bank and Didit keys are set, the site opens by itself when the first mentor is listed (without them it stays in prelaunch). Buyers can pay, profiles appear in the sitemap, and everyone who joined the waiting list *before* launch gets one email (in their language) as soon as a mentor in their field is listed. People who join later are emailed when a mentor in their field joins, as before.

`npm run check:launch` reminds you (⚠️) while the site is still in `prelaunch`, and shows the missing bank and Didit keys as ⚠️ warnings (not ❌ failures) until you set `LAUNCH_MODE=live`.

### Check everything with one command

Before you open the site, and again after any change to the settings above, run this in your host's console (Render: **Shell** tab), or on your computer with the same values in `.env` plus `NODE_ENV=production`:

```
npm run check:launch
```

It prints a ✅ / ❌ list and exits with an error if anything blocks the launch. In prelaunch the missing bank and Didit keys are ⚠️ warnings, not blockers; with `LAUNCH_MODE=live` they are ❌. It checks that `NODE_ENV=production` (which switches every development helper off), that no fake bank / ID check / email log is active, that every key and setting above is present and long enough, that `PUBLIC_URL` is `https://` and not localhost, that the database answers, and that the bank, Didit and Resend accept your keys (for Resend it also checks that the `EMAIL_FROM` domain is verified). It never prints a secret. Add `-- --deep` to also open one unused Didit session and prove the workflow id.

## 8. Register the bank callback URL

The bank tells Wisecall about payment results by calling one address:

```
https://YOUR-PUBLIC-URL/api/payments/callback
```

For example `https://wisecallge.ge/api/payments/callback`. Wisecall also prints it in the server log when it starts.

- **BOG:** the callback address is sent with every order, so nothing has to be set up in a dashboard. Ask BOG whether your merchant needs the address on an allow-list, and make sure your site is reachable over HTTPS (BOG requires it).
- **TBC:** the address is also sent with every payment, and TBC's merchant dashboard has a default callback address. Set it to the same URL. TBC sends the callbacks from the addresses 193.104.20.44, 193.104.20.45, 185.52.80.44 and 185.52.80.45; if you use a firewall, allow them.

The ID-check provider calls one more address, which you register in Didit's dashboard ([step 2b](#2b-set-up-id-verification-for-mentors-didit)):

```
https://YOUR-PUBLIC-URL/api/kyc/webhook
```

Whenever you change your domain, change this address with the bank too (and the webhook address in Didit). If callbacks ever stop, nothing breaks: the background job checks payment status every few minutes; it just takes longer.

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

1. The domain is **wisecallge.ge** (a `.ge` from a Georgian registrar).
2. In Render, open the web service → **Settings → Custom Domains → Add**. Render shows the DNS record to create at your registrar (a `CNAME`, or an `A` record for the bare domain). Add it and wait for Render to say it is verified. Render creates the HTTPS certificate on its own; there is nothing to buy or install.
3. Change `PUBLIC_URL` in Render to `https://wisecallge.ge` and redeploy. Emailed links, the bank's return and callback addresses, the sitemap and the page canonical links all use this value.
4. Tell the bank the new callback address ([step 8](#8-register-the-bank-callback-url)) and verify your domain for email if you have not ([step 9](#9-email-send-from-your-own-domain-spf-and-dkim)).
5. Submit `https://yourdomain.com/sitemap.xml` in Google Search Console.

## 11. Launch checklist

- [ ] `npm run check:launch` shows only ✅ (warnings ⚠️ are worth reading)
- [ ] `https://yourdomain.com/healthz` shows `{"ok":true}`
- [ ] Sign up with a new email: the code arrives by email (not on screen)
- [ ] "Forgot password" email arrives and the link works
- [ ] Apply as a mentor and do the **real ID check** with your own document; pass the other steps at `/admin.html` and approve yourself; add payout details; appear in **Browse experts** with the badges you earned
- [ ] The Didit webhook reaches the server (a `[req] POST /api/kyc/webhook 200` line), and a forged one is refused
- [ ] A video-interview slot: add one, book it as a Medicine mentor, send the link, and record the result
- [ ] Upload a PDF as a mentor, download it as an admin, and confirm a non-admin cannot
- [ ] Ask a question to yourself as a new mentor: the first answer waits in the **Review queue** and reaches the buyer only after you approve it
- [ ] "Report this mentor" reaches the **Review queue**; **Suspend** hides a test mentor and refunds an open question
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

**Approving mentors.** Nobody appears in Browse experts until you press **Approve**, and you can only press it when every required step for their niche has passed. The rules live in one file, [server/verification/rules.js](server/verification/rules.js): which niches are regulated, what each level requires, the registry links, the limits. Open `/admin.html → Mentor applications` and click **Review application** on a mentor:

- **Everyone:** verified email (automatic), ID + selfie check (Didit only), name match (automatic; a mismatch between the ID, the profile, the license and the payout account holder is flagged and needs your decision), the sample answer and the proof link (you read them and decide).
- **Regulated niches (Medicine, Law, Finance):** also a license or registration number (you check it in the registry links shown on the page: health-care regulator, Bar Association, National Bank), a supporting document (download it from the panel; only admins can, and each download is logged), and a **video interview** (add times in the **Video interviews** tab, send the meeting link when a mentor books, and record the result afterwards).
- **Business:** a company ID number (check it in the Public Registry link) or proof of the person's role.
- **Other niches:** at least one of a work-email address at a company or institution (the mentor confirms it with a code), a diploma or certificate, or a portfolio.

Passing or failing a step needs a written reason, is logged, and emails the mentor what happened and what is still missing. Uploaded documents are deleted automatically 90 days after a decision. A mentor can also be **rejected** with a reason (emailed). An approved mentor appears publicly once they have saved payout details. **Check the registry links in `rules.js` before launch**; official sites change.

**After approval.**

- **Review queue.** A new mentor's first 5 answers are held here and the buyer cannot see them yet. **Approve** releases one at once, **Hold for a closer look** stops the automatic release, **Reject and refund** refunds the buyer. Answers nobody flagged are released by themselves after 24 hours (unless that mentor has an open flag). The mentor's payout hold starts at release. Reports from buyers ("Report this mentor" on profiles and answers) are listed below; dismiss or uphold each with a note. Two different people reporting the same mentor flags them.
- **Flags** appear in the mentor's review panel: a low rating (average under 3.5 after 5 reviews), reports, a name mismatch, and licenses that expire within 30 days (you are emailed once). When a license expires the mentor is taken off the site until a renewed license is approved.
- **Suspend** (bottom of the mentor's review panel) hides a mentor at once, refunds every question still waiting for their answer, tells the mentor why, and holds their payouts until you decide. **Reinstate** puts them back to "pending" so they must be approved again.

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
| A mentor never appears in Browse experts | They need every required verification step passed, the admin's final approval **and** saved payout details (Settings → Payouts). Their Settings → Verification tab shows what is missing |
| The ID check never finishes | The webhook is not arriving: check the address in Didit's dashboard ([step 2b](#2b-set-up-id-verification-for-mentors-didit)) and the `[kyc]` log lines. An admin can press **Refresh from provider** in the mentor's review panel |
| "Start ID check" says it is unavailable | `KYC_PROVIDER`, `DIDIT_API_KEY` or `DIDIT_WORKFLOW_ID` is wrong, or Didit is down. See the `[kyc]` log |
| A payout button is disabled | The mentor has an open name-mismatch flag or is suspended. Resolve the flag or reinstate the mentor first |
| A new mentor's answer never reaches the buyer | It is held in the **Review queue** (first 5 answers). It is released after 24 hours unless you or a flag stopped it |
| "Too many requests" on login | The built-in limiter. It resets after 15 minutes |
| Site sleeps or is slow to wake | Free instance type. Use a paid one |
| A page shows blank or unstyled | Open the browser console: a blocked resource means the Content-Security-Policy in `server/security.js` needs updating for whatever you added |

Useful logs: every request is logged as `[req] METHOD /path status time`, and payment, payout or email problems are logged with `[payments]`, `[ledger]`, `[email]` or `[jobs]` prefixes.
