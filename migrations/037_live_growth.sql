-- Live sessions, Milestone 2 (docs/LIVE-SESSIONS-PLAN.md section 10): the waiting list, following a mentor, ratings, the mentor's summary,
-- a one-time discount code, gift tickets. ADDITIVE ONLY: new tables and new nullable columns; one unique index is replaced by an
-- equivalent one on the new holder column (filled from buyer_id first, so nothing changes for existing tickets).
-- Undo: migrations/down/037_live_growth.down.sql.

-- Waiting list when sold out: the first person waiting gets 2 hours to buy a seat that frees up.
CREATE TABLE live_waitlist (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid        NOT NULL REFERENCES live_sessions (id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status           text        NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'offered', 'bought', 'expired', 'removed')),
  offered_at       timestamptz,
  offer_expires_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX live_waitlist_one ON live_waitlist (session_id, user_id) WHERE status IN ('waiting', 'offered');
CREATE INDEX live_waitlist_queue ON live_waitlist (session_id, created_at) WHERE status IN ('waiting', 'offered');

-- Following a mentor: one email per mentor per week at most, when they publish a session.
CREATE TABLE mentor_follows (
  follower_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mentor_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_emailed_at timestamptz,
  PRIMARY KEY (follower_id, mentor_id),
  CHECK (follower_id <> mentor_id)
);
CREATE INDEX mentor_follows_mentor_idx ON mentor_follows (mentor_id);

-- Ratings of a session by the people who attended (one per ticket).
CREATE TABLE live_ratings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid        NOT NULL UNIQUE REFERENCES live_tickets (id) ON DELETE CASCADE,
  session_id  uuid        NOT NULL REFERENCES live_sessions (id) ON DELETE CASCADE,
  mentor_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rater_id    uuid        REFERENCES users (id) ON DELETE SET NULL,
  stars       smallint    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     text        CHECK (comment IS NULL OR char_length(comment) <= 1000),
  hidden_at   timestamptz,
  hidden_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
  hide_reason text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_ratings_mentor_idx ON live_ratings (mentor_id, created_at DESC);

-- The mentor's short summary and up to 5 links for the people who attended.
ALTER TABLE live_sessions ADD COLUMN summary text CHECK (summary IS NULL OR char_length(summary) <= 2000);
ALTER TABLE live_sessions ADD COLUMN summary_links jsonb;
ALTER TABLE live_sessions ADD COLUMN summary_sent_at timestamptz;
ALTER TABLE live_sessions ADD COLUMN followers_notified_at timestamptz;

-- A one-time discount on a personal question with the same mentor (15 %, 30 days), for every attendee.
CREATE TABLE discount_codes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text        NOT NULL UNIQUE,
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mentor_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  percent         smallint    NOT NULL CHECK (percent BETWEEN 1 AND 90),
  source_ticket_id uuid       UNIQUE REFERENCES live_tickets (id) ON DELETE SET NULL,
  expires_at      timestamptz NOT NULL,
  booking_id      uuid        REFERENCES bookings (id) ON DELETE SET NULL, -- the question it was used for (taken once that question is paid)
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bookings ADD COLUMN discount_code_id uuid REFERENCES discount_codes (id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN list_price integer CHECK (list_price IS NULL OR list_price > 0); -- the mentor's price before the discount

-- Gift tickets: the buyer pays, somebody else attends. holder_id is who attends (the buyer, or the person who claimed the gift).
ALTER TABLE live_tickets ADD COLUMN holder_id uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE live_tickets ADD COLUMN gift_email text;
ALTER TABLE live_tickets ADD COLUMN gift_token_hash text;
ALTER TABLE live_tickets ADD COLUMN gift_claimed_at timestamptz;
UPDATE live_tickets SET holder_id = buyer_id WHERE holder_id IS NULL AND gift_email IS NULL;
DROP INDEX IF EXISTS live_tickets_one_per_buyer;
-- One ticket per person per session: for the person who attends (an unclaimed gift has no holder yet).
CREATE UNIQUE INDEX live_tickets_one_per_holder ON live_tickets (session_id, holder_id) WHERE status IN ('held', 'paid', 'refund_pending') AND holder_id IS NOT NULL;
CREATE INDEX live_tickets_holder_idx ON live_tickets (holder_id, created_at DESC);
CREATE UNIQUE INDEX live_tickets_gift_token ON live_tickets (gift_token_hash) WHERE gift_token_hash IS NOT NULL;
