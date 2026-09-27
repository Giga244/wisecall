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
