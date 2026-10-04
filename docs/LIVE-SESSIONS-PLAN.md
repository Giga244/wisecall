# Live sessions — plan

A verified mentor hosts a paid live video session: **Live Q&A** (up to 30, only the mentor speaks), **Workshop** (up to 30, the mentor
may share the screen) or **Small circle** (2–8, everyone may use camera and mic). Built in three milestones (docs/LIVE-SESSIONS-PROMPT.md);
this plan is the contract for Milestone 1 and sketches 2–3. It reuses the bank layer (server/pay), the payout ledger and withdrawals, the
receipts, the dispute flow, the inbox, emails, rate limits, the admin audit log and the image pipeline: nothing about money is written twice.

## 1. Data model (migration 036, additive; undo script)

`live_sessions`
- id, slug (unique, from the title + 6 id characters, like public answers), mentor_id → users
- title (5–100), description (50–4,000), learn_points text[] (≤ 5 × ≤ 120), niche (a field key or 'other'), kind ('qa' | 'workshop' |
  'circle'), language ('ka' | 'en'), starts_at timestamptz (stored UTC; entered in Tbilisi time), duration_min (30–120)
- price (tetri, 500–20,000), early_price (tetri, NULL = none, < price), early_until timestamptz NULL, early_seats int NULL
  (the early-bird price applies while the date has not passed AND fewer than early_seats tickets are sold, whichever limit is set)
- max_seats (1–LIVE_MAX_PARTICIPANTS; a circle 2–8), min_seats (default 3, ≤ max)
- regulated boolean (from the field, server/fieldRules.js), regulated_agreed_at (the mentor ticked the "educational talk, not a
  consultation" agreement)
- status: 'draft' → 'review' (waiting for an admin: the mentor's first 3 sessions) → 'published' → 'live' → 'ended' | 'cancelled'
  (+ 'rejected' back to the mentor with a reason; a rejected session can be edited and sent again)
- review_reason, reviewed_by, reviewed_at; cancel_reason ('mentor' | 'min_not_reached' | 'no_show' | 'admin_safety' | 'provider_failed'),
  cancelled_at
- room_name, room_url (from the video provider, made when it is published), mentor_joined_at, mentor_seconds (attendance, from
  heartbeats), ended_at, end_kind ('normal' | 'short' ...), time_changed_at
- cover (in `live_session_covers`: session_id, mime, data; the photo pipeline, landscape 1200×630 WebP, EXIF removed)
- created_at, updated_at, published_at; seats_sold, seats_held are NOT stored: counted from tickets under a row lock.

`live_tickets`
- id, session_id, buyer_id, status: 'held' (seat held while paying, 15 min) → 'paid' → 'refund_pending' → 'refunded'; 'expired'
  (the hold ran out / the bank said failed); 'cancelled' is a refunded ticket with reason 'buyer_cancel'
- price (what this ticket costs: early-bird or normal), fee (platform fee, integer tetri, per ticket), net
- provider, provider_order_id, provider_refund_id, refund_error, refund_reason, refund_requested_at, refunded_at
- hold_until, paid_at, display_anonymous boolean, attended_seconds, created_at
- unique (session_id, buyer_id) WHERE status IN ('held','paid','refund_pending'): one ticket per person per session
- advance questions: `live_questions` rows with source 'checkout' (≤ 2 per ticket)

`live_questions` (the room's question panel) — id, session_id, ticket_id NULL (the mentor's own notes have none), author_id, body
(≤ 300, cleaned, offensive words refused), source ('checkout' | 'room'), state ('open' | 'answering' | 'answered' | 'hidden'), votes,
created_at. `live_question_votes` (question_id, user_id) unique. Deleted 30 days after the session.

`live_speakers` (session_id, user_id, state 'raised' | 'allowed' | 'lowered', updated_at): raise hand → the mentor allows speaking.

`live_reports` (session_id, reporter_id, reason, details, status 'open' | 'resolved', created_at): reports from the page and the room.
An open report holds the session's payout like a dispute.

Generalized (no change for questions):
- `payouts.booking_id` becomes nullable and `payouts.live_session_id` is added (CHECK exactly one; unique per session). The mentor's
  share of a session is ONE payout row: the sum of `net` of its paid tickets, recorded only after a normal end.
- `receipts.booking_id` nullable, `receipts.ticket_id` added (CHECK exactly one; one payment receipt per ticket).
- `disputes.booking_id` nullable, `disputes.ticket_id` added (CHECK exactly one; one per ticket).
- ledger.payableSql also waits while the session has an open dispute or report.

## 2. Who can host

`server/live/hosts.js canHost(user)`: listable (verified, payout details, not suspended — `isListable`) AND (≥ 1 answered question
OR users.live_approved_at set by an admin). Regulated fields: the "Educational talk and Q&A — not a consultation, diagnosis or therapy"
label always shows, and publishing needs the agreement box. A mentor's first 3 sessions go to 'review' (admin approves / rejects with a
reason / edits text); later ones publish straight away (the admin can still unpublish = cancel + refund).

## 3. Money

- Ticket price 5–200 ₾; fee = round(price × PLATFORM_FEE_PERCENT / 100) per ticket, net = price − fee (integer tetri).
- A ticket is paid ONLY when the bank's status check says paid for the right amount (callback, the buyer's return, the sweep) —
  the same rule and the same provider calls as questions. The callback handler looks up bookings first, then tickets.
- Seats: buying locks the session row (`SELECT … FOR UPDATE`) and counts held + paid + refund_pending tickets; no free seat → 409
  sold_out. A hold lasts 15 min (LIVE_HOLD_MINUTES); the sweep expires holds the bank did not confirm (after asking the bank, like
  unpaid questions). A late bank payment for an expired hold is refunded at once (the seat may be gone).
- Refunds are full, automatic and idempotent (idempotency key per ticket): buyer cancels ≥ 24 h before; the mentor cancels; fewer
  than min_seats paid 6 h before (auto-cancel); the mentor does not join within 15 min of the start (no-show); an admin ends it for
  safety; the provider failed and the session could not happen. A buyer who does not attend gets no refund (said before paying).
- After the end: if the mentor was present for ≥ 50 % of duration_min (heartbeats), one pending payout = Σ net of paid tickets,
  payable after holdDays() (refund + dispute window). Otherwise ('short'): every ticket is refunded. Disputes per ticket (the existing
  flow, admin decides full or partial refund): before the payout is paid the session payout shrinks by that ticket's net share; after,
  it becomes a debt like a refunded question.
- The mentor sees it in Balance like question earnings and withdraws it the same way.

## 4. Video (server/live/provider.js)

Interface: `createRoom({ name, startsAt, endsAt, kind, maxSeats }) → { roomName, roomUrl }`, `token({ roomName, userId, userName,
owner, canSend, startsAt, endsAt }) → token`, `endRoom(roomName)`, `deleteRoom(roomName)`, `isConfigured()`, `frameOrigin(roomUrl)`.
- `daily` (LIVE_PROVIDER=daily, DAILY_API_KEY): POST /v1/rooms {name, privacy:'private', properties:{exp, nbf, max_participants,
  start_video_off, start_audio_off, enable_knocking:false, enable_chat:false, enable_screenshare}}; POST /v1/meeting-tokens
  {properties:{room_name, user_name, user_id, is_owner, nbf, exp, eject_at_token_exp, start_video_off:true, start_audio_off:true,
  enable_screenshare, permissions:{canSend}}}; DELETE /v1/rooms/:name. Embedded as Daily Prebuilt in an iframe (`room_url?t=token`),
  no third-party script on our pages.
- `fake` (development and tests): rooms are a local page (/live-fake-room.html) that shows who joined with which rights.
- Tokens: only for the mentor and holders of a paid ticket, only from 10 min before the start until the end + 30 min, short-lived,
  tied to the user id and display name (first name, or "Guest 12" when joining anonymously). The mentor's token is an owner token.
  Q&A and Workshop: participants get canSend [] (watch and listen) until the mentor allows them to speak (raise hand → allow → the page
  fetches a new token with audio+video and reloads the call). Small circle: audio+video from the start. Everyone joins muted, camera off.
- `/live/<slug>/room`: the ONLY page whose Content-Security-Policy allows the provider's frame origin (frame-src) and whose
  Permissions-Policy allows camera, microphone and display-capture for that origin. Everywhere else stays as today.
- Provider down: a clear message; the mentor can "restart the room" (new room); a session that could not take place → refunds.

## 5. Pages and routes

Pages (server-rendered where public; EN + KA, hreflang, canonical; JSON-LD Event with offers, eventAttendanceMode Online):
- `/live` (+ /ka/live): upcoming published sessions; filters (field, language, type, date, price); "starting soon" (< 24 h), "almost
  full" (≤ 20 % left). `/live/<slug>`: everything about one session, places left, early-bird, Buy ticket, share + Copy link, report.
- `/live/<slug>/room`: the call + the question panel (signed in, ticket holder or the mentor).
- Dashboard → "Live sessions" tab: the mentor's sessions (drafts, in review, published, past) with New / Edit / Preview / Cancel,
  and everybody's tickets (Join from 10 min before, Cancel ≥ 24 h before, .ics).
- `/live-edit.html?id=` (the editor with preview). Admin → "Live sessions" queue (approve / reject / edit; live now; end now).
- Profile: "Live sessions" section on a mentor's profile; home: the next 3 sessions (only when there are any).

API (all CSRF-protected writes, rate limited, server-side checks):
- `GET /api/live` (public list), `GET /api/live/:slug` (public view), `GET /api/live/mine` (mentor + tickets)
- `POST /api/live` (draft), `PUT /api/live/:id` (edit: free until the first ticket; then description/points/cover only; a time
  change emails buyers who may cancel for a full refund), `POST /api/live/:id/publish`, `POST /api/live/:id/cancel`, `PUT/DELETE
  /api/live/:id/cover`
- `POST /api/live/:id/tickets` (hold + start payment; up to 2 advance questions), `POST /api/live/tickets/:id/sync`,
  `POST /api/live/tickets/:id/cancel`, `GET /api/live/tickets/:id.ics`
- Room: `POST /api/live/:id/join` (token), `POST /api/live/:id/heartbeat`, `GET/POST /api/live/:id/questions`, `POST
  /api/live/questions/:qid/vote`, `POST /api/live/questions/:qid/state` (mentor), `POST /api/live/:id/hand`, `POST
  /api/live/:id/speakers/:userId` (mentor allows/lowers), `POST /api/live/:id/end` (mentor), `POST /api/live/:id/restart` (mentor)
- `POST /api/live/:id/report`; admin: `GET /api/admin/live`, `POST /api/admin/live/:id/approve|reject|end`, `POST
  /api/admin/live/hosts/:userId` (allow a mentor without answered questions)

## 6. Jobs (the existing sweep)

expire unpaid holds (ask the bank first) · reminders 24 h and 1 h before (email + inbox) · auto-cancel 6 h before when paid < min_seats ·
no-show: 15 min after the start without the mentor → cancel + refund · end: at start + duration (+ grace) a session still 'live' or
'published' is closed: normal → payout; short → refunds · retry failed refunds · delete question panels and room data 30 days after.

## 7. Privacy and safety

The mentor sees first names (or "Guest N") and counts, never emails. Questions are anonymous to other participants. Psychology and
medicine sessions show "If you're in danger or in crisis, call 112" before joining. Report on the page and in the room; an admin can end
a room at once (refund everyone). No recording in Milestone 1. Legal drafts (Terms, Privacy, Mentor Agreement) and help articles updated.

## 8. Edge cases decided

- Two buyers for the last seat at once: the session row lock serializes them; one gets the seat, the other 409 sold_out.
- A hold expires while the buyer is on the bank page and the bank then confirms: if the seat is still free it is taken (the ticket
  becomes paid), otherwise the money is refunded at once and the buyer emailed.
- The early-bird price is fixed on the ticket when the seat is held (the price shown is the price paid).
- A time change after sales: every buyer is emailed and may cancel for a full refund until the new start (not only ≥ 24 h before).
- Cancelling a session with refunds already pending or failed: the retry job finishes them; the session stays 'cancelled'.
- Mentor account suspended: upcoming sessions are cancelled and refunded (like open questions).
- Account deletion: blocked while the person hosts an upcoming session or holds a paid ticket for one (like open questions).
- Milestone 2 (waiting list, follow, ratings, summary + links, 15 % code, analytics, admin tab, gifts, share image) and Milestone 3
  (series, replays) build on these tables; anything needing a new decision goes to docs/QUESTIONS.md.

## 9. Settings

LIVE_PROVIDER (daily | fake; fake only outside production), DAILY_API_KEY, LIVE_MAX_PARTICIPANTS (30), LIVE_HOLD_MINUTES (15),
LIVE_MIN_LEAD_HOURS (24). Without a provider in production, creating sessions works but publishing says "live video is not set up yet".
