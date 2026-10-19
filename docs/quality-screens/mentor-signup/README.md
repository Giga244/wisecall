# Mentor sign-up: screenshots

Pictures of the simple mentor path (docs/CLAUDE-CODE-MENTOR-SIGNUP.md) and of the fixes from the Georgian phone walkthrough
(docs/CLAUDE-CODE-UX-WALKTHROUGH.md), in Georgian, at 360px and 1280px, light and dark.

- `360-light`, `360-dark`, `1280-light`, `1280-dark`: every step of the path, taken by `e2e/mentor-signup.spec.js` with
  `E2E_MENTOR_SHOTS=<this folder>`:
  01 home, 02 "become a mentor", 03 the mentor's sign-up, 04 the email code, 05–09 the five steps of /apply.html, 10 "thank you",
  11–12 Settings afterwards (tabs in sight, the profile's essentials first).
- `ux-fixes/<size>-<theme>`: the home page keeping a typed question in the waiting list (u01–u02, before launch), and Settings and step 5
  for a mentor whose ID check failed before submitting: a calm status, and the failed step named in one sentence (u03–u05).

## Before and after

| | Before | After |
|---|---|---|
| Clicks from the home page to a finished mentor account | 6 (small hero link, "Apply as a mentor", Create account, Confirm, Mentor tab, "I'd like to offer advice" checkbox) | 4 (hero button, "Start my application", Create account, Confirm), and the mentor lands in the application |
| Clicks through the invite link (`/mentor`, `/ka/mentor`) | – | 2 (Create account, Confirm) |
| Things required to submit an application | 10 (title, headline, field in own words, category from 37, ≥1 tag, years, story, sample answer, ≥1 evidence with a type from 10, price, plus the ID check before review) | 6 (headline, years, field in own words with the category suggested, story, price, one link or document), plus the ID check before review |
