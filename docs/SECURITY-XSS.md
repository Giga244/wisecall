# Cross-site scripting: where people's text is shown, and how it is kept text

Checked in PART 6 (October 2026). Everything below is covered by `e2e/xss.spec.js`, which saves `<script>alert(1)</script>` and
`<img src=x onerror=alert(1)>` in every text a person can write and opens every page that shows them (as a visitor, the asker, the
mentor and an admin): no dialog may open, no element may be created from the text, and the text must appear as text.

| Where | How it stays text |
|---|---|
| Page scripts (`public/js/*.js`) building HTML with template strings | every value from people goes through `esc` / `escapeHtml` (or `textContent`); ids, counts and translation texts are ours. Reviewed with a scan of every `${…}` inside HTML templates. |
| Links people give (LinkedIn, website, evidence links) | the server accepts only `http(s)` addresses (`profiles.js` / `experience.js` `cleanUrl`); pages escape the address and add `rel="noopener noreferrer nofollow"` |
| Short public labels (the mentor's field, specialty tags, usernames) | refused when they contain markup characters, links or contact details (`customNiche.js`, `experience.js`, `usernames.js`) |
| Server-rendered pages (profile, field pages, help, FAQ, answers) | `escapeHtml` for every value; titles, descriptions and Open Graph / Twitter tags escaped |
| Structured data (`<script type="application/ld+json">`) | `JSON.stringify` with every `<` written as `<`, so the block cannot be closed from inside |
| Emails | every placeholder is escaped for HTML; the plain-text version carries the text as typed (`tests/mail.test.js`) |
| CSV exports (payouts, withdrawals, waiting list, statements) | cells that start with `= + - @` are written as text, so a spreadsheet never runs them as formulas |
| PDFs (receipts, statements) | drawn as text by pdfkit; nothing is interpreted |
| Admin pages | the same escaping as the public pages; tested on every admin tab |
| The Content-Security-Policy | `script-src 'self'` with no `unsafe-inline`: even an injected `<script>` or `onerror=` would not run (tested in `tests/core.test.js`) |

Found and fixed in this pass: nothing that ran. The checks above are now tests, so a future page that forgets to escape fails them.
