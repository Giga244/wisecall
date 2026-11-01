# Plan: askers 16+, mentors stay 18+

Brief: `docs/CLAUDE-CODE-ASKERS-16-PLUS.md`. Nothing in the mentor apply flow, the ID check (Didit, 18+, name match), the review steps, prices, the 80/20 split, refunds or Flitt changes.

## What already exists

- **Age:** one "I'm 18 or older" box on the sign-up form and on the Google page (`users.adult_confirmed_at`). The real 18+ check for mentors is the `age` step from the ID.
- **Google:** the account is created in the callback, before the person is asked anything.
- **Waiting list:** email, field, language, optional question. No age question.
- **Asking:** `POST /api/bookings` checks for an emergency first, then prelaunch, then the question's length. Free questions go through `server/freeQuestions.js`, paid ones to the bank.
- **Contact filter:** `server/textSafety.js` already refuses contact details in Inbox follow-ups and logs them (`blocked_messages`). Questions and answers have no check at all.
- **Hold before the asker sees an answer:** probation (`server/probation.js`): a mentor's first answers wait for an admin, and are released automatically after the check window. The payout hold starts at release. The queue and one-tap approve are in the admin Review queue.
- **Reports:** "report this mentor" (`mentor_reports`, two reporters flag the mentor), reports on Inbox messages, disputes (these hold money). Nothing for a mentor to report a question.
- **Suspending a mentor:** `verification/review.js suspend` (refunds their open questions, as it does today).
- **Launch date:** not stored anywhere.

## What I'll change

1. **Age at signup.** New `server/ageGate.js` and `users.birth_ym`, `age_group`, `age_confirmed_at`.
   - The sign-up form asks birth year and month. Under 16: refused before anything is written.
   - Google: the new person's details wait in a short-lived signed cookie, and the account is created only after the new `/age-check.html` page. Under 16 clears the cookie, so nothing is stored.
   - Existing accounts: `/age-check.html` once, at next login, and the server refuses a question until it's answered.
   - Becoming a mentor under 18 is refused by the server.
   - The waiting list needs "I am 16 or older".
2. **Parent permission.** A required box for 16–17 with a short line for parents, stored as `parent_permission_at`. No parent email anywhere.
3. **Payments for minors.** Free questions as normal. A paid question needs `adultPayer: true` from a minor, stored as `bookings.adult_payer_confirmed_at`. Nothing about the price or the bank changes.
4. **Contact filter.** New `findBlockedContact(text, { strict })` for questions, answers and follow-ups, logged in `contact_blocks` as kinds and counts, never the text.
5. **Mentor view.** `bookings.asker_minor` is fixed when the question is asked. Mentors get the "16–17" tag and guidance. For a minor they see the first name only, with no photo, username or profile link. Minors' profiles open only to themselves and admins.
6. **Reports and admin.**
   - The report button on answers uses the existing `mentor_reports`, so the two-reporter flag keeps working. New `question_reports` covers questions.
   - Answers to minors are held with no automatic release for 3 months from the first day the site is live, with a 24-hour reminder.
   - New admin tab "Safety": minor filter, permission time, blocked counts, and an "unsafe" flag that uses the existing suspend.
7. **Legal and analytics.** Terms and Privacy in KA and EN, `docs/TODO-OWNER.md`, and `age_group` on the `signup` event only.

## Decisions the brief leaves open

- **Birthdays with month precision.** A person counts as a given age only once the whole birth month has passed. So someone born in November 2010 counts as 16 from 1 December 2026, and turns adult the same way. This never treats a minor as older than they might be.
- **What "strict" means.**
  - Everywhere: phone numbers, email addresses, @handles, social and messenger links, an invitation to use a messenger, and "call me / write to me / number" with 3 or more digits.
  - Only when the asker is a minor, on top of that: naming a messenger at all (Telegram, Viber...), naming an email provider, shorter phone numbers, and numbers spelled out in words.
  - Naming Instagram or LinkedIn stays allowed for everyone, because "how do I work in TikTok marketing" is a real career question. Links to them are blocked for everyone.
  - Other public links (articles, university pages) are allowed in answers to everyone.
- **Which age counts on a question.** The age when the question was asked, so someone who turns 18 mid-question keeps the same handling for that question.
- **Existing account that says under 16.** Nothing is stored and they can't ask. The account isn't touched, because existing accounts must not break.
- **Age can't be changed by the user**, so a minor can't switch to adult later. An admin can clear a wrong entry, and the person is asked again.
- **Minors and public answers.** No offer to publish a minor's question. The brief doesn't ask for this, but a minor's words shouldn't become a public page.

## Risks

- **Self-declared age.** A 15-year-old can type another year. The brief accepts this; the Terms say so and a parent can ask us to close the account.
- **Held answers depend on the admin.** Nothing is released without a person, and the mentor's payout hold starts at release (the existing rule for held answers). The reminder repeats every 24 hours. Rejecting a held answer refunds the asker, as it does today.
- **The mentor's 7-day deadline** is met when they answer. A held answer stays "answered", so the overdue-refund sweep can't touch it. A test covers this.
- **"Unsafe" refunds open questions**, because it uses the existing suspend. That's not a new money rule, but the admin should know before pressing it.
- **Contact filter false positives.** Mainly code in tech answers (`@Override`) and years ("2023 2024 2025"), which are handled and tested. It can't catch everything, such as a number split across sentences.
- **Live sessions are off in production.** They have no age rule for minors. Decide this before ever turning them on (added to `docs/TODO-OWNER.md`).
- **Migrations** are additive: new nullable columns and new tables, each with a down file. No existing row changes.
- **Legal text** isn't reviewed by a lawyer yet (added to `docs/TODO-OWNER.md`).
