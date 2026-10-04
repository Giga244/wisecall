# Questions for the owner

Open questions that block a piece of work, or that only you can answer. Add your answer under each one (or tell Claude in chat), and the
work it blocks can start.

## 1. Payments: is Flitt the chosen provider? (blocks PART 10)

The master prompt's PART 10 adds Flitt (TBC's payment company) for card payments **and** one-click payouts to mentors' IBANs. It is to be
built only once Flitt is confirmed, so it was **skipped** for now. Today the site supports Bank of Georgia (BOG) and TBC (tpay) for
payments, and payouts are made by hand by an admin (Admin → Withdrawals, with a CSV for a bulk transfer).

Please answer:
- Is Flitt the provider you will sign with (instead of, or as well as, BOG / TBC)?
- If yes: do you already have a Flitt merchant account (merchant id), and is the IBAN-credit payout (`/api/ibancredit`) part of your
  contract? Never paste the secret key here or in chat: it goes into Render as FLITT_SECRET_KEY.
- Should the manual payout stay as a fallback (the plan says yes)?

## 2. Things only you can do before launch (no answer needed here, a checklist)

- Render environment: TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY (Cloudflare → Turnstile → add the site), and check the defaults of
  PAYOUT_MIN_GEL (100), BANK_FEE_PERCENT (2), LOGIN_LOCK_* (10 wrong passwords / 15 minutes / 5 minutes wait), ATTRIBUTION_COOKIE (on).
- The bank: the items marked [CONFIRM WITH BANK] in docs/BANK-GOLIVE.md (TBC payment window and the subtotal field name).
- The lawyer: LEGAL-REVIEW.md (items 51–54 are new: public answers, mentor requests, the bot check and sign-in protection, the campaign
  cookie).
- Push the local commits to GitHub when you are ready; the first push runs the new CI (tests, npm audit, gitleaks).
