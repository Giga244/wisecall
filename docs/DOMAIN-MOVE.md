# Moving Wisecall from wisecallge.ge to wisecall.ge: the switch list

The code is ready (commit "Domain: ready to move"). Nothing changes for visitors until **step 6**. Until then the site keeps running on
wisecallge.ge exactly as today.

How it works: `PUBLIC_URL` is the site's one address (every link, email, canonical tag, sitemap, llms.txt and the structured data are
built from it). `OLD_DOMAINS` lists the earlier address(es): a request for one of them gets a permanent 301 to the same page on
`PUBLIC_URL`. `www.` + the site's host always goes to the host without it. The addresses outside services call answer on **both** domains,
so nothing is lost while you update them: `/api/kyc/webhook` (Didit), `/api/payments/...` (the bank), `/api/email/webhook` (Resend),
`/api/auth/google/callback` (Google) and `/api/waitlist-one-click` (the "Unsubscribe" button inside emails already sent).

Do the steps in this order. Each says where, and the exact value.

## BEFORE the switch (visitors notice nothing)

1. **Registrar + Render: the new domain reaches the site.**
   Render -> the Wisecall web service -> Settings -> Custom Domains -> add `wisecall.ge` and `www.wisecall.ge`. Render shows the DNS
   records it wants for each: add exactly those at the registrar of wisecall.ge. Wait until both say "Verified" and "Certificate issued".
   **Do not remove** `wisecallge.ge` and `www.wisecallge.ge` from Render, now or later: old links must keep arriving to be redirected.
   Check: `https://wisecall.ge/healthz` answers `{"ok":true}`.

2. **Mailboxes on the new domain.** `support@wisecall.ge` must receive mail (a mailbox or a forward to the one you read), and
   `hello@wisecall.ge` should exist too. Set this up at your mail host before anything points people at the new address.

3. **Resend: the new sending domain.** Resend -> Domains -> Add domain `wisecall.ge` -> add the DNS records it lists (SPF, DKIM, and the
   return-path record) at the registrar -> wait for "Verified". Keep the old domain in Resend.

4. **Google Cloud (Google sign-in).** APIs & Services -> Credentials -> the "Wisecall web" OAuth client -> Authorized redirect URIs ->
   **add** `https://wisecall.ge/api/auth/google/callback`. Keep the old one. (Authorized JavaScript origins were left empty at setup; if
   you had added the old address there, add `https://wisecall.ge` too.) On the consent screen (Branding): add `wisecall.ge` to
   Authorized domains, and set the home page, privacy and terms links to `https://wisecall.ge`, `https://wisecall.ge/privacy.html`,
   `https://wisecall.ge/terms.html`.

5. **Cloudflare Turnstile.** Turnstile -> the Wisecall widget -> Hostnames -> add `wisecall.ge` (keep `wisecallge.ge`). Without this the
   "are you a person?" check fails on the new address and sign-up and the waiting list stop working.

   Also now, if you use them:
   - **Plausible:** add the site `wisecall.ge` (the value for step 6).
   - **Search Console:** verify **both** domains as *Domain* properties (a DNS TXT record each). The old one must stay verified after
     its pages start redirecting, and the tag on the home page no longer reaches Google from the old address.

## THE SWITCH (one save in Render)

6. Render -> the Wisecall web service -> Environment -> set these, then Save (the service redeploys):

   | Variable | Value |
   |---|---|
   | `PUBLIC_URL` | `https://wisecall.ge` |
   | `OLD_DOMAINS` | `wisecallge.ge,www.wisecallge.ge` |
   | `EMAIL_FROM` | `Wisecall <hello@wisecall.ge>` |
   | `SUPPORT_EMAIL` | `support@wisecall.ge` |
   | `PLAUSIBLE_DOMAIN` | `wisecall.ge` (only if it is set today) |

   These four are no longer in `render.yaml` (they are set in the dashboard only), so a blueprint sync can never put the old address back.

   Check right after the deploy:
   - `https://wisecallge.ge/ka/about.html?x=1` lands on `https://wisecall.ge/ka/about.html?x=1`; so does `https://www.wisecallge.ge/...`.
   - `https://www.wisecall.ge/` lands on `https://wisecall.ge/`.
   - Sign up with a new address: the code email arrives from `hello@wisecall.ge`, and its link is on wisecall.ge.
   - "Continue with Google" signs you in. The ID check starts from an application.
   - `https://wisecall.ge/sitemap.xml` and `https://wisecall.ge/llms.txt` show only wisecall.ge.

   People who were signed in on the old address sign in again on the new one (the login cookie belongs to the address that set it).
   Nothing else is lost: links in emails already sent are redirected with their codes intact.

## AFTER the switch (the old addresses keep answering meanwhile)

7. **Didit.** Console -> the Wisecall app -> Webhook URL -> `https://wisecall.ge/api/kyc/webhook`. The secret stays the same.

8. **Resend webhook.** Resend -> Webhooks -> edit the existing endpoint -> `https://wisecall.ge/api/email/webhook`. Editing keeps the
   signing secret; if you create a new endpoint instead, copy its new secret into `RESEND_WEBHOOK_SECRET` in Render.

9. **The payment provider (Flitt, when it goes live; the same for BOG or TBC).** The site sends the callback and return addresses with
   every payment, built from `PUBLIC_URL`, so nothing is stored there per payment. In the merchant cabinet, change the shop's website
   address to `https://wisecall.ge`, and if the cabinet holds a callback address: `https://wisecall.ge/api/payments/callback`
   (payouts: `https://wisecall.ge/api/payments/flitt/payout-callback`).

10. **Search engines.** Search Console -> the old property -> Settings -> Change of address -> the new property. Submit
    `https://wisecall.ge/sitemap.xml` in the new property. Bing Webmaster Tools -> add `wisecall.ge` -> Site Move. If you verify by the
    HTML tag instead of DNS, put the new property's code in `GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION`.

11. **Everything else that holds the old address:** the link in the Instagram, TikTok and Facebook profiles; the website field of the
    Didit, Resend, Flitt and bank accounts; email signatures; anything printed or with a QR code; the GitHub repository's website field.

12. **Keep wisecallge.ge.** Keep it registered (renew it) and attached to Render for at least a year: the redirects are what carry its
    search ranking and every old link to the new address. After a few weeks you may remove the old redirect URI in Google Cloud.

## Turning it back

Set `PUBLIC_URL`, `EMAIL_FROM` and `SUPPORT_EMAIL` back to the wisecallge.ge values and empty `OLD_DOMAINS`. Nothing in the database
holds a domain.
