# Wisecall — Cookie Notice

> **DRAFT FOR LAWYER REVIEW. Not legal advice. Not yet in force.** Lists exactly what the Wisecall software stores in the browser at
> commit `2b99ada`. If a cookie or storage key is added in the code, add it here.

**Version:** draft 1 · **Last updated:** [date]

Wisecall uses cookies and browser storage that are **strictly necessary** for the site to work and to keep it secure. We use **no
advertising or social-media tracking cookies**; the one statistics cookie (`wc_src`, below) only counts which campaigns bring people. The only third-party script is Cloudflare Turnstile, the "are you a person?"
check, and only on the sign-up, login, forgot-password, contact, waiting-list and "find me a mentor" forms, once you start filling one in
(see "Other sites"). Because of that we do not show a consent banner. [LAWYER: confirm that `wc_src` (first-party, no identifier,
aggregate counts only, 30 days, not set under Do Not Track / Global Privacy Control) needs no consent; if it does, setting
ATTRIBUTION_COOKIE=off on the server turns it off at once.]
[LAWYER: confirm that under the Law of Georgia on Personal Data Protection (and the Law on Electronic Communications, if relevant) these
count as strictly necessary and need no consent — especially `wisecall_device`, which is used for fraud prevention.]

## Cookies

| Name | What it is for | How long | Set by |
|---|---|---|---|
| `wisecall_token` | Keeps you signed in. Contains a signed session (your account id and email). HttpOnly, Secure, SameSite=Lax. | 30 days, or until you log out | wisecall.ge |
| `wisecall_device` | A random identifier for this browser. Only a keyed hash of it is stored, to notice many accounts or applications from one device (fraud prevention). HttpOnly. | 1 year | wisecall.ge |
| `wisecall_oauth` | Only while you use "Continue with Google": remembers the security values of that sign-in. HttpOnly, limited to `/api/auth/google`. | 10 minutes | wisecall.ge |
| `wc_src` | What brought you on your first visit: a campaign link (utm_source, utm_medium, utm_campaign), a click from Facebook or Instagram (never the click's id), or another website (its domain only), or "direct" when nothing did; and the path of the first page you opened. No identifier and nothing about you; we use it only to count, per campaign, how many sign-ups, mentor applications and first questions came from it. Not set if your browser sends "Do Not Track" or "Global Privacy Control". HttpOnly. | 30 days | wisecall.ge |

## Browser storage (not cookies, never sent to our server)

| Key | What it is for | How long |
|---|---|---|
| `wisecall_lang` (localStorage) | The language you chose (Georgian or English) | Until you clear it |
| `wisecall_theme` (localStorage) | Light, dark or system theme | Until you clear it |
| `wisecall_question_<mentor id>` (sessionStorage) | A draft of the question you are writing, so it is not lost if you go to the bank's page and back | Until you close the tab |
| `wisecall_visitor` (localStorage) | A random identifier sent only when you press "Helpful" on a public answer, so each visitor counts once (we keep only a keyed hash of it) | Until you clear it |
| `wisecall_helpful_<answer>` (localStorage) | That you already pressed "Helpful" on this answer | Until you clear it |

## Other sites

When you pay, you are on the bank's payment page ([Bank of Georgia / TBC Bank]), which uses its own cookies under its own policy. When
you use "Continue with Google" or the ID check ([Didit]), the same applies to Google and Didit. On the forms listed above, Cloudflare
Turnstile (challenges.cloudflare.com) checks that you are a person; it runs in its own frame under Cloudflare's privacy policy and may use
its own strictly necessary cookies. We receive only a pass or fail from it. [LAWYER: confirm this needs no consent.]

## How to control them

You can delete cookies and storage in your browser settings. If you block `wisecall_token`, you cannot sign in.
