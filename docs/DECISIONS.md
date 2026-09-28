# Decisions made while working through docs/CLAUDE-CODE-MASTER-PROMPT.md

Where the brief was unclear or a choice carried risk, the safest option was taken and written down here.

## Order of work
- **PART 1 (the "verified with a failed step" bug) was done before finishing Phases 3–5 of PART 0.** PART 1 is marked URGENT and is a
  live data problem (an under-18 mentor shown as verified); Phases 3–5 are large new features. Fixing the live bug first is the safer
  order. PART 0.2 (pull main) was done first as asked.
- **The two 🔴 items of PART 3 (#1 rate-limit bypass, #2 email-code brute force → admin takeover) are also done early**, right after
  PART 1, for the same reason: they are open on the live site today and small to fix. The rest of PART 3 follows in the given order.

## PART 0
- The untracked local `docs/AUDIT.md` (the first-pass audit) blocked the pull. It was moved out of the repository (not deleted) to the
  session scratchpad; the complete audit on main replaces it. `docs/FIX-PROMPT.md` and `docs/marketing/` were kept untouched. Note that
  `docs/FIX-PROMPT.md` uses the first-pass audit's numbering, which differs from `docs/AUDIT.md` on main.

## PART 1 — failed required steps
- **"Needs attention" is not a new database status.** An approved mentor whose required step fails goes back to
  `verification_status = 'pending'` (as the existing admin path already did), gets an open `required_step_failed` flag, an audit row
  `delisted` and an email. Every screen shows one computed state (`util.verificationState`: none / pending / in_review /
  needs_attention / verified / rejected / suspended) in which a failed required step always wins over the stored status. A new status
  value would have touched every approval, payout and listing path for no extra safety.
- **The listing rule is enforced in SQL at read time**, not only when a step changes: `models.listableSql()` and the user objects read
  through `getUserById` (and friends) carry the same "no failed required step" condition, so even a row changed by hand in the database
  is hidden at once. A user object read some other way does not know, and is then treated as **not** listable (fail closed).
- Required steps for this rule: email, ID check, age, name match, experience, an interview an admin asked for, and for regulated niches
  the licence steps (a licence past its expiry date counts as failed).
- **"Re-run ID check"** (admins only, reason required, logged): the provider is asked again and the age worked out again, overriding the
  earlier automatic result; if it still fails, the ID check is opened again for the mentor (the old steps are removed, the audit log keeps
  them). The mentor then needs a person's approval again; nothing is re-approved automatically.
- The "ID check approved" email is now sent only when the ID step actually changes (a corrected result for an already approved check
  used to send a second "approved" email next to the "needs attention" one).

## Pushing
- **Work is committed locally, one commit per item, and NOT pushed.** The master prompt asks for commits only, and pushing to main
  deploys straight to the live site (Render). Keeping everything local until the owner has reviewed it is the safer choice; nothing
  here changes the live database until it is pushed. (The owner's own `tools/continue-night.bat` says the same.)

## PART 0 / Phase 4 — account deletion
- Deleting an account is refused while anything is still open for another person or for money (a question waiting, a refund, a
  report, unpaid earnings or a debt), so no one is left half-way. The mentor must be paid out first (PART 5 lets a closing account
  withdraw any amount).
- The account is closed at once and emptied after 14 days (the brief's grace period). The row stays with its details removed because
  bookings, payouts and receipts must keep pointing at it (accounting records). The question and answer texts stay, since they are
  also the other person's record; messages the deleted person wrote are blanked. Listed in LEGAL-REVIEW.md 47 for the lawyer.

## PART 0 / Phase 5 — SEO
- Georgian gets its own addresses with a `/ka` prefix (`/ka/`, `/ka/about.html`, `/ka/u/<name>`), served by the same routes; the
  head of each page (lang, title, description, share tags, canonical, hreflang) is written in that language by the server.
  `x-default` points to Georgian, the main market (as proposed in docs/seo/meta-tags.md). Links inside a page stay on the plain
  addresses; the page still shows the visitor's chosen language, so nothing else had to change.
- Structured data for a listed mentor: a ProfilePage with the Person, and the paid answer as a Service with an Offer (price in GEL).
  The rating is attached to the Service, not the Person: schema.org has no aggregateRating on Person, and it is only added when there are
  real, visible reviews.
- Mentor profiles are rendered into the HTML (name, role, bio, city, languages, price, rating), so /api/ can stay blocked in robots.txt.
- Quality audit UX-3: the review page does not promise a time ("within 2 working days") until the team agrees one; the mentor gets an
  email the moment it is decided. UX-6: the browser's own confirm() dialogs stay (they are accessible and the tests rely on them);
  the tab-row fade mask was left out (the active tab is already scrolled into view).

## PART 0 / Phase 5 — backups, admin overview, emails, Georgian review list
- Help article 07 ("How mentors get paid") still has [CHECK] notes, so it stays unpublished (the help centre skips articles with
  [CHECK]); PART 5 rewrites it for the new balance and withdrawals.
- Backups: `npm run backup` / `npm run backup:check` wrap pg_dump / pg_restore. The check restores into a NEW scratch database and only
  reads the source, so it can never overwrite data; it was tested on the local test database, never on the owner's dev or live database.
- The admin overview is a new last tab, not the page admins land on: "Mentor applications" stays the first view (it is the daily work
  queue in RUNBOOK §1, and the browser tests expect it). The numbers are counts and sums only (no names or emails). "Wisecall fee" is
  gross (before bank fees and tax) and counts answered questions only; fake-bank payments are labelled as test money.
- Emails get a dark version through CSS that only mail apps following the reader's dark mode use; the others keep the light design.
  Gmail's apps ignore that CSS and recolour by themselves, so a real Gmail check (Android and iOS) is left to the owner.
- docs/KA-REVIEW.md lists every Georgian text added or changed since the cloud packs were merged (`node scripts/ka-review.js 0c67940`),
  for a native speaker; it is regenerated after PART 4.

## PART 2 — "Your field"
- The mentor's own words live in the existing `users.custom_niche` (until now only used with "Other"), now for every category and up to
  60 characters (migration 028 only widens the limit and adds `field_override`). One column, so nothing has to be kept in sync; the
  admin's "Suggested niches" still groups only the mentors in "Other".
- Required for every application sent from now on. Mentors approved before keep their category as the label until they edit their
  application (the cards fall back to the category's name), so nobody is taken off the site for it.
- Regulated professions: the words of the field AND the title are checked (English whole words, Georgian stems, e.g. doctor / ექიმი,
  lawyer / ადვოკატი / იურისტი, financial adviser, accountant, psychologist, dentist, nurse, pharmacist). A match with a category that
  needs no licence moves the application to the regulated category (licence step, never approved automatically), and the form says why.
  Stricter by design: a false match costs an admin one click ("Not a licensed profession"), a missed one would let unlicensed medical,
  legal or financial advice through. The admin's decision lasts until the mentor changes their field or title.
- An admin cannot move an approved mentor into a category whose licence they have not passed (the site would show a regulated mentor
  without a checked licence); the mentor adds the licence first.
- On the profile the field's words are the tag; the breadcrumb and the tag's link still lead to the category's page (navigation), with
  the category's name as the tag's tooltip.
- Specialty tags stay out of the public data (as before); Browse's search box also asks the server, which matches them, and shows
  the union with its own instant matches. When an admin turns a suggested "Other" field into a category, the mentors keep their own
  words as their field.

## PART 3 — security fixes
- #4 A late "paid" on an attempt we had closed: the question is opened again as paid when the mentor can still be asked, otherwise it is
  refunded at once; admins are emailed either way. Unpaid attempts are only deleted after one last look at the bank.
- #5 A refund whose answer was lost: before asking again, the sweep asks the bank; a refund the bank accepted but still shows as paid
  after 5 minutes is asked for again (same idempotency key).
- #10 changes the earlier decision "asker profiles are public by default" for NEW accounts only (the audit's 🟠 row, which the master
  prompt asks to fix): existing accounts keep what they have. Approved mentors' profiles are made public at approval (they are listed
  anyway). Reviews by an asker with a private profile show "Anonymous asker", as before. The Privacy Policy should say so
  (LEGAL-REVIEW.md 50).
- Bank items without confirmation are settings: TBC_MAX_EXPIRATION_MINUTES (default 12, the value in TBC's example) and
  TBC_SUBTOTAL_FIELD (default "subTotal", TBC's documented spelling), both [CONFIRM WITH BANK] in docs/BANK-GOLIVE.md.
- Asking limits per account: 3 unpaid attempts open at once and 10 questions started per hour (BOOKINGS_PER_HOUR,
  MAX_OPEN_UNPAID_BOOKINGS; 0 turns a limit off), on top of an IP limit of 30 per hour.
- Payout details: the current password is needed even for the first details (an account taken over before the mentor saved them could
  otherwise set its own IBAN). Accounts without a password (Google) must have signed in within 10 minutes. A change (not the first save)
  emails the mentor and holds payouts for 72 hours (PAYOUT_CHANGE_HOLD_HOURS).
- Buyers and mentors no longer get the bank's order and refund ids or its error messages; the buyer's answer to "start a payment" still
  carries the order id, which is part of the bank address they are sent to anyway.
- Left for later (🟡, not required by the master prompt): #11 (who can raise a "reports" flag), #12 (the bank's "partially refunded"
  status). #14, #17 and #18 were small and are done.
