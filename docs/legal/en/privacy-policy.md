# Wisecall — Privacy Policy

> **DRAFT FOR LAWYER REVIEW. Not legal advice. Not yet in force.**
> Written against the Law of Georgia on Personal Data Protection (in force from 1 March 2024) and what the Wisecall software actually
> does at commit `2b99ada`. Every **[LAWYER: …]** needs a decision. `Code font` = a setting or a place in the software.

**Version:** draft 1 · **Last updated:** [date]

## 1. Who is responsible

The data controller is [LAWYER: legal name], identification code [ID], [address], Georgia ("**Wisecall**", "**we**").
Contact for privacy questions: [privacy/support email].
[LAWYER: does Wisecall need to appoint a Personal Data Protection Officer under the 2024 Law (e.g. because it processes special
categories — biometric data in the ID check — or large volumes)? If so, name them here.]

## 2. What we collect, why, and on what legal basis

| Data | When | Why | Legal basis [LAWYER: confirm each] |
|---|---|---|---|
| Name, email, password (stored only as a bcrypt hash), language, theme | Sign-up, Settings | Your account; emails in your language | Contract |
| Google account id, email, "email verified" flag, name, profile picture | "Continue with Google" | Signing you in; the picture becomes your profile photo (you can remove it) | Contract / consent |
| Username, headline, current work, city, languages, bio, LinkedIn/website links, profile photo (re-encoded, all hidden data removed), who may see your profile | Settings | Your profile page | Contract |
| **Optional profile sections:** experience, education, licences and certifications, skills, language levels, projects (with pictures, re-encoded, all hidden data removed), a journey timeline, more links; who may see each part; "Verified" marks our team gives to items; reports about profiles and our decisions | Settings → Profile; reports from other users | Showing your profile to the people you chose; search and the mentor cards (only parts shown to everyone); keeping the site safe | Contract; legitimate interest for reports and moderation. Parts set to "Only me" are shown to nobody else |
| Questions and answers | When you ask or answer | The service itself | Contract |
| Payment records: amount, currency, status, the bank's order id, refund status | When you pay | Payments, refunds, accounting, disputes | Contract; legal obligation (accounting) |
| **Not collected:** card number, CVV, card expiry | — | Entered only on the bank's own page | — |
| Ratings, reviews, replies, reports | When you rate or report | Trust and safety on the Platform | Legitimate interest |
| Messages from the contact form (name, email, message) | Contact page | Answering you. Emailed to our team; not stored in our database | Legitimate interest / consent |
| Waiting-list email, field of interest, language | "Tell me when…" form | One email when a matching Mentor joins | Consent (unsubscribe link in the email) |
| **Live sessions — tickets:** the session, the price you paid, payment and refund records, up to 2 questions you send in advance, whether you join anonymously | When you buy a ticket | Selling the ticket, refunds, receipts, the session's questions | Contract; legal obligation for payment records |
| **Live sessions — in the room:** your first name or "Guest N" (shown to the Mentor and the other participants), when you were in the room (a signal every 30 seconds), raised hands, the questions you write (shown without your name) and upvotes. The call's video and sound go through our video service, Daily.co (a processor), and are **not recorded** | While you are in a live session | Running the call; deciding refunds and the Mentor's payout (the Mentor's presence) | Contract; the room data is deleted 30 days after the session [LAWYER: confirm Daily.co transfer terms] |
| **Live sessions — hosting (Mentors):** the session's text, cover picture, time and price; how long you were in the room | When you create and run a session | Showing and running the session; your payout | Contract |
| **Live sessions — following, waiting lists, ratings, codes:** the mentors you follow (and when we last emailed you about one), waiting lists you join, the stars and comment you give a session (shown without your name), your one-time discount codes | When you use these features | Emailing you about a followed mentor's new sessions (at most once a week; one-click stop), offering you a freed seat, showing ratings, applying your code | Contract; legitimate interest for the follow emails, which you can stop at any time. Waiting lists are deleted 30 days after the session |
| **Live sessions — series and replays:** the series you buy (one payment, a ticket per session); for a recorded session, the video of the Mentor's camera and screen (participants are not recorded) and the 30-day replay access you buy | When you buy a series or a replay access; when a Mentor records a session | Selling the series and replay access, refunds, receipts; showing the replay to those allowed to watch it | Contract. The recording is kept by our video service, Daily.co (a processor), and deleted 90 days after the session or when the Mentor deletes it [LAWYER: confirm Daily.co storage terms] |
| **Live sessions — gifts:** the email address of the person you buy a ticket for | When you buy a gift | Sending them the link to claim the seat | Legitimate interest; deleted 30 days after the session |
| **Public answers** (only if both the asker and the Mentor agree, and our team approves): the question with names, emails, phone numbers, links, @handles and long numbers removed (the asker may edit it), the Mentor's answer (the Mentor may edit it), the Mentor's name and profile. **The asker's name is never shown.** | After a 4–5★ rating, if you choose "Publish without my name" | A public library of answers | Consent of both people; either can withdraw at any time and the page is removed at once [LAWYER: confirm] |
| "Helpful" on a public answer: a random identifier your browser keeps (localStorage), stored by us only as a keyed hash | When you press "Helpful" | Counting each visitor once | Legitimate interest |
| **"Find me a mentor" requests:** email, the field in your words, the closest category, what you need, language, an optional budget, and whether it may be shown anonymously | "Find me a mentor" form (people who are not signed in confirm by email) | One email when a matching Mentor joins; anonymous counts by field on a public board (the text only if you allow it); our team sees the requests to invite Mentors | Consent (a remove link in every email); ends after 60 days or when you delete your account |
| **Security data:** a keyed hash of your IP address and of a random browser identifier (`wisecall_device` cookie), recorded at sign-up, sign-in and mentor application | Automatically | Detecting fake or duplicate accounts and applications | Legitimate interest |
| **Bot check:** when you use the sign-up, login, forgot-password, contact, waiting-list or "find me a mentor" form, Cloudflare Turnstile checks that you are a person; we send Cloudflare the check's token and your IP address and receive pass or fail | Automatically | Keeping bots and abuse out | Legitimate interest |
| **Where you came from:** the campaign (utm_source, utm_medium, utm_campaign), a Facebook or Instagram click (never its id), or the referring website's domain from your first visit ("direct" when none), and the path of the first page you opened (`wc_src` cookie), copied onto your account at sign-up, onto your questions and onto a mentor application | Automatically, unless your browser sends Do Not Track or Global Privacy Control | Counting sign-ups, applications and first questions per campaign (aggregate numbers only) | Legitimate interest [LAWYER: confirm] |
| **Wrong passwords:** a keyed hash of the email that was typed, and the time, for each wrong password | At sign-in | Pausing sign-in after 10 wrong passwords in 15 minutes and telling the account's owner | Legitimate interest (security); deleted after one day |
| Server logs: time, method, page address (never the query string), response code, duration | Every request | Running and securing the service | Legitimate interest |

### Additionally, for Mentors

| Data | Why | Legal basis |
|---|---|---|
| **ID and selfie check**, done by our identity provider [Didit — LAWYER: legal entity]. Wisecall does **not** receive or store images of your ID or your face. We store: the provider's session id, the result, the verified full name, date of birth and country (name and date of birth encrypted), and the date. From the date of birth we use only "18 or older: yes/no". | Verifying who Mentors are and that they are adults | [LAWYER: the selfie/face match is **biometric data**, a special category under the 2024 Law — explicit written consent is likely required, collected before the check starts] |
| Application: title, field, specialty tags, years of experience, story, sample answer, evidence links and what our automatic check saw on those pages (page title, whether it opened and showed your name, the website's registration date from public RDAP records) | Reviewing the application | Contract / legitimate interest |
| Licence or registration number (encrypted), issuing body, holder name, expiry date | Regulated fields | Legal obligation / legitimate interest |
| Uploaded documents (licence, diploma): encrypted, visible only to our team, every download logged | Checking qualifications | Contract / consent |
| Work email address and its confirmation | Optional "work email" badge | Consent |
| **Payout details:** account holder name and Georgian IBAN (IBAN encrypted; only the last 4 characters are kept readable) | Paying you | Contract; legal obligation (tax, accounting) |
| Earnings and payout history | Paying you, accounting | Contract; legal obligation |
| Automatic analysis of the application (scores, risk level, flags, an AI summary for our team) | Helping our team decide | Legitimate interest. [LAWYER: automated decision-making — approval can be automatic only if the operator turns on `AUTO_APPROVE` (off by default), and **no one is ever rejected automatically**. Confirm the information and the right to human review that must be given.] |
| Video interview (only if our team asks): time, result, reviewers' notes | Checking an application | Legitimate interest. [LAWYER: if calls are recorded, add consent] |
| Audit log of every decision about your application (who, when, why) | Accountability | Legitimate interest / legal obligation |

## 3. Who we share data with

We do not sell personal data. We share it only with providers who help us run Wisecall, under contracts that protect it:

| Recipient | What | Where [LAWYER/OPS: confirm] |
|---|---|---|
| Our bank: [Bank of Georgia / TBC Bank] | Amount, order id, the pages to return to; the card data you type on their page | Georgia |
| Identity provider: [Didit] | Your ID document and selfie (you send them directly to the provider) | [EU/US?] |
| Email provider: [Resend / Postmark] | Your email address and the content of the email | USA |
| AI provider: Anthropic, PBC (Claude) | The application text of Mentors and what the link check saw. **Never:** ID data, date of birth, email, phone, bank details, licence numbers or documents; emails, phone numbers and IBANs typed into the text are removed before sending. | USA |
| Hosting and database: [Render] | Everything stored by the Platform | [region — e.g. Frankfurt, EU] |
| Google | Only if you use "Continue with Google" | USA/global |
| Public RDAP registries | Only the domain name of a Mentor's evidence link | Global |
| Other users | Your public profile; Mentors see the question and the Asker's name; Askers see the answer and the Mentor's name; public reviews | — |
| Authorities | When the law requires it | Georgia |

**International transfers.** Several providers process data outside Georgia. [LAWYER: under the 2024 Law, list the legal ground for
each transfer (adequacy decision of the Personal Data Protection Service, standard contractual clauses, or consent) and sign the
providers' data-processing agreements.]

## 4. How long we keep data

| Data | Kept for |
|---|---|
| Unpaid payment attempts (cancelled, failed, timed out) | Deleted after `UNPAID_ATTEMPT_DAYS` (7) days |
| Mentors' uploaded documents | Deleted automatically 90 days after the decision on them |
| Security hashes (IP, device) | Deleted after 180 days |
| Password-reset links / email codes | 1 hour / 15 minutes, single use |
| Questions, answers, payment records, payouts | [LAWYER: accounting/tax law minimum — e.g. 6 years under the Tax Code?] |
| ID-check result, verified name/date of birth/country, licence details | While the Mentor account exists, then [LAWYER: period]. (DEV: no automatic deletion exists yet.) |
| Account and profile | Until you close the account, then [LAWYER: period]. (DEV: account deletion is manual today.) |
| Waiting list | Until you unsubscribe or [LAWYER: period] after the one email is sent |
| Server logs | [OPS: Render log retention period] |

## 5. Security

Passwords are hashed (bcrypt). IBANs, licence numbers, verified names and dates of birth, and uploaded documents are encrypted
(AES-256-GCM). The site uses HTTPS only, a strict Content-Security-Policy, and protection against cross-site request forgery. Team
members who use the admin panel must use two-step verification. Access to documents is logged.
[LAWYER: breach notification — the 2024 Law requires notifying the Personal Data Protection Service (and, in some cases, the people
affected) within 72 hours; our internal procedure is in docs/RUNBOOK.md.]

## 6. Your rights

Under the Law of Georgia on Personal Data Protection you can ask us to: tell you what data we hold about you and give you a copy;
correct it; delete it or stop processing it (where the law allows); limit its processing; receive it in a portable format; withdraw
consent at any time (this does not affect what was done before); and not be subject to a decision based only on automated processing
that significantly affects you. Write to [privacy email]. We answer within [LAWYER: 10 working days under the 2024 Law?]. You can
complain to the **Personal Data Protection Service of Georgia** (personaldata.ge).
[DEV: there is no self-service export or delete yet; requests are handled by hand — see docs/RUNBOOK.md and docs/TODO-FROM-CLOUD.md.]

## 7. Cookies

See the Cookie Notice. In short: we use cookies that are strictly necessary for the site to work and to keep it secure, and one first-party statistics
cookie (`wc_src`) that only counts which campaigns and websites bring people; no advertising cookies.

## 8. Children

Wisecall is for people aged 18 and over. We do not knowingly collect data from children. If you believe a child has an account,
write to us and we will close it.

## 9. Changes

We will publish any change here and email account holders about important changes.
