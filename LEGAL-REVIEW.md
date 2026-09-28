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
22. **The waiting list** ("Get notified when mentors in your field join" on the home page). It stores an email address, a field and the language, and sends **one** email when a matching mentor is listed, with a one-click unsubscribe. There is no confirmation email (single opt-in): decide whether Georgian law or GDPR requires double opt-in, and add the waiting list to the Privacy Policy (what is stored, why, how to leave). Admins can see and export the list (`/admin.html → Waiting list`).

## Public profiles, Google sign-in, and ratings and reviews (Terms section 10, Privacy Policy sections 2 and 6) — needs lawyer review

The Terms got a new section "Ratings and reviews", and the Privacy Policy describes profiles, Google sign-in and ratings. All of it is drafted in English and Georgian and **has not been reviewed by a lawyer**. Please have these points checked:

23. **Public reviews of a person.** A review is shown with the reviewer's **name and photo** (or "Anonymous asker" when their profile is private) and can be read by anybody. Confirm the lawful basis, that the reviewer is told this clearly at the moment of writing (the form says so), and whether a reviewer can later ask for their review to be removed or made anonymous. Decide how long reviews are kept after an account is closed (nothing deletes them automatically yet).
24. **Defamation and moderation.** Wisecall hides a review that breaks the rules (insults, threats, personal data, advertising, claims known to be untrue) and records who decided and why, but does not hide a review only because it is critical. Confirm this is the right standard, what happens on a legal complaint about a review, and whether the mentor's right to reply (once, in public) is enough.
25. **Rating people who ask questions.** Mentors rate askers (stars, tags, and an optional private note to the Wisecall team). The asker never sees the note. An asker's average is public only as a badge after 3 ratings, and a very low average (under 2.5 after 3 ratings) is checked by the team and can lead to a warning or a limit. Check this against personal-data law (profiling, automated decisions, the right to see what is held about you, including the private notes) and whether the asker must be told about it at sign-up.
26. **Review rules for mentors.** The Terms forbid asking for, paying for or trading ratings, and pressuring people to change them. Confirm this is enforceable and whether consumer-protection rules on fake or incentivised reviews need more.
27. **Sign in with Google.** Google tells Wisecall the person's name, email address, whether Google verified it, their picture and a Google account id. Wisecall copies the picture into its own database. Check the wording in the Privacy Policy, Google's own terms for sign-in buttons and the consent screen, and where Google processes data.
28. **Profile photos and public profiles.** Anyone's name, photo, headline, city, languages and bio can be public (the default for askers is public; a mentor who is listed is always public). Photos are stored in the database, stripped of hidden data. Confirm the default is acceptable, and that a child under 18 cannot make a profile (the Terms say 18+).
## Mentor verification rules v2: automated review, AI, regulated professions (Privacy Policy sections 3 and 4, Terms section 6, About, "How we verify mentors") — needs lawyer review

Mentor applications now go through three steps (Identity → Experience → Review) and part of the review is automatic, including an AI model. The new texts are drafted in English and Georgian and **have not been reviewed by a lawyer**. Please check:

29. **Automated decisions.** The code can approve a mentor automatically, but only when `AUTO_APPROVE=on` (it is **off** by default) and every rule in `server/verification/rules.js` holds; it never rejects anyone (a person makes every rejection and every decision in a regulated field). Check this against the Law of Georgia on Personal Data Protection (automated individual decision-making) and GDPR Art. 22 if EU users apply: is automatic *approval* allowed, is the "you can ask a person to look again" sentence enough, and must the mentor be told the logic in more detail?
30. **The AI provider (Anthropic, PBC, United States).** The application text (title, field, tags, years, story, sample answer) and what the link checks saw are sent to Claude. Never sent: ID data, date of birth, email, phone, bank details, licence numbers, documents; emails, phone numbers and IBANs typed into the text are removed first. Sign Anthropic's data-processing terms (commercial terms / DPA), confirm the US transfer basis, how long Anthropic keeps API data and that it is not used for training, and whether the policy must name the retention period.
31. **Link checks and domain look-ups.** Wisecall's server opens the links a mentor gives (only public http/https pages; internal addresses are refused) and may look up the domain's registration date in public RDAP records. Confirm this is covered by the text and is lawful for pages that show other people.
32. **Account signals and the new device cookie.** A keyed hash of the IP address and of a random browser identifier (the new `wisecall_device` cookie, kept up to a year) are compared across accounts to detect fake or duplicate applications, and deleted after 180 days. The Privacy Policy now says Wisecall uses **two** essential cookies. Confirm this counts as "strictly necessary" (no consent banner) under Georgian law and, if relevant, the ePrivacy rules.
33. **Regulated professions and their registers.** The list and the sources are in `server/verification/registries.js` (researched September 2026) — **every entry needs confirmation**:
    - **Medicine, dentistry**: state certificate for independent medical practice (Law "On Medical Practice"), Regulation Agency for Medical and Pharmaceutical Activities, https://rama.moh.gov.ge/ — a public search of certificate holders could not be confirmed, so these mentors also upload the certificate and an admin checks it.
    - **Pharmacy**: Law "On Medicines and Pharmaceutical Activities" (https://matsne.gov.ge/en/document/view/29836); no individual public register confirmed → document check.
    - **Nursing**: no public register of nurses confirmed → document check.
    - **Psychology**: no licensing law or public register for psychologists found (the Law on Mental Health, https://matsne.gov.ge/ka/document/view/24178, mentions psychologists but no register) → diploma/certificate check. Confirm whether giving psychological advice for money needs anything else.
    - **Law**: Georgian Bar Association members registry, https://gba.ge/en/Lawyers/Members-Registry (public). Confirm whether non-advocate lawyers may give paid legal advice.
    - **Finance**: investment advice needs a National Bank of Georgia registration, which is given to companies only (https://nbg.gov.ge/en/page/licensing-requirements) → individuals show a certificate (e.g. CFA/ACCA) or their employer's registration, checked by an admin. Confirm whether individuals may give paid financial advice at all, and what the "not professional advice" disclaimer must say.
    - **Accounting & tax**: SARAS registers of certified accountants and auditors (public), https://saras.gov.ge/en/Home/Supervision.
    Decide whether any other field (for example nutrition, veterinary, construction, real estate) must be treated as regulated. Psychology, dentistry, pharmacy, nursing and accounting become selectable niches in Phase 2.
34. **Georgian company codes.** A mentor may give a Public Registry code; an 11-digit code is an individual entrepreneur's **personal number**. It is stored as given and shown only to admins, who look it up by hand on https://enreg.reestri.gov.ge/ (never scraped). Confirm this is acceptable or whether it must be encrypted.
35. **Age from the ID.** Only "18 or older: yes/no" is used from the date of birth for the application (the date itself stays encrypted with the ID result, as before). Confirm.
36. **Terms, section 6.** New sentences: mentors promise their story and evidence are true and their own; applications are reviewed partly automatically; every rejection is made by a person, with the reason, and the mentor can apply again. Confirm.

## Niches (Phase 2): new fields, "Other", field pages — needs lawyer review

37. **Which of the new fields need a licence.** Of the 22 new niches, psychology, accounting & tax, dentistry, pharmacy and nursing are treated as regulated (item 33). Architecture, real estate, tourism and studying abroad were looked at and are **not** treated as regulated for giving advice (`CONSIDERED` in `server/verification/registries.js`: architects must be certified to sign building projects since 1 October 2020, but advice needs no certificate; no licence for real-estate agents, tour guides or education agents could be confirmed). Confirm, and say if any other field (for example careers & HR, languages & translation, cybersecurity) must be restricted.
38. **"Other (type your own)".** A mentor may describe their own field in 3 to 40 characters; it is public on their profile. It is checked for links, contact details, a short list of rude words and instructions to the reviewer, and such applications are never approved automatically. An admin can turn a suggestion into a niche (the mentors move into it). Confirm this is enough for public text written by users.
39. **Field pages (`/advice/<niche>`).** Each field has a public page with the listed mentors; in regulated fields it repeats that answers are personal experience, not professional advice. Confirm the wording.

## Inbox (Phase 3): conversations, support, notifications — needs lawyer review

40. **What is stored.** Each paid question gets a conversation between the asker and the mentor: the question and answer (as before), what happened (paid, answered, refunded), and ONE free follow-up question and ONE reply. People can also write to support; admins answer from the admin panel and may add internal notes the person never sees. Messages are kept like the booking itself. Add the Inbox to the Privacy Policy (what is kept, who sees it, how long) and say that admins read support conversations and reported messages.
41. **Contact-detail filter.** In question conversations, messages with phone numbers, email addresses, messenger or social handles, or requests to pay outside Wisecall are refused with an explanation; only the kind of detail found is recorded (never the text). Confirm this automated check needs no separate notice beyond the Terms and the note under the message box.
42. **Emails a person can turn off.** Transactional emails (payments, answers, follow-ups, refunds, application decisions, payouts, support replies, security) cannot be turned off; reminders to rate and "tips and news" can, in Settings → Notifications or by the link in the email. Confirm the split, and whether "tips and news" needs opt-in consent before it is ever sent (nothing is sent in that category yet).

## Safety and disputes (Phase 4) — needs lawyer review

43. **Emergency check before payment.** A question that sounds like an emergency (self-harm, a medical emergency, violence or abuse
    happening to the person) is not sent to the bank; the page shows help text with **112** and **116 006** (described as the free,
    confidential 24/7 hotline for people facing violence) — **confirm both numbers and the wording**, and whether a mental-health line
    should be added. The question is kept encrypted for 90 days for an admin to review. This is health-related (special category)
    data: confirm the legal basis and add it to the Privacy Policy.
44. **A mentor declining a question.** The asker is refunded in full at once and sees the reason (not qualified / against the rules);
    the mentor's optional note is seen only by the team. Confirm the Terms cover this.
45. **"Report a problem with this answer" and partial refunds.** Within 7 days (DISPUTE_DAYS) of being able to read an answer, the
    asker can report a problem; the mentor's payout for it is held until an admin decides: a full refund, a partial refund (split in
    proportion between the platform fee and the mentor's share), or none, with a note both see. Mentors' earnings are never payable
    before that window has passed. Confirm the Terms (refunds, the mentor's share, disputes) and whether consumer law requires a
    different window or an appeal.
46. **Receipts and statements.** Every payment and refund gets a numbered receipt (R-000001, …) emailed to the asker with a PDF
    (EN/KA): the seller's legal details from LEGAL_NAME / LEGAL_ID / LEGAL_ADDRESS, the date, the payer's name, "a question to <mentor>
    on Wisecall", the amount in GEL and the bank. Confirm what a Georgian receipt must contain (VAT status, a fiscal receipt from the
    bank or a cash-register rule), and whether Wisecall or the mentor is the seller. Mentors get monthly statements (CSV/PDF) of what
    they earned and were paid: confirm whether they need anything for their own taxes (for example the platform's details).
47. **Download my data / delete my account.** Settings → Account: a JSON export of everything kept about the account (the ID-check
    result's verified name and date of birth stay out: they are encrypted and not needed to use the data); deletion after the password
    (or a Google sign-in in the last 10 minutes), refused while a question, a refund, a report or money is still open; the account
    closes at once and is emptied after 14 days (name, email, profile, photos, IBAN, evidence, documents, support conversations and
    notifications removed; ratings keep their stars without text; messages they wrote in question conversations are blanked). Bookings,
    payouts and receipts stay, pointing at the anonymous account, as accounting law requires. The **question and answer texts stay** for
    the other person's record. Confirm the 14-day grace period, what must be kept and for how long, and whether the question/answer
    text must also be removed on request.
48. **Sign-up and account security.** Sign-up now requires "I'm 18 or older" (a new Google account confirms it on the next page), and
    the time is stored. New passwords are checked against known breaches with Have I Been Pwned: only the first 5 characters of the
    password's SHA-1 hash are sent (k-anonymity), never the password or an email. Every account can turn on two-step verification
    (an authenticator app, with recovery codes). Mention the breach check in the Privacy Policy (a processor/recipient?), and confirm the
    18+ wording.
49. **Statistics and error monitoring (both off until configured).** With PLAUSIBLE_DOMAIN set, the server tells Plausible (an EU
    analytics service) about page views and a few events; it passes the visitor's IP address and browser for Plausible's daily-changing
    visitor hash (Plausible does not store them), sets no cookie, and skips visitors with Do Not Track / Global Privacy Control. With
    SENTRY_DSN set, server errors go to Sentry with personal data removed. List both as processors in the Privacy Policy and confirm no
    consent banner is needed.
50. **Profiles of people who ask start private.** Accounts made from now on show their profile only to people they had a question with
    (existing accounts keep their setting); mentors' profiles become public when they are approved. Reviews by an asker with a private
    profile show "Anonymous asker". Say this in the Privacy Policy (what is public, and how to change it in Settings → Profile).
