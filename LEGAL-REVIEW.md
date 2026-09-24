# Legal review notes

`/terms.html` and `/privacy.html` (English and Georgian) were drafted as a sensible starting point. **They are not legal advice and have not been reviewed by a lawyer.** Have a Georgian lawyer review them before you take real payments.

The text lives in `public/i18n/en.json` and `public/i18n/ka.json` under `legal.terms.*` and `legal.privacy.*`. Both languages must keep the same number of sections and paragraphs (a test checks this). Update the "Last updated" line (`legal.updated`) whenever you change them.

## Ask the lawyer to check

1. **Who the operator is.** The pages say "Wisecall" without a company name, address, or registration number. Georgian law and Stripe both expect a real legal entity or sole proprietor. Add the legal name, ID number, and address once you have them.
2. **Governing law and courts.** Set to Georgia. Confirm this and the consumer carve-out.
3. **Refund rules.** The text promises: automatic full refund if unanswered after 7 days; no refund after an answer except spam, empty, or off-topic answers or breaches, requested within 7 days. If you change `ANSWER_DEADLINE_DAYS`, change the "7 days" in the terms too. Check this against Georgian consumer-protection rules for digital services (right of withdrawal).
4. **Platform fee.** The terms say "currently 20%". Keep it in step with `PLATFORM_FEE_PERCENT`.
5. **The "not professional advice" disclaimer.** Confirm it is strong enough for medical, legal, and financial topics, and whether any niche (for example medicine or law) needs extra rules or should be restricted.
6. **Mentors' status.** The text says mentors are independent. Confirm that matches how you want to treat their taxes, and whether you need to collect or report anything.
7. **Liability cap.** Limited to the price of the question. Confirm it is enforceable under Georgian law.
8. **Personal data.** Check against the Law of Georgia on Personal Data Protection: legal bases, the retention wording, the international-transfer paragraph (Stripe, the email provider, and the host process data outside Georgia), the data subject rights, and whether you must register or appoint anyone. If you will have EU users, GDPR may also apply.
9. **Cookies.** The text says only one essential login cookie and a language setting are used. If you add analytics or ads later, update this and add a consent banner.
10. **Age limit.** 18+. Confirm.
11. **Georgian wording.** Have a native speaker with legal experience review the Georgian text, not only the English.
