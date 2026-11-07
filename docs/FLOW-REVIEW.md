# Student–mentor flow: screenshots and review

Brief: `docs/CLAUDE-CODE-FLOW-SCREENS.md`. Screens: `docs/flow-screens/` (`01`–`36`, plus `sheet.jpg`). Taken 2026-11-08. No code was changed for this review.

## How the screens were taken

- **Data:** a fresh local database (`wisecall_flow`), never the production database or real users. The test users were:
  - Luka, a 17-year-old student, signed up in the browser with the parent box ticked.
  - Ana, a 20-year-old student.
  - Giorgi, an approved free mentor (IT).
  - Nino, an approved paid mentor at 15 ₾ (IELTS).
  - Levan, a dentist at 25 ₾, so that a search for "სტომატ" has a result.
  - An admin.
- **Mode:** launch mode (`LAUNCH_MODE=live`), the fake ID check, and emails written to a file.
- **Payments:** the site's own test bank page (`mock-bank.html`). There are no Flitt test keys locally, so the real Flitt checkout page is not in these screens.
- **Format:** 375px, Georgian, light theme, plus 4 screens at 1280px.
- **Live sessions:** they were on in this local run, so the "ცოცხალი სესიები" tab and the profile's "გამოწერა" button appear. Live sessions are off in production.
- **Emails:** shown as the HTML the server sent, opened at 375px.
- **Full-page artifacts:** each screenshot is the whole page, which causes two artifacts:
  - A sticky element (the profile's bottom "დასვი კითხვა" bar, the header) can appear in the middle of the picture.
  - Parts that appear on scroll can show as blank. The home page's example answer and the field tiles (01, 33) are the main case. I checked both in a real 375px window: they appear as you scroll. So they are not counted as problems below.

## Step by step

| # | Step | Screens | What works | What looks unfinished or confusing |
|---|---|---|---|---|
| 1 | Home as a visitor | 01, 33 | Clear headline and promise ("payment per question, answer in 7 days or full refund"). The search box, the chips and the example answer work. | The dark "ვიპოვო ჩემი ადამიანი" button looks disabled (dark grey) until you type. |
| 2 | Browse | 02, 03, 04 | 6 field tiles plus "all 16 fields". A search for "IELTS" finds Nino, and "სტომატ" finds the dentist. The cards show checks, price and the "რჩევის თხოვნა" button. | The field chips keep their counts while you search (with "IELTS" typed, "მედიცინა 1" still shows). |
| 3 | Mentor's public profile | 05, 34 | Checks explained, an "about" section, stats, an empty reviews state that invites a first review, and a sticky ask bar on the phone. | The orange "გამოწერა" (follow) button looks as important as "დასვი კითხვა", and its line talks about live sessions. On the phone the breadcrumb takes 3 lines. |
| 4 | Sign-up, 17-year-old | 06, 07, 08 | The birth year and month appear, and the parent box with its line for parents appears at 17. The code email arrives and the code page is clear. The empty dashboard has a good empty state with a button. | The month list shows "ოქტომბერ" (cut). The password box has a red border while you type, so it looks like an error. A minor is shown "your profile link" (`/u/luka-kapanadze`) although minors' profiles are private. On the code page, "ელფოსტის შეცვლა" is an unstyled browser button. The line under "დადასტურება" ("არ მოვიდა? შეამოწმე Spam…") starts under the button's shadow, the same bug fixed for the ID card in 0ffa228. |
| 5 | Question to the free mentor | 09, 10, 11 | "უფასოდ" is big. There is a writing tip, a length counter, and the phone number is stopped with a clear Georgian message while the text stays. | The success sheet is only "კითხვა გაგზავნილია!" and a small link. It doesn't say what happens next: when the mentor answers, that an email will come, or (for a minor) that the answer is checked first. |
| 6 | Paid question → test bank → sent | 12, 13, 14 | The price is on the button ("გადაიხადე 15 ₾ და იკითხე"). Two trust lines: refund if no answer in 7 days, and the card is entered on the bank's page. | "ფასდაკლების კოდი" looks like plain text, not like something to tap. After paying 15 ₾, the same bare "კითხვა გაგზავნილია!" sheet appears, with no amount, receipt, deadline or next step. |
| 7 | Student dashboard, waiting | 15, 35 | A clear timeline (paid → waiting → answered → rated), the 7-day countdown with its date, the receipt number and "საუბარი". | The big "გახდი მენტორი" banner sits above the student's own question. At 1280px it repeats the header's "გახდი მენტორი" button. |
| 8 | Mentor's new-question email | 16, 17 | The question is quoted, the 7-day rule is stated, and there is one button. | For a 16–17-year-old's question the email doesn't say so (the tag appears only on the site). The paid email says "15.00 GEL", while the site says "15 ₾". |
| 9 | Mentor dashboard: the minor's question | 18, 36 | "16–17 წლის" tag, first name only, clear guidance for minors, the deadline, and the answer formula and checklist. | On the phone the question starts about 1,250px down. Above it come the price block, 4 tabs on 2–3 rows, the "your profile link" card and a loose "როგორ დავწეროთ კარგი პასუხი" line. Then 3 boxes of guidance stand between the question and the answer box. |
| 10 | Writing the answer | 19, 20, 21, 22 | A counter with a hint, a "check before sending" step with "you can't change it after sending", the contact block, and a clear "being checked" status afterwards. | The check step (20) doesn't flag the contact detail. It is refused only on "send" (21), and the message doesn't say what was found (`@giorgi_dev` / Telegram), so the mentor has to guess what to delete. The counter "362 / 8000" breaks onto 2 lines. |
| 11 | Admin: held answer → one tap | 23, 24 | The held card shows "18 წლამდე", the question and the answer, and says "never released automatically". Approve takes one tap and confirms with a toast. | The section's intro says held answers are "released automatically after 24 hours", which is wrong for minors (the card itself says never). The reason field's placeholder is cut. The empty "შეტყობინებები კითხვებზე (0)" says "ღია საჩივრები არ არის" (the disputes text). |
| 12 | Email "your answer has arrived" | 25 | The answer is in the email, with one button and a nudge to rate. | The subject and body say "გიორგი ხარაზი-მ უპასუხა" (a name with a hyphenated case ending), which reads machine-made in Georgian. |
| 13 | Read, rate, report | 26, 27, 35 | The answer is clear. The double-blind rating is explained. The report form has reasons and a promise that the mentor won't know. | The empty stars are very faint. "შეტყობინება" appears twice (a small summary, then a heading "პასუხთან დაკავშირებით პრობლემის შეტყობინება"). The reason list is cut on the phone ("ითხოვს ან აზიარებს კონტაქ…"). A 17-year-old is told the review will be public "with your name and photo". |
| 14 | Refund after 7 days | 28, 29 | The card says "თანხა დაბრუნებულია" and why. The refund email explains why and says 5–10 working days. | Neither the card nor the email offers a next step (ask another mentor, or find one in the same field). The student gets 2 emails for the refund (the "money returned" notice and a separate receipt R-000003 whose subject just says "ქვითარი"). There is a stray "·" after "ქვითარი R-000002". |
| 15 | Mentor earnings | 30 | Available / on hold / paid out, and when the 12 ₾ becomes available. Per-question lines and monthly statements (PDF, CSV). | The 100 ₾ minimum for a withdrawal isn't shown anywhere. The 80% share isn't explained (12 ₾ of 15 ₾ appears without the word). Two dates for the same money: "14 ნოემბერი" in the balance box and "15 ნოემბერიდან" in the list. The price block is again at the top of this tab. |
| 16 | Mentor edits price and details | 31, 32 | Price on the dashboard and in Settings, with "free" as one switch, and "old questions keep the old price". "Saved at once" and "checked first" are separated clearly. | On the phone, the page's three forms each have a sticky "შენახვა" / "შესამოწმებლად გაგზავნა" button that floats over the next fields (checked in a real 375px window). The bottom of the "Specializations" field, "ახლანდელი პოზიცია" and "მთავარი სფერო" end up under a button. Settings has 7 tabs on 4 rows. |

## Problems, worst first

1. **The mentor has to scroll past everything to reach the new question (9, 15).**
   - On the phone the question starts about 1,250px down. In front of it are the price block, the tabs, the profile-link card and three guidance boxes.
   - A mentor comes here from the "new question" email to answer, and at 375px they can easily miss it or give up.
   - The price block also sits on top of every dashboard tab.
2. **"ჩემი მონაცემები" on the phone: the Save buttons cover the fields (16).**
   - Three sticky buttons float over the next form's fields while scrolling.
   - It's unclear which button saves what, and a field can't be seen while typing.
3. **A minor isn't told that the answer is checked before they can read it (5, 7).**
   - The ask form promises "the mentor answers in 7 days".
   - A held answer to a minor has no automatic release, so the wait can be much longer.
   - The student learns this only from a note after the mentor has answered.
4. **The "question sent" screen is a dead end, also after paying 15 ₾ (5, 6).**
   - It shows only "კითხვა გაგზავნილია!".
   - It has no amount or receipt, no deadline, no "we'll email you", and no word about the check for minors.
5. **The contact-detail refusal doesn't say what was found (10).**
   - The check-before-send step lets the answer through. Then "send" refuses it with a general message.
   - The mentor has to guess what to remove (here a Telegram handle).
6. **Earnings don't explain the money rules (15).**
   - The 100 ₾ withdrawal minimum is missing.
   - The 80% share isn't named.
   - The "available from" date differs by a day between two places.
7. **The refund has no next step (14).** The card and the email stop at "money returned". A student who wanted an answer has no "ask another mentor" link.
8. **What a minor is told about their review being public (13).** A 17-year-old reads that their review will be public "with your name and photo", while minors' profiles are private. The wording, or the behaviour, needs checking.
9. **Georgian that reads machine-made in emails (12, 14, 8).**
   - "გიორგი ხარაზი-მ უპასუხა" and "ნინო გელაშვილი-სთვის" are a name plus a hyphenated case ending.
   - Emails say "15.00 GEL" while the site says "15 ₾".
   - These are the first emails a real user reads.
10. **Sign-up and code page details (4).**
    - The month name is cut.
    - The password box is red while typing.
    - "Your profile link" is shown to a minor.
    - "ელფოსტის შეცვლა" is an unstyled browser button.
    - The help line under "დადასტურება" starts under the button's shadow.
11. **Report entry points (13).** "შეტყობინება" appears twice on one card, and the reason list is cut at 375px.
12. **Admin texts (11).**
    - The held-answers intro promises a 24-hour automatic release that never happens for minors.
    - The empty "reports on questions" box uses the disputes text.
    - A placeholder is cut.
13. **The mentor's email doesn't mark a 16–17-year-old's question (8).** The mentor sees the tag only on the site.
14. **"Become a mentor" above the student's own questions (7).** It pushes the paid question down on the phone and repeats the header button at 1280px.
15. **Small things:**
    - The empty stars are hard to see (13).
    - "ფასდაკლების კოდი" doesn't look tappable (6).
    - The field chips keep their counts during a search (2).
    - The "გამოწერა" button competes with "დასვი კითხვა" on the profile (3).
    - The answer counter wraps onto 2 lines (10).
    - There is a stray "·" after the receipt number (14).

**Checked and fine:**
- **No English left in the Georgian UI on these screens.** "Senior", "IELTS" and "Python" are the users' own words. "GEL" is listed above.
- **Every step of the journey could be completed** (the capture script ran all 16 steps without a failure). Links and horizontal scrolling were not measured separately.
- **The empty states have text and a next step:** the empty dashboard, a profile with no reviews, and the admin's empty sections (except the wrong text noted above).
