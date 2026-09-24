# Legal review notes

`/terms.html`, `/privacy.html` and `/about.html` (English and Georgian) were drafted as a sensible starting point. **They are not legal advice and have not been reviewed by a lawyer.** Have a Georgian lawyer review them before you take real payments.

The text lives in `public/i18n/en.json` and `public/i18n/ka.json` under `legal.*`. Both languages must keep the same number of sections and paragraphs (a test checks this). Update the "Last updated" line (`legal.updated`) whenever you change them.

## Most important: how the money flows

Wisecall collects card payments from buyers into **its own bank account** and later pays mentors by **manual bank transfer**. That is a marketplace holding other people's money. Ask your lawyer and your bank, **before launch**:

1. **Is this allowed as designed?** Under National Bank of Georgia rules, does collecting money on behalf of mentors and passing it on require a payment-service licence or registration? Or is it acceptable because you sell a service and pay suppliers? Some banks offer a split-payment or marketplace product instead. Ask BOG or TBC what they require for a platform like this.
2. **Your merchant agreement.** Check what your acquiring contract says about refunds, chargebacks, holding funds for 7+ days, and the goods and services you may sell. Advice or consultation services may need to be approved as a business category.
3. **Tax.** VAT and income-tax treatment of the platform fee, of the money you collect on behalf of mentors, and whether you must report or withhold anything on payouts. Mentors are told they are responsible for their own taxes; confirm that is enough.
4. **Refund rules.** The text promises: automatic full refund if unanswered after 7 days; no refund after an answer except for spam, empty or off-topic answers or breaches, requested within 7 days. If you change `ANSWER_DEADLINE_DAYS`, change the "7 days" in the Terms too. Check this against Georgian consumer-protection rules for digital services.
5. **Payout hold and clawback.** Earnings become payable 7 days after the answer (`PAYOUT_HOLD_DAYS`, also written in the Terms). If a buyer is refunded after the mentor was paid, the amount is deducted from the mentor's next payout. Check that the Terms make this enforceable, and decide what happens if a mentor leaves owing money.

## Other things to check

6. **Who the operator is.** The pages say "Wisecall" without a company name, address, or registration number. Georgian law and your bank both expect a real legal entity or sole proprietor. Add the legal name, ID number, and address once you have them.
7. **Governing law and courts.** Set to Georgia. Confirm this and the consumer carve-out.
8. **Platform fee.** The terms say "currently 20%". Keep it in step with `PLATFORM_FEE_PERCENT`. The text says the bank's card fees are covered by the platform fee.
9. **The "not professional advice" disclaimer.** Confirm it is strong enough for medical, legal, and financial topics, and whether any niche (for example medicine or law) needs extra rules or should be restricted.
10. **Mentors' status.** The text says mentors are independent. Confirm that matches how you want to treat them.
11. **Liability cap.** Limited to the price of the question. Confirm it is enforceable under Georgian law.
12. **Personal data.** Check against the Law of Georgia on Personal Data Protection: legal bases, retention, the international-transfer paragraph (the email provider and the host may process data outside Georgia), data subject rights, and whether you must register or appoint anyone. Mentors' **full name and IBAN** are personal data: they are stored encrypted (key: `DATA_ENCRYPTION_KEY`) and shown only to the mentor and admins. If you will have EU users, GDPR may also apply.
13. **Cookies.** The text says only one essential login cookie and a language setting are used. If you add analytics or ads later, update this and add a consent banner.
14. **Age limit.** 18+. Confirm.
15. **Georgian wording.** Have a native speaker with legal experience review the Georgian text, not only the English.

## Mentor verification (Privacy Policy section 3, About page) — needs lawyer review

The Privacy Policy now has a section "Mentor verification" (and the ID provider is named in "Who we share it with"). It describes what the code really does; a lawyer must confirm it is sufficient and lawful:

16. **Biometric and ID data.** Mentors send a government ID and a live selfie to the identity provider (**Didit**), not to Wisecall. Wisecall keeps the provider's verification ID, the result, and the verified full name, date of birth and country (name and date of birth encrypted), plus the time. A selfie/face match can count as **biometric data**, which is a special category under GDPR and probably under Georgian personal-data law. Confirm the legal basis (consent?), whether a written consent step must be added before "Start ID check", and whether Wisecall or Didit is the controller for that data.
17. **The provider agreement.** Sign Didit's data-processing agreement, check where it stores data (EU/US) and how long, and update the "Where data is processed" paragraph if needed. Name the provider's legal entity in the policy.
18. **Retention.** Uploaded documents are deleted automatically 90 days after a decision. The ID result, verified name/date of birth/country and licence details are kept while the mentor account exists and "as long as the law requires" afterwards. There is no automatic deletion of these yet: decide the exact period after closure and tell the developer so a purge can be added.
19. **Licence numbers and uploaded documents.** Stored encrypted, visible only to admins, every download audit-logged. Confirm the lawful basis (verifying a professional's qualifications) and that checking public registers by hand is fine.
20. **Video interviews.** The policy says the time, result and reviewers' notes are kept. If your team records calls, the policy and a consent step must say so.
21. **Terms.** The Terms do not yet say that a mentor's profile can be suspended (and open questions refunded) when a check fails, a report is upheld or a licence expires. Add this to the mentor section of the Terms.
