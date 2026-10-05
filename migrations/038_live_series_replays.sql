-- Live sessions, Milestone 3 (docs/LIVE-SESSIONS-PLAN.md section 10): series (2-6 sessions bought in one payment for a bundle price) and
-- opt-in replays (the mentor's video and screen only; ticket holders free for 30 days, others buy a pass). ADDITIVE: new tables and new
-- nullable columns; three "exactly one source" checks are widened to allow the new sources (nothing existing changes).
-- Undo: migrations/down/038_live_series_replays.down.sql.

-- ---- Series ------------------------------------------------------------------------------------------------------------------------
CREATE TABLE live_series (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text        NOT NULL UNIQUE,
  mentor_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title        text        NOT NULL CHECK (char_length(title) BETWEEN 5 AND 100),
  description  text        NOT NULL CHECK (char_length(description) BETWEEN 20 AND 2000),
  price        integer     NOT NULL CHECK (price > 0), -- the bundle, tetri
  status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  published_at timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_series_mentor_idx ON live_series (mentor_id, created_at DESC);
ALTER TABLE live_sessions ADD COLUMN series_id uuid REFERENCES live_series (id) ON DELETE SET NULL;
CREATE INDEX live_sessions_series_idx ON live_sessions (series_id) WHERE series_id IS NOT NULL;

-- One payment for a whole series; it holds a seat (a ticket with its share of the price) in every session.
CREATE TABLE live_series_orders (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id         uuid        NOT NULL REFERENCES live_series (id) ON DELETE RESTRICT,
  buyer_id          uuid        REFERENCES users (id) ON DELETE SET NULL,
  status            text        NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'paid', 'expired', 'refunded')),
  price             integer     NOT NULL CHECK (price > 0),
  currency          text        NOT NULL DEFAULT 'gel',
  provider          text        NOT NULL,
  provider_order_id text,
  hold_until        timestamptz NOT NULL,
  paid_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX live_series_orders_bank ON live_series_orders (provider, provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX live_series_orders_buyer_idx ON live_series_orders (buyer_id, created_at DESC);
ALTER TABLE live_tickets ADD COLUMN series_order_id uuid REFERENCES live_series_orders (id) ON DELETE RESTRICT;
CREATE INDEX live_tickets_series_order_idx ON live_tickets (series_order_id) WHERE series_order_id IS NOT NULL;

-- ---- Replays -----------------------------------------------------------------------------------------------------------------------
ALTER TABLE live_sessions ADD COLUMN replay_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE live_sessions ADD COLUMN replay_price integer CHECK (replay_price IS NULL OR replay_price > 0);
ALTER TABLE live_sessions ADD COLUMN recording_started_at timestamptz;
ALTER TABLE live_sessions ADD COLUMN recording_stopped_at timestamptz;

CREATE TABLE live_replays (
  session_id   uuid        PRIMARY KEY REFERENCES live_sessions (id) ON DELETE CASCADE,
  recording_id text        NOT NULL,
  provider     text        NOT NULL,
  status       text        NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'deleted')),
  duration_s   integer,
  ready_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  deleted_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
  delete_reason text
);

-- A pass to watch the replay for 30 days, for someone without a ticket (the same bank layer and rules as tickets).
CREATE TABLE live_replay_purchases (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid        NOT NULL REFERENCES live_sessions (id) ON DELETE RESTRICT,
  buyer_id           uuid        REFERENCES users (id) ON DELETE SET NULL,
  status             text        NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'paid', 'expired', 'refund_pending', 'refunded')),
  price              integer     NOT NULL CHECK (price > 0),
  fee                integer     NOT NULL CHECK (fee >= 0),
  net                integer     NOT NULL CHECK (net >= 0),
  currency           text        NOT NULL DEFAULT 'gel',
  provider           text        NOT NULL,
  provider_order_id  text,
  provider_refund_id text,
  hold_until         timestamptz NOT NULL,
  paid_at            timestamptz,
  access_until       timestamptz,
  refund_reason      text,
  refund_error       text,
  refund_requested_at timestamptz,
  refunded_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (fee + net = price)
);
CREATE UNIQUE INDEX live_replay_purchases_bank ON live_replay_purchases (provider, provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX live_replay_purchases_one ON live_replay_purchases (session_id, buyer_id) WHERE status IN ('held', 'paid', 'refund_pending');

-- ---- The ledger and receipts: the new sources next to the old ones (still exactly one per row) ---------------------------------------
ALTER TABLE payouts ADD COLUMN replay_purchase_id uuid REFERENCES live_replay_purchases (id);
CREATE UNIQUE INDEX payouts_one_replay_purchase ON payouts (replay_purchase_id) WHERE replay_purchase_id IS NOT NULL;
ALTER TABLE payouts DROP CONSTRAINT payouts_one_source;
ALTER TABLE payouts ADD CONSTRAINT payouts_one_source CHECK (num_nonnulls(booking_id, live_session_id, replay_purchase_id) = 1);

ALTER TABLE receipts ADD COLUMN series_order_id uuid REFERENCES live_series_orders (id);
ALTER TABLE receipts ADD COLUMN replay_purchase_id uuid REFERENCES live_replay_purchases (id);
CREATE UNIQUE INDEX receipts_one_series_payment ON receipts (series_order_id) WHERE kind = 'payment' AND series_order_id IS NOT NULL;
CREATE UNIQUE INDEX receipts_one_replay_payment ON receipts (replay_purchase_id) WHERE kind = 'payment' AND replay_purchase_id IS NOT NULL;
CREATE UNIQUE INDEX receipts_one_replay_refund ON receipts (replay_purchase_id) WHERE kind = 'refund' AND replay_purchase_id IS NOT NULL;
ALTER TABLE receipts DROP CONSTRAINT receipts_one_source;
ALTER TABLE receipts ADD CONSTRAINT receipts_one_source CHECK (num_nonnulls(booking_id, ticket_id, series_order_id, replay_purchase_id) = 1);
