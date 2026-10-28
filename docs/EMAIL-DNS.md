# Email: DNS records and Resend settings for wisecallge.ge

Checked on 28 October 2026 with public DNS lookups (Cloudflare 1.1.1.1 and Google 8.8.8.8). Resend's own "Verified" status needs the API key,
which only the server has, so step 1 below is a look in the Resend dashboard. **Nothing here was changed: you make each change yourself.**

## What exists today

| Record | Name | Value (today) | Status |
|---|---|---|---|
| SPF (for Resend) | `send.wisecallge.ge` TXT | `v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all` | present |
| Return path / bounces | `send.wisecallge.ge` MX | `10 feedback.forge.rmta.net` | present |
| DKIM | `resend._domainkey.wisecallge.ge` TXT | `p=MIGfMA0G…` (Resend's key) | present |
| DMARC | `_dmarc.wisecallge.ge` TXT | `v=DMARC1; p=none;` | present, but reports go nowhere |
| SPF (root) | `wisecallge.ge` TXT | `v=spf1 include:_spf.mx.cloudflare.net ~all` | fine: the root only receives mail (Cloudflare Email Routing) |
| Inbound mail | `wisecallge.ge` MX | Cloudflare `route1/2/3.mx.cloudflare.net` | fine |

Nothing required is missing. Emails leave from `send.wisecallge.ge` and are signed as `wisecallge.ge`, so DMARC passes when Resend shows the
domain as Verified.

## What to do (in order)

1. **Resend → Domains → wisecallge.ge**: every row should say *Verified*. If one says *Pending* or *Failed*, copy that row's exact value into
   Cloudflare (DNS → Records) and press *Verify DNS records* in Resend.
2. **Resend → Domains → wisecallge.ge → Configuration**: turn **off** *Click tracking* and *Open tracking*. Tracked links and pixels make
   Outlook / live.com / hotmail more suspicious of a new domain, and the code email must have neither.
3. **DMARC with reports** (Cloudflare → DNS → edit the `_dmarc` TXT record). Replace the value with:
   `v=DMARC1; p=none; rua=mailto:dmarc@wisecallge.ge; adkim=r; aspf=r`
   (create the address `dmarc@wisecallge.ge` in Cloudflare Email Routing so the reports reach you). After 2–4 weeks of clean reports, change
   `p=none` to `p=quarantine`. That helps Microsoft trust the domain more.
4. **The sender name** (Render → wisecall → Environment): set `EMAIL_FROM` to `Wisecall <hello@wisecallge.ge>`, and `SUPPORT_EMAIL` to the
   support address. Replies to the code email go to `SUPPORT_EMAIL`. Create `hello@wisecallge.ge` in Cloudflare Email Routing too, so a reply
   to it never bounces.
5. **Delivery results in admin** (optional, but it shows when someone's code never arrived):
   - Resend → Webhooks → *Add endpoint*: `https://wisecallge.ge/api/email/webhook`, events `email.sent`, `email.delivered`,
     `email.delivery_delayed`, `email.bounced`, `email.complained`.
   - Copy the endpoint's *Signing secret* (`whsec_…`) into Render as `RESEND_WEBHOOK_SECRET`, then redeploy.
   - Admin → Mentor applications then shows "Last email: delivered / bounced / sent, no answer yet" on each card.
6. **Microsoft (live.com, hotmail, outlook)** is the strictest with a new domain. If codes still land in Junk after steps 1–4: sign up at
   Microsoft SNDS (https://sendersupport.olc.protection.outlook.com/snds/) with the sending address, and ask the first mentors to mark the
   code email *Not junk*. Each "not junk" teaches their filter.
