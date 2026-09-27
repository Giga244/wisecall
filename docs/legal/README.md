# Legal drafts (for lawyer review)

**None of these are in force and none is legal advice.** They were drafted from what the Wisecall code actually does (commit
`2b99ada`, September 2026), for a Georgian lawyer to review against Georgian law — in particular the **Law of Georgia on Personal Data
Protection** (in force 1 March 2024), the **Law on the Protection of Consumer Rights**, the **Civil Code**, the **Tax Code** and National
Bank of Georgia payment rules.

| Document | English | Georgian |
|---|---|---|
| Terms of Service | [en/terms-of-service.md](en/terms-of-service.md) | [ka/terms-of-service.md](ka/terms-of-service.md) |
| Privacy Policy | [en/privacy-policy.md](en/privacy-policy.md) | [ka/privacy-policy.md](ka/privacy-policy.md) |
| Mentor Agreement | [en/mentor-agreement.md](en/mentor-agreement.md) | [ka/mentor-agreement.md](ka/mentor-agreement.md) |
| Refund Policy | [en/refund-policy.md](en/refund-policy.md) | [ka/refund-policy.md](ka/refund-policy.md) |
| Cookie Notice | [en/cookie-notice.md](en/cookie-notice.md) | [ka/cookie-notice.md](ka/cookie-notice.md) |

## How to read them
- **[LAWYER: …]** — a point a lawyer must decide or confirm. `grep -rn "LAWYER:" docs/legal` lists all of them.
- **[OPS: …] / [BANK: …] / [DEV: …]** — a fact the team must fill in (a schedule, a bank's timing, a feature that does not exist yet).
- `Code font` — a setting in the software (`PLATFORM_FEE_PERCENT`, `ANSWER_DEADLINE_DAYS`, …). If the setting changes, the text must too.

## Relationship to the live pages
The site's current Terms/Privacy/About texts live in `public/i18n/en.json` and `ka.json` (`legal.*`) and are reviewed item by item in
`LEGAL-REVIEW.md`. These drafts are a fuller, separate set; once a lawyer approves them, the developer moves the approved text into the
live pages (see `docs/TODO-FROM-CLOUD.md`). The Mentor Agreement, Refund Policy and Cookie Notice have no live page yet.

## The biggest open questions (summary)
1. Is collecting buyers' money and paying mentors later allowed without an NBG payment-service licence, and what must the acquiring
   contract with BOG/TBC say?
2. Tax: must Wisecall withhold income tax on payouts to mentors who are not registered entrepreneurs; VAT on the fee.
3. Consumer law: the right of withdrawal for a digital service that starts immediately after payment.
4. Personal data: explicit consent for the biometric ID check; international transfers (Didit, Resend, Anthropic, Render); retention
   periods; whether a Data Protection Officer is required.
5. Regulated fields (medicine, law, finance): whether paid advice through the platform is allowed and what the disclaimer must say.
