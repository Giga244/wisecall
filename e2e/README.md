# End-to-end tests

```
npm run test:e2e
```

Playwright starts a real Wisecall server on port 4620 against `TEST_DATABASE_URL` (**wiped first**), with the fake bank, the
fake ID check and every email written to `e2e/.tmp/mail.jsonl`, then drives a real Chromium like a person would. Run
`npx playwright install chromium` once before the first run. Where the real thing would take hours or days (an interview
starting, the 24-hour new-mentor check, the 7-day answer deadline, the 7-day payout hold) the test moves the clock forward
in the database and lets the server's own background job do the work.

| File | What it proves |
|---|---|
| `full-flow.spec.js` | Seeker signup and email code → mentor signup and Law application → ID check, licence, licence document, interview slot, admin passes every step and approves → payout details → appears in Browse → question asked and paid at the bank → mentor answers, the first answer is held → released after the check window, buyer emailed → review → payout ledger entry (24.00 of 30.00, held 7 days) → admin pays it out |
| `refunds.spec.js` | A cancelled payment creates nothing and can be retried; a mentor who never answers: automatic refund after the deadline, buyer emailed, no earnings; an admin suspends a mentor: the open question is refunded and the mentor leaves Browse |
| `smoke.spec.js` | Every page and tab (public, seeker, mentor, admin, every filter) in English and Georgian: no script error, no console error, no "Something went wrong" |

The specs run in that order and share one database. Screenshots and traces of failures are written to `e2e/results/`
and an HTML report to `e2e/report/` (`npx playwright show-report e2e/report`).
