# The calm redesign: report

Brief: `docs/CLAUDE-CODE-REDESIGN-CALM.md`. Mockups: `docs/redesign/calm/`. Screenshots of the built site: `docs/redesign/calm/built/`
(every main page at 375px and 1280px, light and dark; the very long legal pages are cut at 6000px).

Only the look changed. No logic, route, API, database, payment or email text was changed, and every age, ID, consent and
contact-safety check is as it was.

## What changed

| Area | What it looks like now |
|---|---|
| Colours | Page `#fbfaf7`, cards white, text `#1e1a31`, soft text `#6a6580`, thin lines `#ebe7e0`, one coral for buttons, a tint `#ffe9e4` for avatar circles and behind Jikhva, green only for "verified". Dark theme: `#15121e` / `#1e1a2b`. The pastel yellow, mint, lavender and blush fills and the purple gradient are gone. |
| Shapes | 1px lines, 14px buttons and fields, 22px cards, no offset shadows. Content is 1000px wide, with 24px side padding on phones and 32px on computers. |
| Header | Logo, quiet text links, the language as one word, one coral button. On the home page the coral button is "ჩაეწერე" before launch and "იპოვე ექსპერტი" after, on phones too. |
| Footer | One line on every page: ©, six links, the Instagram, TikTok and Facebook icons. Every other link is in the menu. |
| Home | The promise and the waiting list beside Jikhva and the example card; popular fields; "როგორ მუშაობს" in one panel with three ticks; our experts; three questions that open; the dark "ექსპერტი ხარ?" block. No emoji. |
| Experts | One search box, fields as a row of tabs that scrolls, mentors as rows separated by thin lines. The field tiles (links to each field's page) are under the list. |
| Mentor profile | The person and the sections sit on the page without boxes; checks are green ticks; one white card holds the price and the question. The phone's pinned ask bar is kept. |
| Sign-up, log-in | No dark panel and no box; the benefits are a quiet list; Jikhva waves on sign-up only. |
| Dashboards, Settings | Tabs are quiet words with a coral line under the chosen one; questions are rows; an answer has a coral line beside it. |
| Information pages | "გახდი მენტორი" has no coral panel; FAQ rows are separated by lines; legal pages use the same type. |
| Empty states, 404/403/500 | Jikhva in front of the tint circle. |
| Emails | Page, soft text and link colours only. |
| Admin | Not redesigned. Checked at 375px and 1280px: readable, nothing runs off the side. |

Shared pieces added: `.open-row` / `.open-panel` (a row that opens, with a chevron that turns; used by the home page's questions),
the `--tint` and `--band` tokens.

## Where the built site differs from the mockups, and why

1. **Coral text.** The brief's `#d9482f` is 4.1:1 on the page, under the 4.5:1 rule in the same brief. It is used for the big headline
   words (large text, where 3:1 is enough); small coral links use `#c9432b` (4.7:1).
2. **Field outlines.** Email, search and form fields keep a 3:1 outline (`#8f8a9e`) so the edge of a field can be seen. Cards and
   rows use the thin `#ebe7e0` line as in the mockups.
3. **The ask flow is not a separate two-step page.** The mockup shows "ნაბიჯი 1/2" on its own page. Today the question is written
   in the card on the profile (a sheet on phones) and that is how it still works: a separate page with steps needs new routes and
   logic, which this brief does not allow. The card and the sheet have the new look.
4. **The mentor application** keeps its five steps (the mockup shows three). Changing the steps is logic.
5. **Experts tabs** are the real fields with their counts, and there is no "ყველა" tab: clearing a tab shows everybody, as before.
6. **The example card** types the question (as before), not the answer. A real answer shows the mentor's name and "გადამოწმებული";
   an example shows "მაგალითი · field" and never a name, badge or stars.
7. **The header** also has the light/dark button and "შესვლა", which the mockups leave out. The phone header's coral button is on
   the home page only: other pages cannot know before the first paint whether the site is before launch.
8. **The footer** has six links (the mockup's four, plus კონტაქტი and კონფიდენციალურობა) and the contact email, and, when set, the
   seller's legal details and the card logos under the line.
9. **The privacy link** sits beside the "16 წლის ან უფროსი ვარ" box rather than on the count line, so it still shows while the
   count is hidden (under 50 people).

## Texts that changed (looks only, no rule changed)

- The note under the header before launch is one short line: "Wisecall მალე იხსნება." and the link to the waiting list.
- Home: the step lines are the mockup's short ones ("დეტალურად, ზარების გარეშე"); three ticks; "ხშირი კითხვები" with three questions.
  The answer to "უსაფრთხოა 16–17 წლისთვის?" is new text, written from the site's existing rules. **Please read it.**
- Emoji were removed from the interface texts (the pill, the count, the pinned button, the stars).

## Tests

All suites were run locally before each push (GitHub runs only the unit tests on a push).

| Push | Unit | Browser | Cloud |
|---|---|---|---|
| Step 1 (shared look, home, experts) | 1346 / 1346 | 305 passed, 5 skipped | 30 / 30 |
| Mentor profile and the ask flow | 1346 / 1346 | 305 passed, 5 skipped | 30 / 30 |
| The rest (sign-up and log-in, dashboards and Settings, information pages, empty states and error pages, email colours, screenshots) | 1345 / 1346 | 305 passed, 5 skipped | 30 / 30 |

The one unit failure in the last run was the project's own "no gradients" rule: the tint circle behind Jikhva on empty states was
drawn with a gradient. It is now a plain round fill, and that test, the colour tests and the browser specs for the pages it touches
(97 browser tests) were run again and pass. The full suites were not run a second time after that two-line fix.

An earlier run on the sign-up commit had two failures in `tests/cloud-2/two-factor.test.js` (the admin's second sign-in step) and
one in the Google button test. The Google button now keeps Google's own outline. The two-factor tests passed in the next full run
without any change, so they look flaky rather than broken; they are worth watching.

Tests that checked the old look were updated to check the new one (colour values, the footer, the home page's sections, the header's
logo size, the experts rows). None was deleted or skipped. `npm run check:colors` and `check:contrast` pass; `check:contrast` no
longer requires 3:1 of the thin decorative line, and now checks the outlined button instead.

## Needs your decision

1. The answer text of "უსაფრთხოა 16–17 წლისთვის?" (KA and EN): confirm or reword.
2. A separate two-step ask page, and a three-step application, as in the mockups: these are logic changes. Say if you want them.
3. Coral text `#c9432b` instead of `#d9482f` for small links, and the 3:1 field outline: keep, or follow the mockup exactly.
4. The field tiles under the experts list: keep them there, or remove them (they are the only links to each field's own page).
5. The old three directions in `docs/redesign/directions/` were never committed and are not used: delete the folder?

## Still open from before

The launch items in `docs/TODO-OWNER.md` and `docs/FINISH-REPORT.md` are unchanged by this work.
