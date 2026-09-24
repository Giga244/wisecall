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
| `responsive.spec.js` | Phones, tablets and desktop: every page at 360 / 390 / 430 / 768 / 834 / 1024 / 1280 px (and Georgian at 390): no sideways scroll and no development overflow warning; the header (menu button below 1024px, links on one line from 1024px); 44px tap targets and 16px text in fields; the menu panel (focus trap, scroll lock, Esc, backdrop, language), the hiding header, the Filters sheet, the question bar and sheet, the example carousel with dots, balanced card rows, the vertical stepper and timeline |
| `smoke.a11y.spec.js` | Accessibility on every page and admin tab, in English and Georgian: axe-core with the WCAG 2.0/2.1/2.2 A and AA rules (colour contrast, names, landmarks, ARIA), the keyboard (skip link, every control reachable with Tab and showing a focus ring), errors announced to screen readers, every form control labelled |
| `smoke.spec.js` | Every page and tab (public, seeker, mentor, admin, every filter) in English and Georgian: no script error, no console error, no "Something went wrong" |

The specs run in that order and share one database (set `E2E_KEEP_DATA=1` to re-run one spec against the data the earlier ones created). Screenshots and traces of failures are written to `e2e/results/`
and an HTML report to `e2e/report/` (`npx playwright show-report e2e/report`).

## Lighthouse

```
# with the site running (for example the demo data from a local server)
npm run lighthouse -- --base http://localhost:4242 --login you@example.com:your-password
```

Audits home, expert, sign up, dashboard and settings on mobile and desktop and prints Performance / Accessibility / Best Practices / SEO (exit code 1 if any is below 90). The signed-in pages are kept out of search engines on purpose, so their SEO score is shown as n/a. Set `CHROME_PATH` to point at Chrome if it is not found.
