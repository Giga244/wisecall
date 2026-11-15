# Secrets and settings

Where every environment variable lives, which ones are secret, and how to rotate each key.

**Where they live:** production values are only in **Render → wisecall → Environment**. On a developer's computer they're in `.env`, which git ignores (`.gitignore` covers `.env` and `.env.*`). `.env.example` lists every variable with an explanation and **no secret values**.

**What protects them:**

| Protection | What it does |
|---|---|
| `.githooks/pre-commit` | Blocks a commit that adds a key. It uses gitleaks when it's installed, otherwise `scripts/secret-scan.js --staged`. `npm install` turns it on (`scripts/install-hooks.js`). |
| CI (`.github/workflows/ci.yml`, job `secrets`) | Runs gitleaks v8.30.1 over the whole git history on every push. `npm run check:secrets` does the same on a computer without Docker. |
| `server/secrets.js` | Names every secret. Anything written to the logs or sent to the error report (Sentry) has their values replaced by `[NAME hidden]`. |
| `server/config.js` | In production, the server **refuses to start** when a required secret is missing, or when only one key of a pair is set. |
| `tests/secrets.test.js` | Checks that no page, script or API answer sent to a browser contains a secret, and that the logs don't either. |

Findings from any scan name the file, line and rule, never the value.

## Secret: never in the code, a page, a log or a chat

| Variable | What it is | Required | Rotate |
|---|---|---|---|
| `SESSION_SECRET` (old name `JWT_SECRET`) | Signs sign-in cookies | Always in production | Render → Environment: set a new 32+ character random value (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), then redeploy. **Everybody is signed out once**, nothing else is lost. |
| `DATA_ENCRYPTION_KEY` | Encrypts IBANs, the name and date of birth from the ID check, and licence numbers | Always in production | **Don't just change it**: everything already encrypted becomes unreadable. If it ever leaks, ask a developer for a re-encryption script first (decrypt with the old key, encrypt with the new), then switch. |
| `DATABASE_URL` | The database address with its password | Always | Render → the PostgreSQL database → Info → reset the credentials, then paste the new internal address into the web service's `DATABASE_URL`. |
| `TEST_DATABASE_URL` | A throwaway test database (wiped by every test run) | Local only | Your own computer's PostgreSQL. Never a real database. |
| `BACKUP_SOURCE_URL` | The database a backup copies from (`scripts/backup.js`) | Backups only | Same as `DATABASE_URL`. |
| `RESEND_API_KEY` | Sends email | Production, with `EMAIL_PROVIDER=resend` | resend.com → API Keys → create a new key (sending access) → put it in Render → delete the old one. |
| `RESEND_WEBHOOK_SECRET` | Checks Resend's delivery reports | Optional | resend.com → Webhooks → the Wisecall webhook → roll the signing secret → Render. |
| `POSTMARK_TOKEN` | Sends email (the alternative provider) | With `EMAIL_PROVIDER=postmark` | Postmark → Servers → API Tokens → new token → Render → revoke the old one. |
| `GOOGLE_CLIENT_SECRET` | "Continue with Google" | With `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → the OAuth client → add a new secret → Render → delete the old secret. |
| `TURNSTILE_SECRET_KEY` | Cloudflare's "are you a person?" check (server side) | With `TURNSTILE_SITE_KEY` | Cloudflare → Turnstile → the site → Settings → rotate the secret key → Render. |
| `DIDIT_API_KEY` | Starts ID checks | With `KYC_PROVIDER=didit` | Didit console → API keys → new key → Render → revoke the old one. |
| `DIDIT_WEBHOOK_SECRET` | Checks that ID-check results come from Didit | With `KYC_PROVIDER=didit` | Didit console → Webhooks → regenerate the secret → Render. Results are refused between the two steps, so do both at once. |
| `FLITT_SECRET_KEY` | Signs card payments | With `PAYMENT_PROVIDER=flitt` | Flitt merchant portal → merchant settings → payment key → new key → Render. |
| `FLITT_PAYOUT_SECRET_KEY` | Signs payouts to mentors | With `PAYOUT_METHOD=flitt_iban` | Flitt merchant portal → the credit (payout) key → new key → Render. |
| `BOG_CLIENT_SECRET` | Bank of Georgia payments | With `PAYMENT_PROVIDER=bog` | BOG business portal / your BOG contact → new client secret → Render. |
| `TBC_API_KEY`, `TBC_CLIENT_SECRET` | TBC payments | With `PAYMENT_PROVIDER=tbc` | TBC developer portal → the app → new key and secret → Render. |
| `DAILY_API_KEY` | Live-session video rooms | With `LIVE_PROVIDER=daily` | Daily dashboard → Developers → API key → regenerate → Render. |
| `ANTHROPIC_API_KEY` | AI summaries for the mentor review | Optional | console.anthropic.com → API Keys → create a new key → Render → disable the old one. |
| `SENTRY_DSN` | Where error reports go | Optional | Sentry → the project → Client Keys (DSN) → create a new key → Render → disable the old one. It's semi-public by design but kept server-side here. |

After any rotation, Render redeploys by itself when you save the environment. Then check `https://wisecallge.ge/healthz`.

## Public: safe for every browser to see

| Variable | Why the browser has it |
|---|---|
| `GOOGLE_CLIENT_ID` | It's part of the "Continue with Google" address. |
| `TURNSTILE_SITE_KEY` | The page draws Cloudflare's check with it (`/api/config` → `turnstileSiteKey`). |
| `PLAUSIBLE_DOMAIN` | The name the site is counted under in Plausible. |
| `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` | The codes that prove to Google Search Console and Bing Webmaster Tools that the site is ours: a tag on the home page. |
| `FLITT_MERCHANT_ID` | Flitt's id for the shop, sent with every payment. |

## Not secret, but not sent to browsers either

- **IDs and URLs:** `BOG_CLIENT_ID`, `TBC_CLIENT_ID`, `DIDIT_WORKFLOW_ID`, the providers' API addresses (`*_API_URL`, `GOOGLE_ISSUER`, `BOG_AUTH_URL`, ...), and `BOG_CALLBACK_PUBLIC_KEY`, a public key the bank publishes.
- **Settings:** `PUBLIC_URL`, `NODE_ENV`, `LAUNCH_MODE`, `ADMIN_EMAILS`, `SUPPORT_EMAIL`, `EMAIL_FROM`, the `LEGAL_*` and `FOUNDER_*` texts, and every number, limit and on/off switch.

`.env.example` explains each one.

## If a key leaks

1. **Rotate it at its provider** (the table above) and put the new value in Render.
2. **Deleting it from git doesn't help on its own:** a key in the history stays readable. Rotating is what makes it harmless.
3. **Check the provider's logs** for use you don't recognise between the leak and the rotation.
