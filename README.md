# Wisecall

A paid advice marketplace: seekers pay to ask a question, mentors answer it, the platform takes a cut. Built EN/KA (English/Georgian) for a Georgia-first launch.

## What's actually working right now

- Real signup/login/logout with hashed passwords (bcrypt) and httpOnly JWT cookies
- **Email verification at signup** — a 6-digit code, expiring in 15 minutes. No email service configured yet? The code is shown directly on screen instead (clearly marked dev mode)
- **Forgot / reset password** — real flow with expiring, single-use tokens. Same dev-mode fallback as above when no email service is set up
- **Mentor verification — strict, server-enforced** — nobody appears in Browse experts just by signing up. Becoming a mentor requires a **verified email** and a **proof link** (LinkedIn strongly preferred); the server rejects the save entirely without both — there's no partial "half-saved" state. Once submitted, the application sits as `pending` until the site admin approves it at `/admin.html`. That's the actual mechanism for "how do we know they're not lying" — a verified human checks the proof link before the profile goes public, not an automated check
- 15 niches to choose from (business, medicine, teaching, tech, fitness, creative, law, finance, marketing, design, writing, parenting, engineering, science)
- Profiles, settings, password change, "become a mentor" flow
- Browse experts by niche, ask a paid question, mentor answers it, seeker reads the answer — full loop
- Platform fee (3% by default, configurable) computed and split on every booking
- Stripe Connect wiring (Checkout + Express payouts) — ready to go live the moment you add real keys
- **Dev mode**: with no Stripe keys set, bookings are instantly marked "paid" so you can test the entire flow with zero external accounts
- English/Georgian UI, switchable anywhere, persisted per-browser and per-account
- **Real reviews & ratings** — after a mentor answers, the seeker can leave a 1–5 star rating and a comment. Mentor cards and profiles show a computed average + review count, pulled live from actual bookings — nothing is a fake static number
- **Search + sort** on Browse experts — search by name/title/bio, sort by top rated / price / newest
- **Real "questions answered" count** per mentor, computed from actual booking data
- **Email notifications** — a mentor gets emailed when someone pays to ask them a question; a seeker gets emailed when their question is answered (uses the same Resend setup as verification/reset emails; silently skipped if email isn't configured)
- Basic SEO/Open Graph tags on the landing page so shared links show a title + description

## Run it

```bash
npm install
npm start
```

Open http://localhost:4242. The site starts empty — no fake data. Sign up, then go to **Settings** to become a mentor (fill in title/niche/price/proof link), and approve yourself at **/admin.html** using the account whose email matches `ADMIN_EMAIL` in `.env`.

## The mentor verification & admin review flow

1. Someone signs up and verifies their email (code sent at signup — see below)
2. In Settings, they check "I'd like to offer advice as a mentor" and fill in title, niche, price, and a **proof link** (LinkedIn strongly preferred, but a company team page or portfolio also works)
3. Saving is **rejected outright** — `email_not_verified` or `proof_required` — unless both the verified-email and proof-link conditions are already met. This is enforced before anything touches the database, so a rejected save can never leave partially-filled mentor fields behind
4. Once saved with everything present, the application becomes `verificationStatus: "pending"` — they do **not** appear in Browse experts yet
5. Whoever's logged in as the account matching `ADMIN_EMAIL` in `.env` opens `/admin.html`, sees the pending queue with each proof link, and clicks Approve or Reject (with an optional note the applicant will see)
6. Only `verified` mentors are ever returned by the public `/api/experts` endpoint — enforced server-side, not just hidden in the UI

This is the honest, currently-buildable answer to fraud prevention: verified email + a proof link + a human review step. There's no automated identity/credential verification here (that would mean integrating a KYC API, which is a real cost and a bigger project) — but nothing fake can go live without you personally looking at it first.

## Email — verification codes and password resets

Both `POST /api/auth/forgot-password` and the signup flow generate real, expiring, single-use codes/tokens (15 min for signup codes, 1 hour for reset links). If `RESEND_API_KEY` isn't set in `.env`, the code/link is handed back directly in the response and shown on-screen — clearly labeled as dev mode — instead of being emailed. Once you add a free Resend API key (resend.com) and set `EMAIL_FROM`, both switch to actually sending email and stop exposing anything in the response.

## Turning on real payments

This machine can't create accounts or move money on your behalf — that part is yours to do:

1. Create a free Stripe account, get your **test** keys from https://dashboard.stripe.com/test/apikeys
2. Copy `.env.example` to `.env` if you haven't, and fill in `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY`
3. For webhooks locally, install the Stripe CLI and run:
   ```bash
   stripe listen --forward-to localhost:4242/api/webhook/stripe
   ```
   Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`
4. Restart the server — it now creates real Stripe Checkout Sessions instead of simulating payment
5. Mentors connect payouts from **Settings → Payouts** (creates a Stripe Express account + onboarding link)

**⚠️ Georgia-specific caveat:** Stripe Connect's supported-country list changes over time and I can't verify from here whether it currently supports Georgia-based connected accounts (the mentors receiving payouts) for your situation. Check https://stripe.com/global first. If it isn't supported yet, the code isolates all payment logic in `server/stripeClient.js`, `server/routes/bookings.js`, and `server/routes/connect.js` — swapping in a Georgian processor (TBC ePay, BOG, Flitt) means rewriting those three files, not the rest of the app.

## What popular marketplaces have that this doesn't (yet)

Looked at what Fiverr/Upwork/Airbnb/Cameo-style platforms do and picked the highest-value pieces to add (reviews, search, sort, real stats, email notifications — see above). Deliberately left out for now, in rough priority order if you want them later:

- **Follow-up questions / threaded conversation** — right now it's one question, one answer, done. No back-and-forth.
- **Favorites / saved mentors** — no bookmarking yet.
- **Profile photos** — avatars are just colored initials; real image upload needs file storage (e.g. S3 or Cloudinary), which is a separate piece of infrastructure.
- **Refunds / disputes** — no mechanism if a seeker is unhappy with an answer. Worth having before real money is involved at scale.
- **Terms of Service / Privacy Policy pages** — still just a placeholder gap, flagged below too.

## Security notes

- In `NODE_ENV=production` the server refuses to start without a strong `JWT_SECRET`, never shows verification codes / reset links on screen (that "dev mode" is local-only), and rejects Stripe webhooks unless `STRIPE_WEBHOOK_SECRET` is set.
- Login, signup, email-code and password-reset endpoints are rate limited (in memory, per IP, resets on restart). Behind a proxy such as Render, production mode trusts one proxy hop so the real client IP is used.
- Public API responses use a field whitelist (no emails, Stripe ids or proof links). Only approved mentors can be booked.
- Responses send `X-Frame-Options: DENY`, `nosniff` and a strict referrer policy.
- If a secret was ever pasted into a chat or shared, rotate it (regenerate the Resend key) before going live.

## Before you actually publish this

- **Change `JWT_SECRET`** in `.env` to a long random string
- **Get the Georgian translations reviewed by a native speaker** — `public/i18n/ka.json` was AI-translated. The everyday UI text is probably fine; anything touching money, legal terms, or payment consent should be checked by a human before real users see it
- **Swap the data store** — `data/db.json` is a flat JSON file. Fine for building/testing, not for concurrent production writes. Move to a real database (Postgres is the standard pick) before real traffic
- **Deploy somewhere with HTTPS** and set `NODE_ENV=production` so auth cookies get the `secure` flag
- Decide on `CURRENCY` in `.env` — defaults to `usd`; only switch to `gel` once you've confirmed your Stripe account supports it

## Project layout

```
server/           Express API — auth, users, experts, bookings, Stripe Connect, webhook
public/           Static frontend — plain HTML/CSS/JS, no build step
public/i18n/      en.json / ka.json UI dictionaries
data/db.json      Local JSON "database" (gitignored, auto-created)
```

## Config (`.env`)

| Key | Meaning |
|---|---|
| `PLATFORM_FEE_PERCENT` | Your cut per paid question. Defaults to `3`. |
| `CURRENCY` | Stripe currency code for charges. |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | Leave blank for simulated dev-mode payments. |
| `JWT_SECRET` | Signs login sessions — change before production. |
| `ADMIN_EMAIL` | The one account allowed to approve/reject mentor applications at `/admin.html`. |
| `RESEND_API_KEY` / `EMAIL_FROM` | Leave blank for dev-mode password resets (link shown on screen). Set both to send real reset emails via Resend. |
