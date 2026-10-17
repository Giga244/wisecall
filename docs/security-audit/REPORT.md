# Wisecall security audit, run 1 (quick profile)

- **Tool:** Cloudflare `security-audit` skill (github.com/cloudflare/security-audit-skill)
- **Target:** the local copy of `sagely-platform` as of 13 Oct 2026. Reviewed: `server/`, `migrations/`, the main `public/js` files, `render.yaml`, `package.json`.
- **Method:** source review only. No code was run and the live site was not touched.
  - 4 isolated hunters covered auth/admin, money, data access and injection.
  - 2 fresh verifiers then tried to disprove every candidate.
- **Coverage: partial.** This was a quick run and the first run, with no earlier audit to compare against. Not reviewed: most HTML pages, the smaller `public/js` files, and `tests/`.

## Result: no critical or high findings

The basics are solid:

- parameterised SQL
- CSRF and Origin checks
- signed payment callbacks
- SSRF guards on link checks
- escaped server-rendered HTML
- mock payment and KYC routes switched off in production
- 2FA on admin accounts

## Confirmed findings

| # | Severity | Finding | Where to fix |
|---|---|---|---|
| C1 | Medium | A stolen session on a **Google-only account** can set a password with no re-check. That password then unlocks the IBAN change, 2FA disable and account delete. Also, "log out other sessions" counts as a fresh sign-in. | `server/routes/me.js` (POST /password, logout-others), `server/auth.js` startSession |
| M1 | Medium | The **72h payout-change hold can be bypassed**. A hijacker requests a withdrawal first, then changes the IBAN. The already-requested payout goes to the new IBAN. | `server/withdrawals.js` sendPayout / syncPayout / queue / CSV; `server/routes/me.js` PUT /payout |
| C2 | Medium | Admin **password without 2FA** can still read every user's private and hidden profile sections, hidden-profile images, moderation notes, and receipts (receipts need the UUID). | `server/adminAuth.js` isAdminUser used in `profileSections.js`, `routes/receipts.js` |
| C5 | Medium | `GET /api/experts/:id` returns a mentor's **About text even when it's set to "only me"** or hidden by an admin. The list and search leak it for hidden profiles too. | `server/routes/experts.js`, `server/util.js` publicProfile |
| C3 | Low | **Admin JS files** (admin.js, admin-mentors.js) can be downloaded by anyone at `/ka/js/admin.js`. | `server/index.js`: mount adminOnlyFile after languagePrefix |
| C4 | Low | An attacker can sign up with someone else's email (unverified) and turn on 2FA. The real owner then can't get in, even after a password reset. | `server/routes/twoFactorUser.js` (require verified email), reset-password should clear 2FA |
| C6 | Low | Mentor-typed names go **unescaped into admin notification emails**, which allows fake links or phishing inside a real Wisecall email. | `server/verification/names.js`: wrap values in escapeHtml |
| C7 | Low | **Open redirect after login.** `?redirect=/%09/evil.com` passes `safeRedirect` and leads to evil.com. | `public/js/api.js` safeRedirect (also `server/routes/google.js:27`) |
| M3 | Low | A refund that lands while a payout is being sent (flitt_iban only) is never recorded as mentor debt, so the mentor is overpaid. | `server/ledger.js` refund hooks |
| M4 | Low | A full refund after a settled partial-refund debt never collects the rest of the mentor's share. | `server/ledger.js` debt fields |

## Needs validation (no severity)

- **M2, double refund with TBC.** Refund retries re-send the cancel to TBC, which does not dedupe refunds. Not reachable today: there is no provider in prelaunch, and the launch plan is Flitt, which is idempotent.
  - **To check:** ask TBC whether a second full cancel on a payment that is already refunding gets rejected.

## Not covered this run

- Whether Render's proxy matches `trust proxy = 1`. This matters for per-IP rate limits.
- Whether Flitt checks the receiver name against the IBAN.
- The `AUTO_APPROVE=on` path through the LLM review. It is off now; re-audit it before turning it on.
- `disputes.js` in depth.
- The live-session code. It is off now; review it before turning it on.
