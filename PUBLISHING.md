# Publishing Wisecall — a complete beginner's guide

"Publishing a website" is really three separate things, and it helps to keep them apart:

1. **Hosting** — a computer that runs your server 24/7 so people can reach it
2. **A domain name** — a memorable address (like `wisecall.ge`) that points at that hosting
3. **Real payments** — turning on your own Stripe account so money actually moves

You can do all three, or start with just #1 (get it live and clickable) and add the rest later. Below is the order I'd actually do them in.

## Accounts you'll need to create yourself

I can't create accounts or enter payment details on your behalf — that's a hard rule for me. You'll need to sign up for these (all free to start):

- **GitHub** (github.com) — stores your code, connects to your hosting
- **Render** (render.com) — the "computer" that runs your site. (Railway.app is a fine alternative — same idea.)
- **Stripe** (stripe.com) — to actually charge real cards, once you're ready
- A **domain registrar** if you want a custom address — Namecheap or GoDaddy for `.com`, or a Georgian registrar for `.ge`

---

## Step 1 — Get your code on GitHub

This is how Render finds your code and redeploys it whenever you change something.

1. Create a free account at github.com
2. Click **New repository**, name it e.g. `wisecall`, leave it empty (no README), create it
3. Tell me once it exists — paste me the repo URL — and I'll run the git commands to push this code to it. (I'll need `git` installed first; I can do that the same way I installed Node.)

## Step 2 — Deploy on Render

1. Log into Render, click **New → Web Service**
2. Connect your GitHub account and pick the `wisecall` repo
3. Settings:
   - **Root directory**: leave blank if the repo *is* the `sagely-platform` folder (recommended — keeps this simple)
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: Free is fine to start
4. Add environment variables (Render has a form for this — same names as your local `.env`):
   - `JWT_SECRET` → a long random string (ask me to generate one)
   - `CURRENCY` → `usd` (or `gel` later, once confirmed with Stripe)
   - `PLATFORM_FEE_PERCENT` → `3`
   - `APP_URL` → fill this in *after* deploying, once you know your Render URL (e.g. `https://wisecall.onrender.com`)
   - Leave the `STRIPE_*` ones blank for now — the site works in the same "simulated payment" dev mode you've been testing
5. Click **Create Web Service**. Render builds it and gives you a live URL in a few minutes. **That's it — the site is now on the internet.**

## Step 3 — ⚠️ The one thing that will bite you if you skip it

Right now, Wisecall stores all users and bookings in one file: `data/db.json`. That's great for building and testing — it's *not* safe for a real launch, because most hosting platforms (including Render's free tier) wipe local files every time the app restarts or redeploys. **Every real signup could vanish.**

Two ways to fix this, pick one before you tell real people about the site:

- **Easiest**: upgrade to Render's paid "Starter" instance (~$7/month) and attach a **Persistent Disk**. Zero code changes — same file, just stored safely. Good enough for a while.
- **More robust**: move to a real hosted database (e.g. Render's free PostgreSQL tier, or Supabase). This needs code changes to `server/db.js` and the route files — I can do this for you when you're ready, it's a contained piece of work.

I'd start with the persistent disk to get real users faster, and migrate later once you have traction.

## Step 4 — Point a custom domain (optional, do this whenever)

1. Buy a domain from any registrar (~$10–15/year for `.com`, Georgian registrars for `.ge`)
2. In Render, go to your service → **Settings → Custom Domain**, add your domain
3. Render tells you exactly what DNS record to add at your registrar (usually a CNAME)
4. Wait 10 minutes to a few hours for DNS to update — Render auto-issues free HTTPS automatically, no extra steps

## Step 5 — Turn on real Stripe payments

1. Create your Stripe account, complete their identity/business verification
2. **Before promising mentors payouts**: check https://stripe.com/global to confirm Stripe currently supports Georgia for *connected accounts* (the mentors receiving money), not just for you as the platform owner — these are tracked separately and I can't verify this from here
3. Get your **live** keys (Dashboard → Developers → API keys — toggle off "Test mode")
4. In Render's environment variables, fill in `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` with the live versions
5. In the Stripe Dashboard → **Webhooks**, add an endpoint: `https://yourdomain.com/api/webhook/stripe`, subscribe to `checkout.session.completed`, copy the signing secret into `STRIPE_WEBHOOK_SECRET` on Render
6. Redeploy. Real charges now go through.

If Georgia isn't supported for connected accounts yet, the app still works for collecting payment from seekers — you'd just need to pay mentors out manually (bank transfer) until Stripe supports it or you swap in a Georgian processor for that one piece.

## Step 6 — The unglamorous but necessary stuff

- **Terms of Service & Privacy Policy pages** — not built yet, and Stripe will ask for them before enabling live payments. I can draft these with you once the rest is live.
- **Business registration** — you'll likely need to be a registered individual entrepreneur or company to get a Stripe account that can hold and pay out a platform fee. Worth checking with a local accountant — I'm not able to give legal/tax advice specific to Georgia.

---

## Rough costs to expect

| Thing | Cost |
|---|---|
| Render free tier | $0 (fine for testing / early launch) |
| Render Starter + persistent disk | ~$7–10/month (once you have real users) |
| Domain name | ~$10–15/year |
| Stripe | Free to set up — they take a small % + fixed fee per real transaction, on top of your own 3% |

## What to do right now

The fastest path to "it's actually online": **Steps 1 and 2 only**, skipping payments and domain entirely. That gets you a real, clickable `https://wisecall.onrender.com` URL you can send to people today, still in safe simulated-payment mode.

Tell me when you've got a GitHub account and I'll walk you through pushing the code.
