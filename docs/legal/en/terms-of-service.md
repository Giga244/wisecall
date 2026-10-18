# Wisecall — Terms of Service

> **DRAFT FOR LAWYER REVIEW. Not legal advice. Not yet in force.**
> Based on what the Wisecall software does at commit `2b99ada` (September 2026). Every point marked **[LAWYER: …]** needs a decision
> by a Georgian lawyer. Numbers in `code font` are settings in the software; if a setting changes, this text must change too.

**Version:** draft 1 · **Last updated:** [date]

## 1. Who we are

Wisecall ("**Wisecall**", "**we**", "**us**") runs the website wisecallge.ge (the "**Platform**"). The Platform is operated by
[LAWYER: full legal name of the company or individual entrepreneur], identification code [LAWYER: ID code], registered address
[LAWYER: address], Georgia. Contact: [support email] (the address in `SUPPORT_EMAIL`).

## 2. What Wisecall is

2.1. Wisecall is an online marketplace where a person (an "**Asker**") pays to send one written question to an independent expert
(a "**Mentor**") and receives one written answer.

2.2. Wisecall is **not** a party to the advice. The Mentor alone is responsible for the content of the answer. Wisecall provides the
Platform, checks Mentors before listing them (section 6), collects the payment, and pays the Mentor their share.
[LAWYER: confirm this "marketplace/intermediary" position, and whether Wisecall acts as a commercial agent of the Mentor for
collecting payments under Georgian civil law and National Bank of Georgia payment-services rules.]

2.3. **Answers are not professional advice.** An answer is general information from one person's experience. It is not medical,
legal, financial, tax, psychological or any other professional advice, it does not create a doctor–patient, lawyer–client or
similar relationship, and it is not a substitute for an in-person consultation with a licensed professional. In an emergency, call
**112**. [LAWYER: confirm this is sufficient for regulated fields — medicine, law, finance — or whether those fields need extra
restrictions.]

## 3. Accounts

3.1. You must be **18 or older** to create an account. By creating one you confirm that you are.
[LAWYER: the software checks the age of Mentors from their ID (section 6) but does not check the age of Askers. Confirm that a
declaration is enough for Askers.]

3.2. You can sign up with an email address and password, or with Google. We send a 6-digit code to confirm your email address.
Keep your password secret; you are responsible for what happens in your account.

3.3. One person, one account. Do not create accounts for other people, share an account, or use a false name. Mentors must use
their real name (it is compared with their ID).

3.4. **Profiles.** Every account has a profile page at `wisecallge.ge/u/<username>`. You choose who can see it in Settings
("everyone" or "only people I have had a question with"). A listed Mentor's profile is always public.
[LAWYER: today the default for new Askers is "everyone" (public). Confirm this is acceptable, or change the default — see
docs/AUDIT.md #10.]

## 4. Asking a question (for Askers)

4.1. **Price.** Each Mentor sets their own price per question, a whole number of lari between `PRICE_MIN` 5 ₾ and `PRICE_MAX`
2 000 ₾. The price shown on the Mentor's profile is the full price you pay. [LAWYER: VAT — is the price shown VAT-inclusive, and
who issues the invoice/receipt?]

4.2. **Your question** must be at least 50 characters and at most 4 000 characters long, in your own words, and must not contain
anything illegal, threatening, or other people's personal data without their permission.

4.3. **Payment.** You pay by card on the secure payment page of our bank ([Bank of Georgia / TBC Bank]). Wisecall never sees or
stores your card number. Your question is sent to the Mentor **only after the bank confirms the payment**. If you cancel on the
bank's page, or the payment fails or is not finished within `PAYMENT_TTL_MINUTES` (30 minutes), nothing is charged and the unpaid
attempt is deleted after 7 days.

4.4. **The answer.** The Mentor has **`ANSWER_DEADLINE_DAYS` (7) days** from the moment the payment is confirmed to answer. Each
question gets **one** answer; it cannot be edited afterwards. An answer must be at least 150 characters of real writing.

4.5. **New Mentors' first answers.** The first `probationAnswers` (5) answers of every new Mentor are checked by our team before you
can read them. This can add up to `probationHoldHours` (24) hours. If our team rejects such an answer, you get a full refund.

4.6. **Refunds** are described in the Refund Policy, which is part of these Terms. In short: no answer within 7 days → automatic
full refund; after an answer, a refund only in the cases listed there.

4.7. **Consumer rights.** [LAWYER: Law of Georgia on the Protection of Consumer Rights (2022) — the 14-day right of withdrawal for
distance contracts and its exception for digital services fully performed with the consumer's prior consent. The software sends the
question to the Mentor immediately after payment; decide what consent wording the question form needs, and whether an Asker may
withdraw before the Mentor starts writing.]

## 5. Ratings, reviews and reports

5.1. After an answer, the Asker can rate the Mentor (1–5 stars, tags, an optional written review) and the Mentor can rate the Asker
(stars, tags, an optional private note that only our team sees). Neither person sees the other's rating until both have rated or
7 days have passed since the answer became readable. A review can be changed until it becomes visible.

5.2. Public reviews show the reviewer's name and photo, or "Anonymous asker" if the reviewer's profile is not public. A Mentor may
reply publicly once.

5.3. We hide reviews that contain insults, threats, personal data, advertising or claims we know are untrue. We do not hide a review
only because it is negative. Do not ask for, pay for or trade ratings, or pressure anyone to change one.

5.4. Anyone signed in can report a Mentor or a review. Reports go to our team. Two or more open reports about the same Mentor flag
them for review.

## 6. Mentors

6.1. Mentors are **independent**. They are not Wisecall's employees or agents. The Mentor Agreement (a separate document) sets out
the Mentor's rights and duties, including the platform fee and payouts, and is part of these Terms for Mentors.

6.2. **Verification.** Before a Mentor is listed, they must: confirm their email; pass an ID and selfie check with our identity
provider; be 18 or older according to that ID; have a profile name that matches the ID; submit an application describing their
experience with at least one piece of evidence; and, in regulated fields, give a licence or registration number that our team checks.
Part of the review is automatic (including an AI model that advises our team), but **every rejection is made by a person**, with a
reason, and the Mentor can apply again. A Mentor is listed only after approval **and** after saving payout details.

6.3. We can take a Mentor off the Platform, and refund their open questions, if a verification step later fails, a report is upheld,
a licence expires, or they break these Terms.

6.4. Mentors reply to the free follow-up question within 3 days.

## 7. Rules for everyone

You must not: use the Platform for anything illegal; harass, threaten or deceive anyone; post someone else's personal data; send
spam or advertising; ask for or offer payment or contact outside Wisecall to avoid the Platform; copy or resell answers in bulk;
scrape the Platform; test its security without our written permission; or try to get around its limits.

## 8. Content and licences

8.1. You keep the rights to what you write. You give Wisecall a non-exclusive, royalty-free licence to store, display and process
it as needed to run the Platform (for example, to show a review on a profile, or to check an application).

8.2. The Asker may use the answer they paid for for their own personal purposes. [LAWYER: confirm who owns the answer and what the
Asker may do with it.]

8.3. Examples on our home page are labelled "Example" and are not real answers.

## 9. Suspension and closing an account

9.1. We may suspend or close an account that breaks these Terms, with a reason, and refund any open questions of a suspended Mentor.

9.2. You can ask us to close your account at any time by writing to [support email]. [LAWYER + DEV: there is no self-service
"delete my account" button yet; decide what is deleted and what must be kept (payment and tax records) — see the Privacy Policy.]

## 10. Liability

10.1. The Platform is provided "as is". We work to keep it available but do not promise it will always be.

10.2. Wisecall is not responsible for the content of Mentors' answers or for decisions you make based on them.

10.3. To the extent the law allows, Wisecall's total liability to you for any question is limited to the price you paid for that
question. Nothing in these Terms limits liability that cannot be limited by law (for example for intent or gross negligence, or
consumers' statutory rights). [LAWYER: confirm enforceability under the Civil Code of Georgia and consumer-protection law.]

## 11. Changes

We may change these Terms. We will show the new version on the Platform and, for important changes, email you at least
[LAWYER: 14/30] days before they apply. Questions already paid for continue under the Terms in force when they were paid.

## 12. Law and disputes

These Terms are governed by the laws of Georgia. Disputes go to the courts of Tbilisi, Georgia, except where consumer law gives you
the right to go to another court. Before going to court, please write to us: we answer within [LAWYER: 14] days.
[LAWYER: mention the consumer-dispute / mediation options available in Georgia, if any.]

## 13. Language

These Terms are available in Georgian and English. If they differ, the [LAWYER: Georgian] version prevails.

## 14. Live sessions

[LAWYER: new section for live sessions; please review together with the Mentor Agreement section 11.]

- **What it is.** A Mentor may host a paid live video session (a "Live Q&A", a "Workshop" or a "Small circle"). A ticket gives one person a
  place in that session. Wisecall sells the ticket on the Mentor's behalf, as it does for questions.
- **Paying.** A seat is held for 15 minutes while you pay. The ticket is yours only when the bank confirms the payment.
- **Joining.** You join through the session page from 10 minutes before the start, with your camera and microphone off. In a Live Q&A or a
  Workshop you speak only if the Mentor lets you; in a Small circle everyone can. Other participants see your first name, or "Guest" if you
  choose to join anonymously; questions you write are shown without your name.
- **Refunds.** You can cancel up to 24 hours before the start for a full refund (or until the start if the Mentor moved the time after you
  bought). Everybody is refunded in full, automatically, if the Mentor cancels, if fewer people than the Mentor's minimum have bought a
  ticket 6 hours before the start, if the Mentor does not join within 15 minutes of the start, if the session runs for less than half of
  the planned time, or if Wisecall ends it for a safety reason. **If you do not attend, the ticket is not refunded.** If a session that
  took place was clearly not as described, you can report it within the dispute period and Wisecall decides on a full, partial or no
  refund.
- **Waiting list.** When a session is sold out you can join its waiting list. A seat that frees up is offered to the first person
  waiting and kept for them for 2 hours (or until the start); if they do not buy it, it is offered to the next person.
- **Gifts.** You can buy a ticket for another person by giving their email address, which you confirm you may share with us for this
  purpose. They claim the seat with a one-time link and a Wisecall account. Until the gift is claimed you may cancel it under the rules
  above; after that the person who holds it may. Any refund goes back to the card that paid.
- **Ratings and discount codes.** If you attended, you may rate the session; the rules for reviews apply. You may also receive a
  one-time code for a discount on a personal question to the same Mentor. A code is personal, works once, cannot be exchanged for money
  and expires on the date shown; if the question it was used for is refunded or never paid, the code can be used again until it expires.
- **Series.** A Mentor may sell several sessions together for one price. The payment gives you a place in each session; each session
  carries a share of the price (in proportion to its normal price). If a session is cancelled, or you cancel it under the rules above,
  that session's share is refunded.
- **Replays.** A session that will be recorded says so before you buy and before you join. Only the Mentor's video and screen are
  recorded; written questions are not, and other participants cannot speak in a recorded session. Ticket holders may watch the replay
  for 30 days after the session; others may buy 30 days of access. If the replay is deleted while your access is running, the access you
  paid for is refunded in full. Replays are for personal viewing only: do not download, copy or share them.
- **Not professional advice.** Sessions in medicine, psychology, law, finance and other regulated fields are educational talks and Q&A,
  not a consultation, diagnosis or therapy. If you are in danger or in crisis, call 112.
- **No recording.** Wisecall does not record live sessions. Do not record, copy or share a session or its participants without their consent.
- **Conduct.** The rules for questions and messages apply. The Mentor can mute or remove a participant who breaks them; Wisecall can end
  a session at once.
