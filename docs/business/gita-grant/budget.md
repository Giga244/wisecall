# Grant budget — 12-month project (draft, tied to the financial model)

Programme: **GITA Startup Matching Grants** — GITA ≤ 90% of the approved budget (max 100,000 ₾), applicant ≥ 10% in cash from private
sources [VERIFY the current call’s rules and eligible cost categories on grants.gov.ge].

## Where the numbers come from

**A. Running costs = the base scenario of `financial-model.xlsx`, months 1–12** (formulas on the “P&L Base” sheet):

| Line (model) | 12 months | Note |
|---|---|---|
| Hosting (Render web + Postgres) | 470 ₾ | $13.6/month × 2.70 ₾ [VERIFY price + rate] |
| Email (Resend) | 0 ₾ | inside the free tier at base volumes |
| ID checks (Didit) | 0 ₾ | inside 500 free checks/month |
| AI reviews of mentor applications (Anthropic) | 19 ₾ | ~$0.04 per review |
| Domain | 60 ₾ | PLACEHOLDER |
| Accountant | 3,600 ₾ | PLACEHOLDER 300 ₾/month [VERIFY WITH ACCOUNTANT] |
| Marketing | 6,000 ₾ | PLACEHOLDER 500 ₾/month |
| Other | 600 ₾ | PLACEHOLDER |
| One-off: lawyer review of the legal texts, company set-up | 1,500 ₾ | PLACEHOLDER [VERIFY lawyer’s quote] |
| **Model total, months 1–12** | **12,249 ₾** | the model assumes unpaid founders |

**B. What the grant adds (not in the model today — add them as “Team” and extra lines to see their effect):**

| Line | Amount | Why |
|---|---|---|
| Team: founder / product lead, 12 months | [YOUR NUMBER] ₾ | Most eligible budgets are people; set it in Inputs → “Team / founder pay” |
| Part-time mentor-community & content manager (recruit mentors, publish the articles in `docs/content/`) | [YOUR NUMBER] ₾ | Supply side: without mentors there is nothing to buy |
| Security review / penetration test before payments open | [QUOTE] ₾ | Fixes in `docs/AUDIT.md`; buyers’ money and ID data |
| Legal: Georgian lawyer for Terms, Privacy, Mentor Agreement; data-protection consultation | [QUOTE] ₾ | `docs/legal/README.md` open questions |
| Extra marketing for the launch (above the model’s 500 ₾/month) | [YOUR NUMBER] ₾ | Georgian SEO articles, social ads, university and community partnerships |

## Draft budget table (fill in the brackets)

| Category | GITA (≤ 90%) | Applicant cash (≥ 10%) | Total |
|---|---|---|---|
| Team (salaries) | | | [ ] |
| Mentor recruitment & content | | | [ ] |
| Marketing & launch (model: 6,000 ₾ + extra) | | | [ ] |
| Legal, accounting (model: 3,600 + 1,500 ₾ + extra) | | | [ ] |
| Security review | | | [ ] |
| Infrastructure & services (model: ~550 ₾) | | | [ ] |
| **Total** | **= 0.9 × total** | **= 0.1 × total** | **[ ] ≤ 111,111 ₾** |

Rule of thumb from the model: with the placeholder costs, 12 months of running Wisecall cost ~12,000 ₾ **without salaries**. A realistic
application is therefore **team + ~12,000 ₾ + the one-off items**; a total of ~50,000–60,000 ₾ is plausible for one paid founder plus a
part-time helper, but only your own salary numbers can decide it. Then set `GrantAmount` (= 90% of the total) and `GrantMonth` on the
Inputs sheet to show the evaluator the cash curve with the grant.

## How the grant changes the plan (for the application text)
- **Break-even (base, placeholders, unpaid founders):** month 15, ~165 paid questions per month at a 40 ₾ average.
- **With one paid founder (2,000 ₾/month):** break-even month 24 and ~47,000 ₾ of cash needed — which is what the grant bridges.
- **Milestones the money buys:** see “Milestones” in `application-en.md`.
