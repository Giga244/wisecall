# Analytics: what we count and how to see the funnel

Wisecall counts visits and a few events with [Plausible](https://plausible.io). The server sends them. There is no script in the pages, no cookie and nothing personal. Counting is off while `PLAUSIBLE_DOMAIN` is empty. A browser that asks not to be tracked (Do Not Track, Global Privacy Control) is never counted. The code is in `server/analytics.js`.

## The events

| Event | When | Properties (never personal) |
|---|---|---|
| `waitlist_join` | someone joins the waiting list | `field` (category key or `any`), `source` (`tiktok`, `instagram`, `direct`, ... or `unknown`) |
| `signup` | an account is created | `method` (`email` / `google`), `role` (`mentor` / `asker`, email sign-ups), `age_group` (`minor_16_17` / `adult`; never a birth date) |
| `email_verified` | the 6-digit code is accepted | none |
| `apply_step_1_done` … `apply_step_4_done` | the first time each application step is complete (checked on the server after every save) | none |
| `apply_sent` | "Send for review" | none |
| `id_check_started` | the mentor opens the ID check | none |
| `id_check_passed` | the ID partner reports a pass | none |
| `mentor_approved` | a mentor is approved (by an admin or automatically) | none |

`question_submit` goes out when a question is sent, with `category` (a field or chip id such as `med.cardiology`, nothing personal). Add it as a goal, and `category` as a custom property.

The older events still go out too: `mentor_application_started`, `mentor_application_submitted`, `question_paid`, `question_free`.

## Adding them as Goals in Plausible

1. Open plausible.io, choose the wisecall.ge site, then **Site settings → Goals**.
2. Click **+ Add goal**, choose **Custom event**, type the event name exactly as in the table (for example `apply_sent`), and save.
3. Repeat for each event in the table: `waitlist_join`, `signup`, `email_verified`, `apply_step_1_done`, `apply_step_2_done`, `apply_step_3_done`, `apply_step_4_done`, `apply_sent`, `id_check_started`, `id_check_passed`, `mentor_approved`.
4. For the properties (field, source, role): **Site settings → Custom properties → + Add property**, then add `field`, `source`, `role` and `method`. On the dashboard, click a goal to break it down by them.

Events sent before a goal exists are kept. Adding the goal later shows them too.

## The funnel

In **Site settings → Funnels → + Add funnel** (a Business plan feature; without it, compare the goal counts by hand), name it "Mentor journey" and add these steps in order:

`signup` → `email_verified` → `apply_step_1_done` → `apply_step_2_done` → `apply_step_3_done` → `apply_step_4_done` → `apply_sent` → `id_check_passed` → `mentor_approved`

Plausible counts a funnel by visitor within a session. A mentor who comes back the next day to finish shows as two half-journeys. For that reason the admin panel has the same funnel from the database too.

## The same funnel in the admin panel

**Admin → Overview → "Where mentors stop (last 30 days)"** counts, for the mentors who signed up in the last 30 days: email confirmed, each of steps 1–4, sent, ID check passed, approved. Each row has its share of the sign-ups. It comes straight from the database, so it covers people who finish over several days, and visitors who are not counted in Plausible. It is calculated by `funnel()` in `server/verification/experience.js`.
