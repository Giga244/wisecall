# Wisecall — Cookie Notice

> **DRAFT FOR LAWYER REVIEW. Not legal advice. Not yet in force.** Lists exactly what the Wisecall software stores in the browser at
> commit `2b99ada`. If a cookie or storage key is added in the code, add it here.

**Version:** draft 1 · **Last updated:** [date]

Wisecall uses only cookies and browser storage that are **strictly necessary** for the site to work and to keep it secure. We use **no
analytics, advertising or social-media tracking cookies**, and no third-party scripts. Because of that we do not show a consent banner.
[LAWYER: confirm that under the Law of Georgia on Personal Data Protection (and the Law on Electronic Communications, if relevant) these
count as strictly necessary and need no consent — especially `wisecall_device`, which is used for fraud prevention.]

## Cookies

| Name | What it is for | How long | Set by |
|---|---|---|---|
| `wisecall_token` | Keeps you signed in. Contains a signed session (your account id and email). HttpOnly, Secure, SameSite=Lax. | 30 days, or until you log out | wisecallge.ge |
| `wisecall_device` | A random identifier for this browser. Only a keyed hash of it is stored, to notice many accounts or applications from one device (fraud prevention). HttpOnly. | 1 year | wisecallge.ge |
| `wisecall_oauth` | Only while you use "Continue with Google": remembers the security values of that sign-in. HttpOnly, limited to `/api/auth/google`. | 10 minutes | wisecallge.ge |

## Browser storage (not cookies, never sent to our server)

| Key | What it is for | How long |
|---|---|---|
| `wisecall_lang` (localStorage) | The language you chose (Georgian or English) | Until you clear it |
| `wisecall_theme` (localStorage) | Light, dark or system theme | Until you clear it |
| `wisecall_question_<mentor id>` (sessionStorage) | A draft of the question you are writing, so it is not lost if you go to the bank's page and back | Until you close the tab |

## Other sites

When you pay, you are on the bank's payment page ([Bank of Georgia / TBC Bank]), which uses its own cookies under its own policy. When
you use "Continue with Google" or the ID check ([Didit]), the same applies to Google and Didit.

## How to control them

You can delete cookies and storage in your browser settings. If you block `wisecall_token`, you cannot sign in.
