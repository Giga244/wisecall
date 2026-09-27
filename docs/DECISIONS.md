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
