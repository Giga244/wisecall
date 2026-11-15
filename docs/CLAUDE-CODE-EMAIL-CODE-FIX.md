# Fix: mentors get stuck at the email code

**Problem (real case):** a senior lawyer with a company email (Microsoft / Outlook) applied. The code didn't come. It arrived hours later, but by then it no longer worked. He only got through by using his Gmail, which he didn't want. Company email systems often hold mail from new senders for minutes or hours. Professors and lawyers mostly use company email, so this blocks exactly the mentors we want.

**Goal:** a slow email must never block anyone. Checking the email stays required for approval. Only the order changes.

## 0. Bug to fix first: "Unknown error"
The same lawyer first verified with his Gmail. Then he tried to enter his work email instead, and the site showed **"Unknown error"**. (Most likely the work email is already tied to an unfinished account or application, or the switch isn't handled.) Find the cause in the server logs and code, fix it, and make sure no screen ever shows a raw "Unknown error": always a clear Georgian message saying what to do. Add a test for this exact case: verify with email A, then switch to email B, which already has an unverified attempt.

First, read how email verification works today (signup, the mentor apply flow, Settings) and tell me in the report. Don't change Didit, age (18+), consent, payment or privacy checks.

## 1. Check the email at the end, not the start (mentor application)
- The mentor enters their email and starts the 5 steps right away. The code is sent at that moment in the background.
- All 5 steps can be filled in and saved before the email is confirmed.
- Before "გაგზავნა" (submit), show the code box: "შეიყვანე კოდი, რომელიც {email}-ზე გამოგიგზავნეთ".
- If they still don't have it, they can submit anyway. The application gets the status "ელ-ფოსტა დასადასტურებელია". Then:
  - admin can't approve it until the email is confirmed (show this clearly on the admin card);
  - the mentor sees a banner on their dashboard with the code box and a "კოდის ხელახლა გაგზავნა" button.
- The Didit ID step stays exactly as it is.

## 2. A late code still works
- A code is valid for **24 hours**, and any of the **last 3 codes** sent to that email works (a resend doesn't kill the older code).
- Keep the attempt limits and rate limits (for example 5 wrong tries, then a short wait; resend at most once a minute).

## 3. Easy to switch email
- On the code box: "კოდი არ მოვიდა? შეამოწმე Junk / Spam საქაღალდე" and a link "სხვა ელ-ფოსტის გამოყენება".
- Switching email keeps everything already filled in. The new email gets a new code.
- In Settings, a verified user can change their account email (a code to the new email confirms it; the old email gets a short notice).

## 4. Sign in with Google
- If "Sign in with Google" already exists, show it on the mentor apply start screen too: "Google-ით გაგრძელება" (no code needed, because Google confirms the email).
- If it doesn't exist, don't build it now. List it in the report.

## 5. Admin
- On each application: email confirmed yes or no, and the last email status from Resend (sent / delivered / delayed / bounced), if the webhook is set up.
- A filter: "ელ-ფოსტა დაუდასტურებელი".

## Texts (KA / EN)
- "კოდი არ მოვიდა? შეამოწმე Junk / Spam საქაღალდე." / "No code? Check your Junk / Spam folder."
- "სხვა ელ-ფოსტის გამოყენება" / "Use another email"
- "კოდი 24 საათის განმავლობაში მოქმედებს." / "The code works for 24 hours."
- "ელ-ფოსტა დასადასტურებელია" / "Email not confirmed yet"

## Tests
- A code works after 23 hours and fails after 25.
- An older code (one of the last 3) still works after a resend.
- An application with an unconfirmed email can be submitted, but admin can't approve it.
- Switching email keeps the filled-in steps.
- The rate limits still work.
- Run all unit and e2e tests. Don't skip or delete any.

## Before pushing
Show me screenshots at 375px of: the code box before submit, the "email not confirmed" banner on the dashboard, and the admin card. Wait for my OK.

Then commit "Email codes: never block mentors" and push. Report: what changed, the test results, and anything that needs my decision.
