# Wisecall financial model — how it works

File: [`financial-model.xlsx`](financial-model.xlsx) (rebuild: `pip install openpyxl && python3 docs/business/tools/build_financial_model.py`).
Opens in Excel, LibreOffice or Google Sheets; every formula recalculates on open.

> **Important:** the scenario numbers (questions per month, growth, average price, marketing) are **placeholders, not forecasts**.
> Wisecall is pre-launch and has no sales data. Every cost marked `PLACEHOLDER` or `[VERIFY]` must be replaced with a real quote.
> The results below only show what the model does with those placeholders.

## Sheets

| Sheet | What |
|---|---|
| **Summary** | Break-even month, cash needed, questions needed per month, 24-month totals for the three scenarios, and three charts (base revenue vs costs, base cumulative cash, revenue by scenario) |
| **Inputs** | Every assumption, in yellow, with its unit and where it comes from / what to check. General inputs on top, the scenario table (slow / base / good) below |
| **P&L Slow / Base / Good** | 24 monthly columns, all formulas: questions → bookings → refunds → mentors’ share → platform revenue → VAT → card fees → costs → profit → cumulative cash |
| **Notes** | How to read the model, cash timing, VAT |

## How the money flows (as the product works today)

- A buyer pays the mentor’s price (5–2,000 ₾) by card to Wisecall (BOG or TBC).
- If there is no answer in 7 days, or the answer is rejected, the buyer gets it all back → **Refund rate**.
- For each kept booking, Wisecall keeps **20%** (`PLATFORM_FEE_PERCENT`) and owes the mentor 80%, payable 7 days after the answer is
  readable (the brief says once their balance reaches **100 ₾** — that minimum is **not in the code yet**; payouts are manual transfers
  today). The mentors’ share is shown for information but is **never revenue**.
- The bank takes its card fee on every charged payment → **Card fee %** (and it may not come back on refunds → **Card fee returned?**).

## The costs in the model

| Cost | How it’s calculated | Source |
|---|---|---|
| Hosting | Render Starter web ($7) + Postgres basic-256mb ($6) + storage, plus an upgrade step above a question volume | render.com/pricing via search results; Render repriced in Sept 2026 → [VERIFY] |
| Email | Free up to 3,000 emails/month, then Resend Pro $20 | resend.com/pricing via search results [VERIFY] |
| ID checks | 500 free Didit checks/month, then $0.33 per full KYC | didit.me/pricing via search results [VERIFY] |
| AI reviews | applications × reviews per application × $0.04 | Claude Sonnet 5 list price $2 / $10 per million tokens; a review is ~4k input and at most 3k output tokens (`server/verification/aiReview.js` caps output at 3,000). The code also caps AI spend at `AI_MONTHLY_BUDGET_USD` (default $20) |
| Domain, accountant, bank fees, other, one-off launch (lawyer) | fixed inputs | **PLACEHOLDERS** — get quotes |
| Marketing, team pay | per scenario | **PLACEHOLDERS**; team pay is 0 (unpaid founders) by default |

## Taxes — decide these with an accountant first

| Tax | In the model | Why it matters |
|---|---|---|
| **VAT 18%**, registration once taxable turnover passes **100,000 ₾ in any 12 months** | Switch `VATBase`: **1** = VAT only on Wisecall’s fee (agent model), **2** = VAT on the whole question price (merchant model). The model registers automatically from the month the rolling 12-month base passes the threshold; prices are treated as VAT-inclusive | With the merchant model, VAT (18/118 ≈ 15.3% of the price) would take about **three-quarters of the 20% fee**. Sensitivity below |
| Profit tax 15% | Only on the share of profit you **distribute** (`DistributedShare`, default 0%) | Georgia taxes distributed profit (“Estonian model”) [VERIFY WITH ACCOUNTANT] |
| Turnover tax | `TurnoverTax`, default 0% | The 1% small-business status is for individual entrepreneurs only, not an LLC [VERIFY WITH ACCOUNTANT] |
| Innovative Startup Status (GITA) | not modelled | Reported to give 0% profit tax and lower payroll tax for approved startups — see `gita-grant/programmes.md` [VERIFY] |
| Mentors’ income tax | not Wisecall’s | Mentor Agreement §5 — unless the accountant says Wisecall must withhold |

Sources: Andersen Georgia (VAT registration rules; 1% regime), legalese.ge (VAT), expathub.ge (Innovative Startup Status) — all
[VERIFY WITH ACCOUNTANT].

## Results with the placeholder inputs

| | Slow | **Base** | Good |
|---|---|---|---|
| Scenario assumptions | 10 questions in month 1, +10%/month, 30 ₾ | **20, +15%/month, 40 ₾** | 40, +20%/month, 55 ₾ |
| **Break-even month** (first month with net profit ≥ 0) | not within 24 months | **15** | 9 |
| **Cash needed until break-even** | 13,820 ₾ (still negative at month 24) | **8,740 ₾** | 6,726 ₾ |
| Contribution per paid question (VAT as if registered) | 4.08 ₾ | **5.44 ₾** | 7.48 ₾ |
| Fixed costs per month at month 12 | 695 ₾ | **896 ₾** | 1,397 ₾ |
| **Paid questions per month needed to cover costs** | 171 | **165** | 187 |
| Paid questions in month 12 / 24 | 29 / 90 | **93 / 498** | 297 / 2,650 |
| Platform revenue, months 1–24 | 4,891 ₾ | **27,100 ₾** | 158,884 ₾ |
| Net profit, months 1–24 | −13,820 ₾ | **+993 ₾** | +101,622 ₾ |

Why the base scenario breaks even at ~142 questions (month 15) although the “questions needed” line says 165: that line is
conservative and assumes VAT is already charged on the fee, which in the base case only happens much later.

### Sensitivity (change one input, keep the rest)

| Change | Base: break-even month | Base: cash needed | Base: questions/month needed |
|---|---|---|---|
| None (as above) | 15 | 8,740 ₾ | 165 |
| **VAT on the full price** (`VATBase = 2`) | 15 (threshold not reached before then) | 8,740 ₾ | **947** |
| **Founder pay 2,000 ₾/month** | **24** | **47,324 ₾** | 533 |
| Card fee 0.5% (if the NBG cap passes) | 15 | 8,256 ₾ | 149 |

**Reading:** software costs are tiny (Render + email + AI are ~50–100 ₾ a month at this scale; Didit stays inside its free tier). What
decides the business is **volume × average price**, **how VAT is structured**, and **whether the founders are paid**. Contribution per
question at a 40 ₾ average is only ~5–7 ₾, so every lari of monthly fixed cost needs ~0.15–0.2 extra questions.

## What to do with it
1. Replace the placeholders: accountant and lawyer quotes, bank contract card fee, Render’s current price, your real marketing budget.
2. Ask the accountant the **VAT base** question before launch (it can change the model more than anything else).
3. After launch, replace the scenario rows with real numbers from the admin panel every month (questions, average price, refund rate).
4. For the GITA application, set `GrantAmount` / `GrantMonth` and a realistic team cost, and use the base P&L for the budget
   (`gita-grant/budget.md`).
