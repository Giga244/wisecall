# Finish report (docs/CLAUDE-CODE-FINISH.md)

Done on 2026-11-13. Everything below is on `main`. Before each push the unit tests, the local browser tests and the cloud browser tests were all run.

## What was fixed, by part

### Part 1: Home page fixes (`0fbd2ef`)
- **Header logo:** there is room above Jikhva's horns at 360px, 768px and 1280px, in both themes. In dark mode the logo has white letters with an outline in the page colour. The bar stays one row, at most 90px.
- **An honest example phone.** The example no longer shows a name, a "verified" badge, a title or stars:
  - it shows "ექსპერტი · მედიცინა" with a neutral icon and "პასუხი 7 დღეში" (the deadline setting);
  - "მაგალითი" sits on the phone's status bar;
  - real published answers keep their real name, badge and rating.
- **The phone animation** follows `docs/new-home/phone-animation.html` and was compared frame by frame with `phone-anim.mp4`. It shows:
  - the question typed letter by letter, with pauses after punctuation and a cursor in an input that grows;
  - the send press, the bubble popping in, "გაგზავნილია ✓", and the typing dots;
  - the answer appearing letter by letter, and the stars filling one by one (rated real answers only);
  - a fade into the next random question and answer.

  With reduced motion it shows one finished conversation, still. There are no script errors.
- **Hero:**
  - the headline fits in 2–3 lines on a desktop and 3–4 on a phone;
  - the waiting list is one row at every width, with the count line right under it;
  - the age checkbox and the privacy note form one small block;
  - the email is readable in dark mode;
  - the popular fields are one row that scrolls sideways on a phone.
- **Compared with the reference screenshots:** they match. The one difference is kept on purpose: the "16 წლის ან უფროსი ვარ" checkbox, which is the age rule.

### Part 2: Mentor texts are never cut (`b107792`, `e34a037`)
- **The cause of the cut:** the Settings profile form saved every field. An "About me" loaded while a mentor's story was half written could therefore be saved back over the whole text.
  - Now the form sends only what was changed, together with the "About me" it started from.
  - The server refuses a save that started from an older text. What was typed stays in the box.
- **No box cuts pasted text any more.** The long text boxes have no `maxlength`; a counter and the save say when a text is too long. The "About me" error message wrongly said 500 characters; the limit is 2000.
- **Cards and profile:** the Browse and home cards show the first 3 lines of the bio (2 on a phone) ending in "…", with "სრულად ნახვა →" only when it is cut. The profile shows all of it. The stored text is never shortened.
- **Irakli Laitadze:** his "შესახებ" in production is a third-person, shortened rewrite of his text. His own full text is his story (1252 characters).
  - No code of ours writes a third-person text. It came in through his own save form or a direct change to the database.
  - **The database now keeps every change of a mentor's "About me"** (migration 063: old and new text, when, and whether the site made it or a script did). It can be undone.
  - A test holds the code to the only two places that may write it.
  - **His text is restored by a command the owner runs in the Render shell.** It sets "შესახებ" to exactly his story (dry run first, then `APPLY=1`).

### Part 3: Walkthrough and polish (`50b462c`, `e34a037`)
- **How it was walked:** a crawler opened every page as a visitor, a student, a mentor and an admin, at 360px and 1280px, light and dark, in Georgian, both in launch mode and in prelaunch mode. It found no script errors, no failed requests and no page wider than the screen.
- **Fixed on the home page (phones):**
  - the search example ends in "…" instead of being cut mid-word;
  - the trust row is one item per line, so long Georgian words fit;
  - the mentor banner shows Jikhva at the top right, with a full-width button.
- **Fixed elsewhere:**
  - a mentor's dashboard opens on "კითხვები ჩემთვის", not on "you haven't asked anything yet";
  - signed-in devices read "Chrome · Windows", with no English word on the Georgian page.
- **Checked:**
  - **the 16–17 sign-up:** without the parent's consent it stops with a clear Georgian error;
  - **the ask sheet** on a phone;
  - **all 62 Georgian emails:** rendered in light and dark, with no empty value, no stray English and nothing wider than a phone;
  - **the Georgian dictionary:** no untranslated English, only brand names with Georgian endings;
  - **the 404 page and the footer's social links.**
- **Covered by the existing browser tests, all passing:** checkout in test mode, the mentor answering, the admin approving, refunds, the balance and withdrawals.
- **Not changed:** English text inside the test data (mentors' names and bios in the tests) is not part of the site.

### Part 4: Mentor summary (not built)
- The plan is in `docs/PLAN-MENTOR-SUMMARY.md`.
- Owner's decision: **not built for now**. If it is built later, it is off by default and the profile always shows the mentor's own full text.

### Part 5: Checks
- **Secret scan:** no keys or passwords in 295 commits.
- **Colours:** every colour is a token. **Contrast:** all 108 colour pairs are readable in light and dark.
- **npm audit:** found one moderate issue in `qs` (used by Express; the affected function is not used by Wisecall). It was updated within its allowed range; 0 vulnerabilities now.
- **`check:launch`:** run here against a development `.env`, it lists what production must have. The real check has to run in Render: `npm run check:launch -- --deep`.

## Test results (last full run, 2026-11-13)
| Suite | Result |
|---|---|
| Unit and cloud unit tests | 1344 / 1344 passed |
| Browser tests (local) | 301 passed, 5 skipped |
| Browser tests (cloud) | 30 / 30 passed |

## Screenshots (`docs/finish-screens/`, test data, Georgian, light theme)
| Page | 360px | 1280px |
|---|---|---|
| Home before launch | [01-home-prelaunch-360](finish-screens/01-home-prelaunch-360.jpg) | [01-home-prelaunch-1280](finish-screens/01-home-prelaunch-1280.jpg) |
| Home after launch | [02-home-launch-360](finish-screens/02-home-launch-360.jpg) | [02-home-launch-1280](finish-screens/02-home-launch-1280.jpg) |
| Browse | [03-browse-360](finish-screens/03-browse-360.jpg) | [03-browse-1280](finish-screens/03-browse-1280.jpg) |
| A mentor's profile | [04-profile-360](finish-screens/04-profile-360.jpg) | [04-profile-1280](finish-screens/04-profile-1280.jpg) |
| Asking a question | [05-ask-360](finish-screens/05-ask-360.jpg) | [05-ask-1280](finish-screens/05-ask-1280.jpg) |
| The mentor's dashboard | [06-mentor-dashboard-360](finish-screens/06-mentor-dashboard-360.jpg) | [06-mentor-dashboard-1280](finish-screens/06-mentor-dashboard-1280.jpg) |
| The admin panel | [07-admin-360](finish-screens/07-admin-360.jpg) | [07-admin-1280](finish-screens/07-admin-1280.jpg) |

## What only you can do
- [ ] **Irakli's text:** run the two Render shell commands (dry run, then `APPLY=1`), then look at his card and profile.
- [ ] **Render environment:**
  - `ANTHROPIC_API_KEY`, only if you want the AI application review;
  - Flitt's live keys (`PAYMENT_PROVIDER` and its keys);
  - Didit with credit on the account (the live balance was $0.00);
  - `RESEND_API_KEY` and `EMAIL_FROM` on your own domain.
- [ ] **Business registration and the Flitt contract.**
- [ ] **`LEGAL_NAME`, `LEGAL_ID` and `LEGAL_ADDRESS`** in Render. The Terms and receipts show them.
- [ ] **A lawyer reviews the Terms and the Privacy policy**, including the rules for 16–17 year olds.
- [ ] **8–10 approved mentors** before launch.
- [ ] **The launch check in Render:** `npm run check:launch -- --deep`. It must say READY.
- [ ] **Switching from prelaunch to launch:** set `LAUNCH_MODE=live` in Render, or leave it empty so the site opens by itself when the first mentor is listed.
- [ ] **Render's "Payment failed" banner** (billing).
- [ ] **Removing sulkhanishvilisesili@gmail.com from the waiting list** (from the admin panel).

## Not finished
- **The mentor summary (Part 4):** postponed by the owner.
- **The live site:** it was not walked after these deploys. The crawl ran against local copies (prelaunch and launch). After the deploy, open the home page on a phone and check that the phone animation plays.
