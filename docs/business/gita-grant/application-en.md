# Wisecall — GITA Startup Matching Grant application (DRAFT, English)

> Draft to adapt to the portal’s form on grants.gov.ge. `[YOU: …]` = fill in yourself. `[VERIFY]` = check the fact/source first.
> No statistics are invented: where the application should cite a market number, it names the official source to take it from.

## 1. Summary (≈ 100 words)
Wisecall (wisecallge.ge) is a Georgian marketplace where anyone can pay to ask a verified expert one written question and get a
thoughtful written answer within 7 days — or their money back automatically. Mentors set their own price (5–2,000 ₾); Wisecall keeps 20%.
Every mentor passes an ID and selfie check, an age check, a name match and a review of their experience by a person; doctors, lawyers and
financial advisers also need a licence we check in the official register. The product is built in Georgian and English, takes payments
through a Georgian bank and is ready for launch. We ask GITA to co-finance the first 12 months: launch, mentor recruitment and marketing.

## 2. Problem
- People in Georgia who face a big decision — studying abroad, a first job in IT, changing careers, opening a small business, a residency
  application, national exams — usually look for advice from **someone who has already done it**. Today they ask in Facebook groups,
  message strangers, or pay an agency whose interest is to sell a service.
- Advice in groups is free but **unverified**: nobody knows who is answering, and there is no accountability.
- Experienced people have no simple, safe way to **charge fairly for 20–30 minutes of their knowledge** without setting up a business,
  a website and payments. Consultations are usually calls that need scheduling; many questions only need one good written answer.
- International platforms exist (Clarity.fm, JustAnswer, MentorCruise, Intro — see `docs/business/competitors.md`), but they are in
  English, priced in dollars, focused on US experts, and do not know Georgian institutions, laws or universities.

## 3. Solution
- **Pay per question, not per subscription.** One question, one written answer, a clear price shown before paying.
- **Answer within 7 days or an automatic full refund** — no need to ask. Refunds go back through the bank.
- **Verified mentors:** ID + liveness + face match via Didit, 18+ from the ID, the profile name must match the ID, an application with
  evidence reviewed by a person (an AI summary helps the reviewer but never rejects anyone), licence checks in regulated fields, and the
  first 5 answers of every new mentor checked by our team before the buyer sees them.
- **Trust after the answer:** double-blind ratings, public reviews, reports, suspension of mentors who break the rules.
- **Built for Georgia:** Georgian and English, prices in lari, payments through Bank of Georgia or TBC Bank, payouts to Georgian IBANs,
  36 fields including studying abroad, careers, IT, medicine, law, accounting, tourism, wine and agriculture.

**What is innovative for Georgia:** a verified, pay-per-answer expert marketplace in Georgian, with automatic refunds and licence checks,
and an asynchronous format (a written answer, no scheduling) that fits people who work, study or live abroad.

## 4. Market in Georgia
Cite official numbers here, do not estimate them:
- Population and age groups — Geostat (geostat.ge) [VERIFY and insert].
- Internet and smartphone use by households — Geostat ICT survey [VERIFY and insert].
- Students going abroad / applicants to Georgian universities — Ministry of Education, Science and Youth; National Assessment and
  Examinations Center (naec.ge) for the number of national-exam candidates [VERIFY and insert].
- Georgians working abroad (emigration) — Geostat migration statistics [VERIFY and insert].
- Georgian IT sector size / employment — Geostat, GITA reports [VERIFY and insert].

**Target users in year 1:** students and young professionals (studying abroad, first job, exams, career change), small business owners,
and Georgians abroad. **Supply:** Georgian professionals and diaspora experts who can answer in Georgian.
**Go-to-market:** Georgian SEO articles on these exact topics (`docs/content/plan.md`), partnerships with student organisations and
professional communities, the mentors’ own networks (every mentor shares their profile), a waiting list that is already built into the site.

## 5. Business model
- Buyer pays the mentor’s price (5–2,000 ₾). Wisecall keeps **20%**; the mentor receives 80% 7 days after the answer (the buyer’s window to
  report a problem).
- Costs are mostly people and marketing; software costs are small (hosting ≈ $14/month, ID checks free up to 500/month, AI reviews
  ≈ $0.04 each — `docs/business/financial-model.md`).
- **Unit economics (placeholder inputs):** at a 40 ₾ average price, Wisecall earns ≈ 5–7 ₾ per question after card fees and VAT;
  ~165 paid questions per month cover the running costs without salaries. [Update with your final model.]

## 6. Traction (honest)
Wisecall is **pre-launch**. What exists today:
- A working product at wisecallge.ge in prelaunch mode: accounts, Google sign-in, mentor application with ID checks, admin review with
  two-step verification, bank payment integrations (BOG and TBC, tested against a simulator), refunds, payouts ledger, ratings, EN/KA.
- An automated test suite, an end-to-end browser test of the whole journey on desktop and mobile, and accessibility checks (axe-core,
  Lighthouse 97–100 on the main pages).
- Draft Terms, Privacy Policy, Mentor Agreement and Refund Policy for lawyer review; an operations runbook; a help center in both languages.
- A waiting list on the site. [YOU: number of sign-ups and mentor applications at the time of applying, if any — only real numbers.]
- No revenue yet, no paying customers yet.

## 7. Team
- [YOU: name, role, background, what you built, time commitment]
- [YOU: co-founder / advisers, if any]
- Planned hires with the grant: a part-time mentor-community and content manager; a Georgian lawyer and an accountant as contractors.

## 8. Use of funds (12 months)
See `budget.md` — built from the base scenario of the financial model plus team costs. In short: team, mentor recruitment and Georgian
content, launch marketing, legal and accounting, a security review, and infrastructure. Total ≤ 111,111 ₾ (GITA ≤ 90%, us ≥ 10% in cash).
[YOU: final numbers.]

## 9. Milestones (12 months)
| Month | Milestone | How we measure it |
|---|---|---|
| 1–2 | Company registered, bank acquiring contract signed, lawyer-approved legal texts on the site, security fixes from the audit | contract, published texts, audit items closed |
| 2–3 | First 20 verified mentors in 5 fields (study abroad, IT careers, business, medicine residency, exams) | approved mentors in the admin panel |
| 3 | **Public launch** (payments open) | LAUNCH_MODE=live |
| 3–6 | 12 Georgian guide articles published; first paying questions | published pages; paid questions |
| 6 | 50 verified mentors; refund rate and answer time tracked monthly | admin panel |
| 9 | [YOU: target paid questions per month] | admin panel |
| 12 | [YOU: target] paid questions per month, 100+ mentors, break-even plan updated with real data | financial model with actuals |

## 10. Risks and how we handle them
| Risk | Mitigation |
|---|---|
| Not enough mentors (supply) | Recruit field by field; profile-sharing; start with fields where the founders have networks; early-mentor fee offer (see competitors.md) |
| Not enough buyers (demand) | SEO on high-intent Georgian topics; the waiting list; mentors bring their own audience |
| Poor or unsafe answers | ID + licence checks, first 5 answers checked, ratings, reports, suspension; clear “not professional advice” rules |
| Payments and tax structure (VAT on fee vs full price) | Decided with an accountant before launch; agent model preferred |
| Personal data (ID checks, biometric data) | ID images never stored by Wisecall; encrypted data; lawyer review under the 2024 Personal Data Protection Law |
| Refunds and chargebacks | Automatic refunds; bank-confirmed payment status; clear refund policy |
| Dependence on one bank / provider | Code supports both BOG and TBC; ID-check provider behind an interface |
