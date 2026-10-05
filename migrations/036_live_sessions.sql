-- Live sessions (docs/LIVE-SESSIONS-PLAN.md): paid live video sessions hosted by verified mentors. ADDITIVE: new tables; payouts, receipts
-- and disputes get a second, optional link (to a session or a ticket) next to booking_id, which becomes optional. No existing row changes.
-- Undo: migrations/down/036_live_sessions.down.sql.

CREATE TABLE live_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text        UNIQUE,
  mentor_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title               text        NOT NULL CHECK (char_length(title) BETWEEN 5 AND 100),
  description         text        NOT NULL CHECK (char_length(description) <= 4000),
  learn_points        text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(learn_points) <= 5),
  niche               text        NOT NULL,
  kind                text        NOT NULL CHECK (kind IN ('qa', 'workshop', 'circle')),
  language            text        NOT NULL CHECK (language IN ('ka', 'en')),
  starts_at           timestamptz NOT NULL,
  duration_min        integer     NOT NULL CHECK (duration_min BETWEEN 30 AND 120),
  price               integer     NOT NULL CHECK (price BETWEEN 500 AND 20000),
  early_price         integer     CHECK (early_price IS NULL OR (early_price >= 500 AND early_price < price)),
  early_until         timestamptz,
  early_seats         integer     CHECK (early_seats IS NULL OR early_seats >= 1),
  max_seats           integer     NOT NULL CHECK (max_seats BETWEEN 2 AND 500),
  min_seats           integer     NOT NULL DEFAULT 3 CHECK (min_seats >= 1),
  regulated           boolean     NOT NULL DEFAULT false,
  regulated_agreed_at timestamptz,
  status              text        NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'review', 'rejected', 'published', 'live', 'ended', 'cancelled')),
  review_reason       text,
  reviewed_by         uuid        REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  cancel_reason       text,
  cancelled_at        timestamptz,
  room_name           text,
  room_url            text,
  mentor_joined_at    timestamptz,
  mentor_seconds      integer     NOT NULL DEFAULT 0,
  mentor_last_seen_at timestamptz,
  ended_at            timestamptz,
  end_kind            text        CHECK (end_kind IS NULL OR end_kind IN ('normal', 'short')),
  time_changed_at     timestamptz,
  reminded_24h_at     timestamptz,
  reminded_1h_at      timestamptz,
  data_purged_at      timestamptz,
  published_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (min_seats <= max_seats),
  CHECK (early_price IS NULL OR early_until IS NOT NULL OR early_seats IS NOT NULL)
);
CREATE INDEX live_sessions_upcoming_idx ON live_sessions (starts_at) WHERE status IN ('published', 'live');
CREATE INDEX live_sessions_mentor_idx ON live_sessions (mentor_id, starts_at DESC);

CREATE TABLE live_session_covers (
  session_id uuid        PRIMARY KEY REFERENCES live_sessions (id) ON DELETE CASCADE,
  mime       text        NOT NULL,
  data       bytea       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE live_tickets (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid        NOT NULL REFERENCES live_sessions (id) ON DELETE CASCADE,
  buyer_id            uuid        REFERENCES users (id) ON DELETE SET NULL,
  status              text        NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'paid', 'refund_pending', 'refunded', 'expired')),
  price               integer     NOT NULL CHECK (price > 0),
  fee                 integer     NOT NULL CHECK (fee >= 0),
  net                 integer     NOT NULL CHECK (net >= 0),
  currency            text        NOT NULL DEFAULT 'gel',
  early               boolean     NOT NULL DEFAULT false,
  provider            text        NOT NULL,
  provider_order_id   text,
  provider_refund_id  text,
  refund_error        text,
  refund_reason       text,
  refund_requested_at timestamptz,
  refunded_at         timestamptz,
  hold_until          timestamptz NOT NULL,
  paid_at             timestamptz,
  join_anonymous      boolean     NOT NULL DEFAULT false,
  guest_number        integer,
  attended_seconds    integer     NOT NULL DEFAULT 0,
  last_seen_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (fee + net = price)
);
-- One ticket per person per session (a cancelled, refunded or expired one does not count).
CREATE UNIQUE INDEX live_tickets_one_per_buyer ON live_tickets (session_id, buyer_id) WHERE status IN ('held', 'paid', 'refund_pending');
CREATE INDEX live_tickets_session_idx ON live_tickets (session_id, status);
CREATE INDEX live_tickets_buyer_idx ON live_tickets (buyer_id, created_at DESC);
CREATE INDEX live_tickets_order_idx ON live_tickets (provider, provider_order_id);

CREATE TABLE live_questions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid        NOT NULL REFERENCES live_sessions (id) ON DELETE CASCADE,
  ticket_id  uuid        REFERENCES live_tickets (id) ON DELETE CASCADE,
  author_id  uuid        REFERENCES users (id) ON DELETE SET NULL,
  body       text        NOT NULL CHECK (char_length(body) BETWEEN 3 AND 300),
  source     text        NOT NULL CHECK (source IN ('checkout', 'room')),
  state      text        NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'answering', 'answered', 'hidden')),
  votes      integer     NOT NULL DEFAULT 0 CHECK (votes >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_questions_session_idx ON live_questions (session_id, created_at);
CREATE TABLE live_question_votes (
  question_id uuid NOT NULL REFERENCES live_questions (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, user_id)
);

-- Raise hand -> the mentor allows speaking (Live Q&A and Workshop).
CREATE TABLE live_speakers (
  session_id uuid        NOT NULL REFERENCES live_sessions (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  state      text        NOT NULL CHECK (state IN ('raised', 'allowed', 'lowered')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE live_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES live_sessions (id) ON DELETE CASCADE,
  reporter_id uuid        REFERENCES users (id) ON DELETE SET NULL,
  reason      text        NOT NULL CHECK (reason IN ('not_as_described', 'unsafe', 'abuse', 'spam', 'other')),
  details     text,
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution  text,
  resolved_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX live_reports_one_open ON live_reports (session_id, reporter_id) WHERE status = 'open';

-- A mentor without an answered question may host once an admin allows it.
ALTER TABLE users ADD COLUMN live_approved_at timestamptz;

-- The ledger, receipts and disputes: a session or a ticket next to a booking (exactly one of them).
ALTER TABLE payouts ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE payouts ADD COLUMN live_session_id uuid UNIQUE REFERENCES live_sessions (id);
ALTER TABLE payouts ADD CONSTRAINT payouts_one_source CHECK ((booking_id IS NULL) <> (live_session_id IS NULL));
ALTER TABLE receipts ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE receipts ADD COLUMN ticket_id uuid REFERENCES live_tickets (id);
ALTER TABLE receipts ADD CONSTRAINT receipts_one_source CHECK ((booking_id IS NULL) <> (ticket_id IS NULL));
CREATE UNIQUE INDEX receipts_one_ticket_payment ON receipts (ticket_id) WHERE kind = 'payment' AND ticket_id IS NOT NULL;
ALTER TABLE disputes ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE disputes ADD COLUMN ticket_id uuid REFERENCES live_tickets (id) ON DELETE CASCADE;
ALTER TABLE disputes ADD CONSTRAINT disputes_one_source CHECK ((booking_id IS NULL) <> (ticket_id IS NULL));
CREATE UNIQUE INDEX disputes_one_per_ticket ON disputes (ticket_id) WHERE ticket_id IS NOT NULL;
-- (a session can be reported as not what it promised, or for technical problems on the mentor's side)
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_reason_check;
ALTER TABLE disputes ADD CONSTRAINT disputes_reason_check
  CHECK (reason IN ('not_an_answer', 'wrong_or_harmful', 'off_topic', 'rude', 'other', 'not_as_described', 'technical'));
