# Expert cards: guards so a card is never broken or empty

Earlier cards showed a family sentence (from „ჩემი გზა“), nothing at all (no About), and "FInance". Three guards now.

## 1. The mentor's form

The form is Settings → My details, and step 2 of the application (`public/js/story-form.js`).

- **„შენ შესახებ“: at least 150 characters for a new application** (unchanged, commit 7cf5ffa), **up to 2000 for everybody**
  (`server/mentorStory.js` `LIMITS.aboutMin` / `aboutMax`). The card shows its first two lines, so a long About is fine.
  - A live count shows the limits. Nothing is ever cut: no `maxlength`.
  - The hint reads „2–3 წინადადება შენს პროფესიულ გამოცდილებაზე. ამას სტუდენტები პირველს ხედავენ შენს ბარათზე.“
  - **An approved mentor is never refused a save of "My details" for the About's length.** That covers today's 131- and 1256-character Abouts, and none at all. The count gives a gentle tip instead ("Tip: 150 or more reads best on your card. It does not stop you saving."), and the admins' daily check lists the card. Only the 2000 hard limit stays.
  - The Profile tab is unchanged: no new rule there.
- **Where each part appears**, in a short line under it:
  - About: the card and the profile.
  - Each „ჩემი გზა“ block: the profile only.
  - „რაში დაგეხმარები“: the profile only.
- **The card preview**, under the About on every screen size (`WisecallStoryForm.mountPreview`):
  - It uses the same card as Browse: `public/js/expert-card.js` and `public/css/expert-card.css`, moved out of `main.js` and `home.css` so both use one card.
  - It is drawn again as the mentor types: the About, or without one the help lines, plus the start tags and "Sample answer".
- **Unchanged**:
  - Drafts are still saved in the browser and on the server as the mentor types.
  - The server still checks each part on its own: a refused field says why under itself, and the rest is saved (docs/CLAUDE-CODE-STORY-SAVE.md).

## 2. The admin's review

`public/js/admin-mentors.js` `cardBlock`; `server/routes/adminVerification.js`.

- **The card as students will see it.** `server/cardCheck.js` `cardFor` builds the same data `/api/experts` sends.
- **The automatic checks** (`cardCheck.warningsFor`):
  - the card has no text;
  - no About;
  - an About under 150 characters (a warning, never a refusal);
  - an About that reads like a personal story (family, children, marriage), which is a warning only;
  - odd capitals in the name, role, headline or field: two capitals and then small letters at the start of a word, like "FInance". "MBA", "PhD" and "iOS" are not flagged;
  - no headline;
  - no photo.
- **Fix the texts** without asking the mentor: the About, role, headline, „რაში დაგეხმარები“ and the three „ჩემი გზა“ blocks (PUT `/api/admin/mentors/:id/texts`).
  - The change is live at once and nobody is emailed.
  - Each change is a `verification_audit` row (`admin_text_edit`, with the field, the old and the new value), shown in the review's audit log.
  - The admin's About has the same 2000 limit.
  - Each check has a level: "the card has no text" and "no About" are errors (red); the rest, the short About among them, are warnings (yellow).
  - The field name itself ("FInance" in the field) is changed with the existing "field" control in the review.

## 3. Every day

`server/cardCheck.js` `dailyReport`, called from the jobs sweep (`server/jobs.js`).

- At most once in 23 hours, claimed in `site_settings` ('card_check'), the admins get an email: every approved mentor whose card has no text or has a warning, with a link and what to fix.
- It goes to `ALERT_EMAIL`, or `ADMIN_EMAILS` when that isn't set.
- With nothing to report, no email is sent.

## Tests

- `tests/card-check.test.js`: the About (150 for an application not approved yet, 2000 at most, an approved mentor's 131 or 1256 characters or none saved), the capitals warning, the other warnings, the admin's review (card, warnings, edit, audit, admin only) and the daily email.
- `e2e/mentor-card-checks.spec.js`: the preview in My details at 390px in Georgian, typing, a short About hinted and saved; the admin's review with the "FInance" warning and the About fixed from there.
