# Cloud quality pack: browser tests and audit scripts

Everything here is new and self-contained; it reuses the project's own browser-test server (`e2e/global-setup.js`: a real server on
port 4620 against the **wiped** `TEST_DATABASE_URL`, the fake bank, the fake ID check, a fake AI, emails written to `e2e/.tmp/mail.jsonl`)
and the `@playwright/test`, `@axe-core/playwright` and `lighthouse` packages that are already root devDependencies. Nothing to install.
If Playwright's own browser is missing, set `CHROMIUM_PATH` (in the cloud container it falls back to `/opt/pw-browsers/chromium-1194/…`).

| File | What |
|---|---|
| `playwright.config.js` | Two projects: `desktop` (1280×800) and `mobile` (375×812, touch) |
| `journey.spec.js` | Sign up + emailed code → mentor application (fake ID check) → admin approves → payout details → buyer finds the mentor, asks, pays (fake bank) → mentor answers → admin releases the first answer → buyer rates → refund after the deadline → language switch keeps the page → dark theme sticks |
| `known-issues.spec.js` | `test.fixme` tests of behaviour we want, verified to fail today (see `docs/TODO-QUALITY.md`) |
| `seed-dev.js` | Demo data for a local dev server (not the test server): admin, buyers, three listed mentors (one Georgian), an applicant, bookings in every state |
| `audit/scan.js` | Screenshots + axe + layout + Georgian checks for 34 page states × 1280/375 × light/dark × EN/KA → `docs/quality-screens/` |
| `audit/lighthouse.js` | Lighthouse (mobile; `--desktop`) for home, a profile and Browse → `docs/quality-screens/lighthouse.json` |

```bash
# browser tests (wipes TEST_DATABASE_URL)
npx playwright test -c tests/e2e-cloud

# the audit, against a local dev server with demo data
ADMIN_2FA=off npm start                     # PAYMENT_PROVIDER=mock, KYC_PROVIDER=mock, no email provider, ADMIN_EMAILS set
node tests/e2e-cloud/seed-dev.js
node tests/e2e-cloud/audit/scan.js          # ~1 hour for all 272 views; --only home,profile-mentor for a few
node tests/e2e-cloud/audit/lighthouse.js
```
Last run (27 Sept 2026, commit 2a90c51): journey 11/11 on desktop and 11/11 on mobile, 4×2 fixme.
