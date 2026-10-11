# Questions for the owner

Open questions that block a piece of work, or that only you can answer. Add your answer under each one (or tell Claude in chat), and the
work it blocks can start.

## 1. Payments: is Flitt the chosen provider? — ANSWERED: yes (docs/LAUNCH-PLAN.md)

**Built** (October 2026): PART 10 — Flitt payments, refunds and IBAN payouts with an admin's 2FA code (docs/BANK-GOLIVE.md §0). The manual
payout stays as the fallback (`PAYOUT_METHOD=manual`). Still to ask Flitt: the fee per IBAN withdrawal, that IBAN withdrawal is on for the
account, and the [VERIFY] points in docs/BANK-GOLIVE.md §0. The original question:


The master prompt's PART 10 adds Flitt (TBC's payment company) for card payments **and** one-click payouts to mentors' IBANs. It is to be
built only once Flitt is confirmed, so it was **skipped** for now. Today the site supports Bank of Georgia (BOG) and TBC (tpay) for
payments, and payouts are made by hand by an admin (Admin → Withdrawals, with a CSV for a bulk transfer).

Please answer:
- Is Flitt the provider you will sign with (instead of, or as well as, BOG / TBC)?
- If yes: do you already have a Flitt merchant account (merchant id), and is the IBAN-credit payout (`/api/ibancredit`) part of your
  contract? Never paste the secret key here or in chat: it goes into Render as FLITT_SECRET_KEY.
- Should the manual payout stay as a fallback (the plan says yes)?

## 2. Live sessions: the video service

Live sessions use Daily.co for the video call (the plan's preferred choice). Nothing to decide unless you prefer Whereby; to turn it on:
create an account at daily.co, create an API key (Developers → API keys) and set LIVE_PROVIDER=daily and DAILY_API_KEY in Render. Daily's free
allowance covers testing; check their per-minute price for your expected sessions. Never paste the key in chat.

## 2b. Live sessions: series refunds and replays (safest defaults taken; tell me if you want otherwise)

- **Several partial refunds on one bank payment.** A series is one payment; when one of its sessions is cancelled, that session's share
  goes back as a partial refund of that payment. BOG documents partial refunds up to the paid amount; please confirm with BOG (and TBC, if
  used) that SEVERAL partial refunds on the same payment are allowed. If not, series must stay off in production (nothing else depends on it).
- **Replays: what Daily records.** The recording uses Daily's "single-participant" layout (the mentor alone). To be safe whatever that layout
  does with sound, nobody else can be given the microphone in a recorded session (raise hand is off). Please do one test recording on your
  Daily account before announcing replays. Recording needs a Daily plan with cloud recording.
- **How long replays are kept.** Default: watchable 30 days by ticket holders and 30 days from a pass; passes on sale until 60 days after the
  session; the file is deleted 90 days after the session. A replay deleted by the mentor refunds passes still running.
- **The mentor stops and restarts recording.** Daily then makes several files; the longest one becomes the replay. Default kept for now.

## 2c. Rich profiles: two defaults to confirm

- **Mentors’ licences and projects** start as “Only me” (the prompt names the public sections and leaves these open). Mentors can switch them
  to “Everyone” in Settings → Profile. Say if you want them public by default.
- **The AI review does not read profiles.** The prompt allows it, but your earlier rule lists exactly what the AI may see. It stays off
  until you confirm; then only the sections everyone may see would be added, as untrusted text.

## 3. Things only you can do before launch (no answer needed here, a checklist)

- Render environment: TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY (Cloudflare → Turnstile → add the site), and check the defaults of
  PAYOUT_MIN_GEL (100), BANK_FEE_PERCENT (2), LOGIN_LOCK_* (10 wrong passwords / 15 minutes / 5 minutes wait), ATTRIBUTION_COOKIE (on).
- The bank: the items marked [CONFIRM WITH BANK] in docs/BANK-GOLIVE.md (TBC payment window and the subtotal field name).
- The lawyer: LEGAL-REVIEW.md (items 51–54 are new: public answers, mentor requests, the bot check and sign-in protection, the campaign
  cookie).
- Push the local commits to GitHub when you are ready; the first push runs the new CI (tests, npm audit, gitleaks).
