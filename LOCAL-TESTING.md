# Testing the whole booking flow by hand, on your own computer

Everything here is for your own computer. Nothing in it changes what the site does when it is deployed: the fake bank, the fake ID
check, the codes on screen and the fast-forward tool do not exist when `NODE_ENV=production`.

## What your `.env` says now

| Setting | Value | Why |
|---|---|---|
| `ADMIN_EMAILS` | `test.admin@example.com` | the admin account (there is no second factor for admins in this version: nothing to set up) |
| `LAUNCH_MODE` | `live` | buyers can pay on this computer. On the real site it stays `prelaunch` until you say otherwise |
| `SUPPORT_EMAIL` | `support@wisecall.test` | a placeholder public address, so there is no missing-address warning |
| `RESEND_API_KEY` | commented out with `#` | email is off locally, so **codes and reset links appear on the screen** (remove the `#` to send real email again) |
| `PAYMENT_PROVIDER`, `KYC_PROVIDER` | not set (= `mock`) | the fake bank page and the fake ID check |

The values that were there before (`ADMIN_EMAILS`, the Resend key) are kept in comment lines in `.env`.
After changing `.env`, restart the server: stop it (Ctrl+C) and run `npm start`, then open <http://localhost:4242>.

## The accounts and the steps

Use any password of 8+ characters (for example `test-pass-12345`). The addresses do not have to exist. Old test accounts may already be
in your local database, so use these new ones.

1. **Admin: `test.admin@example.com`.** Sign up. On the next page a box says "…here's your code directly (dev mode only): 123456": type
   that code. You land on the dashboard and an **Admin** button appears in the header. `/admin.html` is the panel.
2. **Mentor: `mentor.one@example.com`** (name `Mentor One`).
   - Sign up and confirm with the code on the screen.
   - Settings → **Mentor** tab: become a mentor. Role title, Field **Design**, a price (say 25), a proof link (any `https://` address),
     and a sample answer of at least 80 characters. Save.
   - Settings → **Verification** tab: **ID check** → the fake ID-check page: type the name exactly as on the account (`Mentor One`),
     Result **Approved**, *Finish the ID check*. Then **Portfolio**: any `https://` address, Save.
   - Settings → **Payouts** tab: account holder `Mentor One`, IBAN `GE29NB0000000101904917`, Save.
3. **Admin approves every step.** As the admin: `/admin.html` → **Mentor applications** → *Pending* → open the mentor's card →
   *Review application*. The email, the ID check and the name match pass by themselves. For **Sample answer**, **Proof link** and
   **Portfolio**, write a reason (5+ characters) and press **Pass**. When every step is green press **Approve**. The mentor now appears in
   **Browse experts** (the site is `live`).
4. **Asker: `asker.one@example.com`.** Sign up, confirm with the on-screen code, find the mentor in Browse (or `/u/<username>`), write
   a question and press the ask button. You are sent to the **fake bank page**, which offers three choices:
   - **Cancel** and **Simulate a failed payment**: nothing is charged and no paid question exists; the question form comes back. Try both.
   - **Pay**: the question is paid (on the real site the mentor is emailed; locally no email is sent).
5. **The mentor answers.** As the mentor: Dashboard → **Questions for me** → write the answer. A new mentor's first 5 answers are held for
   a check: the asker cannot read it yet (admin **Review queue** → approve, or use the fast-forward below).
6. **Ratings.** The asker rates the mentor and the mentor rates the asker (Dashboard). Nothing is visible to the other person until both
   have rated, or 7 days after the answer became readable.

## Fast-forward (development only)

In **Admin → Bookings and refunds** every question has a **Development only** row: a number of days (7 by default) and a
**Fast-forward** button. It moves that one question's clock forward, then runs the checks the server runs by itself every few minutes.
A message at the bottom says what changed. Use the tabs *Paid — awaiting answer* / *Answered* / … to find the question.

| To test | Do this |
|---|---|
| The automatic refund after 7 days without an answer | Ask and **Pay**, do not answer. Fast-forward **7**. The question becomes *Refunded*; the asker's dashboard says so |
| A held answer being released | The mentor answers (first answers are held). Fast-forward (any number of days, 1 is enough): the asker can read it |
| The ratings being revealed | After one or both rate, Fast-forward **7**: both ratings are visible |
| The payout | After the answer is released, Fast-forward **7**: **Admin → Payouts** shows the mentor with an amount to pay. Type a reference and press **Mark as paid** |
| A refund by an admin | **Bookings and refunds** → *Paid — awaiting answer* or *Answered* → **Refund in full** |
| Suspending a mentor | **Mentor applications** → *Verified* → the mentor → *Suspend now* (a reason). Their open questions are refunded |

If you restart the server in the middle of a flow, the fake bank forgets unpaid orders and the fake ID check forgets open sessions
("This test session does not exist"). Just start that step again.

## Not built yet

These are not in the site, so there is nothing to test: the asker's one free follow-up, a mentor **declining** a question (with a
refund), and a **dispute** opened by the asker (an admin can still refund any question by hand, as above). They belong to the next round of work.

## Checks that run by themselves

`npm test` (unit tests against a separate test database), `npx playwright test` (the same flows in a real browser; `e2e/dev-setup.spec.js`
runs a server with exactly the settings above and signs up as `test.admin@example.com`), `npm run check:launch` (what is still missing for a live site).
