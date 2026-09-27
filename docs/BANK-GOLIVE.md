# Bank go-live checklist (Bank of Georgia and TBC Bank)

What each bank needs from Wisecall, how to test before real money, and how our integration (`server/pay/bog.js`, `server/pay/tbc.js`)
compares with the banks' published e-commerce APIs. Mismatches and open questions are copied to `docs/TODO-FROM-CLOUD.md`.

> **Source note — read this first.** The banks' documentation sites (api.bog.ge/docs, developers.tbcbank.ge) could not be opened from
> the environment this was written in (network policy). The comparison below is built from: search-engine extracts of those pages, two
> independent open-source client libraries published on npm (`bog-payments-sdk` 0.1.0, 2026-07; `bogpay` 1.6.1; `tbc-checkout-js`
> 1.0.1), and our own code and fake bank (`tests/fakeBank.js`). Everything marked **[CONFIRM WITH BANK]** must be checked against the
> bank's current documentation or your bank manager before go-live. Links are at the end.

Pick **one** bank for launch (`PAYMENT_PROVIDER=bog` or `tbc`); the other can be added later — each booking remembers its own provider.

---

## 1. Bank of Georgia — Online Payment API ("BOG Payments")

### What you need from BOG
| Item | Where it goes | Notes |
|---|---|---|
| Merchant (e-commerce) agreement for "online consultations / advice marketplace" | — | Ask explicitly whether a marketplace that collects money and pays experts later is acceptable, and about holding funds 7+ days (see `LEGAL-REVIEW.md` §1). **[CONFIRM WITH BANK]** |
| `client_id` | `BOG_CLIENT_ID` | Issued by BOG for the merchant (Business Manager / your BOG manager). |
| `client_secret` | `BOG_CLIENT_SECRET` | Secret. Render env only. |
| Callback URL | sent with every order as `callback_url` = `https://wisecallge.ge/api/payments/callback` | HTTPS, public. Also ask whether it must be registered in the merchant settings. **[CONFIRM WITH BANK]** |
| Callback public key | `BOG_CALLBACK_PUBLIC_KEY` (optional) | Our code has BOG's published key built in. It is **byte-identical** to the key shipped in the independent `bog-payments-sdk` (checked). Still confirm with BOG and set it explicitly so a key change is a config change. |
| Success / fail pages | sent per order: `https://wisecallge.ge/u/<mentor>?booking=<id>&status=success|fail` | No registration needed as far as known. **[CONFIRM]** |

### API as documented vs our code
| Step | BOG (documented) | `server/pay/bog.js` | OK? |
|---|---|---|---|
| Token | `POST https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token`, HTTP Basic `client_id:client_secret`, form `grant_type=client_credentials` | Same (`getToken`, line 28); caches the token ≤ 1 h, refreshes once on 401 | ✅ |
| Create order | `POST https://api.bog.ge/payments/v1/ecommerce/orders`; body `callback_url`, `external_order_id`, `purchase_units { currency, total_amount, basket[{product_id, quantity, unit_price}] }`, `redirect_urls { success, fail }`, optional `ttl`, `capture`; optional headers `Accept-Language` (ka/en), `Idempotency-Key`, `Theme` | Same body with `capture: 'automatic'`, `ttl = PAYMENT_TTL_MINUTES` (30), `external_order_id` = booking id, amount in lari with 2 decimals | ✅ with 2 gaps ↓ |
| — gap A | `Accept-Language` sets the language of BOG's payment page | Always `'en'` (line 45) — Georgian buyers get an English payment page | ⚠️ TODO |
| — gap B | `Idempotency-Key` (UUID v4) on create | Not sent on create (only on refund). Low risk: we never retry a create, but a timed-out create leaves an orphan order at BOG | ⚠️ minor |
| — `ttl` range | Minutes; allowed range and default **[CONFIRM WITH BANK]** | `PAYMENT_TTL_MINUTES` accepts 5–1440 | ❓ |
| Status | `GET https://api.bog.ge/payments/v1/receipt/{order_id}` → `order_status.key`, `purchase_units.request_amount`, `currency_code` | Same; maps `created/processing/auth_requested/blocked/partial_completed → pending`, `completed → paid`, `rejected → failed` (or `expired` when `reject_reason = expiration`), `refund_requested → refund_pending`, `refunded`, `refunded_partially` | ✅ (status list matches the SDK's enum exactly) |
| Paid check | — | Paid only if BOG says `completed` **and** the amount and currency match the booking | ✅ |
| Refund | `POST https://api.bog.ge/payments/v1/payment/refund/{order_id}`; optional `amount` (omit = full); `Idempotency-Key` — the same key returns the same result | Full refund, body `{}`, deterministic UUID key from `refund-<booking id>` so retries reuse it; result confirmed later through the receipt | ✅ |
| Callback | `POST callback_url`, raw JSON `{ event: "order_payment", zoned_request_time, body: { order_id, order_status, … } }`, header `Callback-Signature` = base64 SHA256withRSA over the raw body with BOG's key | Verifies the signature on the raw bytes, requires `event = order_payment`, takes `body.order_id` only and then asks the receipt endpoint (never trusts the callback's status) | ✅ |
| Partial refund result | `refunded_partially` | Mapped, but `server/payments.js` never finishes it (booking stays `refund_pending`) | ⚠️ AUDIT #12 |

### Testing with BOG before real money
1. Ask your BOG manager for **test credentials** and **test cards**, and whether test mode uses the same base URLs or separate ones.
   **[CONFIRM WITH BANK]** — if separate, set `BOG_API_URL` and `BOG_AUTH_URL` (both are configurable).
2. Run locally or on a staging Render service (never production) with `PAYMENT_PROVIDER=bog`, the test keys, and a public HTTPS
   `PUBLIC_URL` so BOG can reach the callback (a staging `…onrender.com` address works).
3. `npm run check:launch` → "the bank issued an access token".
4. Walk through: pay (success) → booking **Paid** within seconds (callback) → answer → admin **Refund in full** → **Refunded**. Then:
   a declined card → booking closed, nothing charged; cancel on BOG's page; close the tab and wait 40 min → booking **expired**; a
   duplicate callback (BOG retries) changes nothing.
5. Check the logs contain no `rejected callback` (a signature failure means the public key is wrong).
6. Our automated tests already cover this flow against a fake BOG (`tests/payments.test.js`, `tests/cloud/money.test.js`); the sandbox
   run proves the real bank behaves the same.

---

## 2. TBC Bank — tpay / TBC Checkout (E-Commerce API)

### What you need from TBC
| Item | Where it goes | Notes |
|---|---|---|
| E-commerce merchant agreement (TBC Checkout / tpay) | — | Same marketplace questions as BOG. **[CONFIRM WITH BANK]** |
| `apikey` | `TBC_API_KEY` | From the **TBC Developers portal** (developers.tbcbank.ge): register an app and subscribe it to the Checkout / "tpay – web payments" product. Identifies the app. |
| `client_id` | `TBC_CLIENT_ID` | From the TBC **merchant dashboard** after the contract. |
| `client_secret` | `TBC_CLIENT_SECRET` | Merchant dashboard. Secret. |
| **Callback URL — must be added on the merchant dashboard** | `https://wisecallge.ge/api/payments/callback` (we also send it per payment as `callbackUrl`) | TBC's docs: "the callbackUrl must be added on the merchant dashboard; if not provided, the dashboard value is used." **Do this, or callbacks may not arrive** (the sweep still catches payments, but slower). |
| Return URL | sent per payment as `returnurl` = `https://wisecallge.ge/u/<mentor>?booking=<id>&status=return` | TBC sends the buyer back here for every outcome; our page then asks the server, which asks TBC. |

### API as documented vs our code
| Step | TBC (documented) | `server/pay/tbc.js` | OK? |
|---|---|---|---|
| Token | `POST https://api.tbcbank.ge/v1/tpay/access-token`, header `apikey`, form `client_id`, `client_secret` → `access_token` (valid 1 day) | Same (line 17); caches ≤ 1 day, refreshes once on 401 | ✅ |
| Create | `POST /v1/tpay/payments`, headers `apikey` + `Authorization: Bearer`; body `amount { currency, total, subTotal, tax, shipping }`, `returnurl`, `callbackUrl`, `expirationMinutes`, `merchantPaymentId`, `language`, optional `methods`, `preAuth`, `saveCard`… → `payId`, `links[rel=approval_url]` | Same fields; `merchantPaymentId` = booking id; `language` KA/EN from the buyer; `description` cut to 30 chars | ✅ with 3 checks ↓ |
| — check A | Casing of the sub-total field: the published examples we could see use **`subTotal`** | We send **`subtotal`** (line 46). Harmless if TBC ignores it, a validation error if it is required. | ❓ **[CONFIRM]** |
| — check B | `expirationMinutes`: the docs' example uses 12; the allowed maximum could not be confirmed | We send `PAYMENT_TTL_MINUTES` = **30** by default. If TBC's maximum is lower, every payment creation fails. | ❓ **[CONFIRM]** |
| — check C | `methods` (which payment methods to offer: card, Apple/Google Pay, installments, QR…) | Not sent → TBC shows its default set, possibly installments/loans | ❓ decide + **[CONFIRM]** codes |
| Status | `GET /v1/tpay/payments/{payId}` → `status`: Created, Processing, Succeeded, Failed, Expired, WaitingConfirm, CancelPaymentProcessing, PaymentCompletionProcessing, Returned, PartialReturned; `amount`, `currency` | Same mapping (`Succeeded → paid`, `Returned → refunded`, `PartialReturned → refunded_partially`, …); paid only if amount and currency match | ✅ |
| Refund | `POST /v1/tpay/payments/{payId}/cancel` with `{ amount }` (full or partial) | Full amount; result confirmed later through the status | ✅, but no idempotency key exists on TBC's side → a timed-out request that TBC did carry out is retried and refused, and the booking stays "refund in progress" (AUDIT #5, #13). Also ask how many days after payment a `cancel` is still possible. **[CONFIRM]** |
| Callback | `POST callbackUrl` with `{ "PaymentId": "…" }` when the status becomes final; **not signed** | Treated as a hint only: takes `PaymentId`, then asks the status endpoint | ✅ (correct handling of an unsigned callback) |

### Testing with TBC before real money
1. In the developers portal, use the **sandbox/test** app and test credentials; ask TBC for **test cards** and whether the test base URL
   differs from `https://api.tbcbank.ge`. **[CONFIRM WITH BANK]** — if it differs, set `TBC_API_URL`.
2. Add the staging callback URL on the (test) merchant dashboard.
3. Same walk-through as BOG step 4, plus: check A (`subTotal`) and check B (`expirationMinutes = 30`) — a creation error in the logs
   (`POST /v1/tpay/payments failed with 400: …`) shows which one TBC rejects.

---

## 3. Go-live steps (either bank)

1. Merchant contract signed; the business category allows paid consultations; ask about chargeback handling and settlement days.
2. Sandbox test passed (above), including one refund end-to-end.
3. Production keys into Render → Environment (never into git or chat): `PAYMENT_PROVIDER` + the bank's keys.
4. Callback URL registered with the bank: `https://wisecallge.ge/api/payments/callback`.
5. Keep `LAUNCH_MODE=prelaunch`, restart, run `npm run check:launch` → the bank issues a token.
6. Follow `docs/RUNBOOK.md` §11 (launch day): `LAUNCH_MODE=live`, one real small payment and one real refund.
7. For the first week, reconcile daily: the bank portal's completed payments vs Wisecall's paid bookings (catches AUDIT #4).

---

## 4. Summary of mismatches (also in `docs/TODO-FROM-CLOUD.md`)
| # | Bank | Issue | Severity |
|---|---|---|---|
| B1 | TBC | `expirationMinutes` = 30 by default; TBC's allowed maximum unconfirmed | 🟠 could block every TBC payment |
| B2 | TBC | `amount.subtotal` vs documented `subTotal` | 🟠 could block every TBC payment |
| B3 | TBC | Callback URL must be registered on the merchant dashboard (ops step, not code) | 🟠 |
| B4 | both | Refund after a lost response never completes (AUDIT #5); TBC has no idempotency key (AUDIT #13) | 🟠 |
| B5 | both | A payment completing after our 40-minute give-up is lost (AUDIT #4) | 🟠 |
| B6 | BOG | `Accept-Language` always `en`: Georgian buyers see an English payment page | 🟡 |
| B7 | BOG | No `Idempotency-Key` on order creation | 🟡 |
| B8 | both | `refunded_partially` never finished (AUDIT #12) | 🟡 |
| B9 | TBC | `methods` not set: decide which payment methods to offer | 🟡 |
| B10 | BOG | Built-in callback key: confirm with BOG and set `BOG_CALLBACK_PUBLIC_KEY` explicitly | 🟡 |

## Sources
- BOG Online Payment API: https://api.bog.ge/docs/en/payments/introduction · create order: https://api.bog.ge/docs/en/payments/standard-process/create-order · refund: https://api.bog.ge/docs/en/payments/refund
- `bog-payments-sdk` (npm, unofficial, 2026-07): endpoints, status enum, callback key; `bogpay` (npm, 1.6.1)
- TBC Developers — Checkout API overview: https://developers.tbcbank.ge/docs/checkout-api-overview · access token: https://myapps.tbcbank.ge/docs/tpay---web-payments/1/routes/access-token/post · `tbc-checkout-js` (npm, 1.0.1)
