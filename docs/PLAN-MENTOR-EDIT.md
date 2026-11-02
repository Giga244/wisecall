# Plan: mentors edit their details and price; admin changes price

Brief: `docs/CLAUDE-CODE-MENTOR-EDIT.md`.

## How it works today

- **Price** is `users.price`, set with `PATCH /api/me` from Settings → Mentor. It's 0 (free) or between `PRICE_MIN` and `PRICE_MAX`.
  - A question copies the price into `bookings.amount` when it's asked, so **questions already asked keep their price**.
  - A paid mentor needs payout details to stay in Browse. A free one doesn't.
  - There is no history and no admin control.
- **Profile** (photo, headline, bio, current work, city, languages, links) can already be edited at any time in Settings → Profile.
- **Application** (field and chips, specializations, university, country, years, title, story, sample, evidence) is locked once it's sent or approved.
  - The only way in is "Edit my application", which takes an approved mentor **off Browse** until an admin approves again.
- **The ID check** (legal name, birth date, result) is shown to admins only and can't be edited anywhere. That stays as it is.

## What I'll build

**1. Price history and the admin price change.**
- A new table, `price_changes`, records the mentor, old and new price, who changed it (the admin or the mentor), the reason and the time.
- Admin mentor page: "ფასის შეცვლა", with ₾, a "უფასო" toggle and a required reason. Same limits as the mentor, and 0 is always allowed.
- The history is shown under it.
- The mentor gets an email (KA and EN): "თქვენი ფასი შეიცვალა: X ₾ → Y ₾. თუ ეს თქვენ არ გითხოვიათ, მოგვწერეთ."

**2. The price block for the mentor.**
- On the dashboard (the mentor's first screen) and in Settings → Mentor: the current price, a "უფასოდ ვპასუხობ" toggle and Save. Two taps: the toggle, then Save. Turning free off brings back the last paid price.
- Logged in the same history. The profile and Browse already say "უფასოდ" at 0 ₾.

**3. "ჩემი მონაცემები" (my details): one place, for pending and approved mentors.**
- **Free to edit, saved at once:** specializations, current role, university, country and years, through a new `PUT /api/me/details` that works even while the application is locked. Photo, bio, languages and links (the Profile tab), price, the weekly free-question number, and email settings (Notifications) are linked from the same page.
  - The same safety checks as today: no links or contact details where they aren't allowed.
- **Needs an admin re-check: main field, extra fields, chips, new proof, a new diploma or licence.**
  - For an approved mentor, the change is saved as a **pending change**, and the live profile stays as it was until it's approved.
  - New table `mentor_changes`. New evidence is stored as unchecked until decided.
- **Admin: a new "ცვლილებები შესამოწმებლად" section in the Review queue.** It shows old against new, one tap to approve or reject, and an optional reason. The mentor is emailed either way.
  - **Approving a field change is refused while that field needs a licence the mentor hasn't passed.** The mentor can send the licence for the field they're moving into, and it's checked exactly as at signup.
- **While still pending (sent, not decided):** edits are saved directly, and the admin sees "განახლდა" with what changed (`application_changes`).
- **Can't be edited:** the name and birth date from the ID check, and its result. The page shows them read-only with "ამის შესაცვლელად მოგვწერეთ". The ID check isn't reopened.

The old "Edit my application" button stays, for a full rewrite of the story and evidence.

## Risks

- **Money:** only the price of *new* questions changes, and refunds and splits are untouched. A test checks that an asked question keeps its amount.
  - An admin who sets a price on a free mentor with no payout details takes them off Browse until they add an IBAN. The admin form warns about this.
- **Licences:** a field change goes live only through the admin, and never into a licensed field without its licence passed. The 18+ check and the ID check aren't touched.
- **Two versions of the field:** search and Browse read only the live columns. The pending change is in its own table, so nothing half-applied shows.
- **Migration 059:** two new tables and one column (`users.application_changes`), with a down file. No existing data changes.
