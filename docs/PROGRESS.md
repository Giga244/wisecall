# Progress on docs/CLAUDE-CODE-MASTER-PROMPT.md

## PART 0.2 — up to date
Pulled main with both cloud packs merged (prelaunch pack: AUDIT, TODO-FROM-CLOUD, legal drafts, RUNBOOK, BANK-GOLIVE, tests/cloud;
quality pack: QUALITY-AUDIT, TODO-QUALITY, help, seo, e2e-cloud). The local first-pass AUDIT.md was moved aside (see DECISIONS.md).

## PART 1 — a failed required step never shows as verified (AUDIT #8)
One rule ("no required step that no longer holds") now sits in `listableSql()` and in every user read through `getUserById`, so
`isListable()` and the SQL lists agree and even a hand-edited row is hidden at once. `steps.setStep` delists an approved mentor when any
actor fails a required step (status back to review, audit `delisted`, flag `required_step_failed`, email in EN/KA, admins told); the
carry-over and the regular sweep catch older cases. Age failure is final for that ID; admins have "Re-run ID check". Settings, the progress
bar and the steps share one state (`verificationState`); admin filter "Approved, but a step failed". Tests: tests/failed-steps.test.js
(8) and the cloud AUDIT #8 test (todo removed).

## PART 0.1 / Phase 3 — Inbox (messages + notifications)
/inbox.html with a header icon and unread badge (polled every 30 s; a dot on the phone menu button). One thread per paid booking with
the question, the answer, events and ONE free follow-up question + ONE reply (then closed; unique indexes enforce it); support
conversations (also from the contact form when signed in) answered from a new admin Support tab with internal notes, assignment and
close; read-only system messages (application decisions, payouts); a notification centre; Settings → Notifications for the optional
emails with signed unsubscribe links. Contact details / outside payments are refused in booking threads (EN+KA); reports go to admins.
Tests: tests/inbox.test.js (15), e2e/inbox.spec.js (4). Migration 021 (additive, undo script).

## PART 3 early — 🔴 #1 and #2
Rate-limit keys are the limiter plus the lower-cased path without trailing slashes (#1). Wrong email / work-email codes are counted per
account; after 5 the code is cleared (#2, migration 020). Their cloud tests no longer have { todo }.
