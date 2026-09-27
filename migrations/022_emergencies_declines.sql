-- Phase 4 (safety): questions that looked like an emergency, and a mentor declining a question. Additive only; the undo script is
-- migrations/down/022_emergencies_declines.down.sql.

-- A question that looked like an emergency was NOT sent to the bank; the person saw help text. Kept for an admin to review; the
-- question itself is encrypted and deleted after 90 days (server/safety.js).
CREATE TABLE safety_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES users (id) ON DELETE SET NULL,
  mentor_id   uuid        REFERENCES users (id) ON DELETE SET NULL,
  categories  text[]      NOT NULL,
  excerpt_enc text,
  reviewed_at timestamptz,
  reviewed_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX safety_events_open_idx ON safety_events (created_at DESC) WHERE reviewed_at IS NULL;

-- A mentor can decline a paid question they have not answered; the asker is refunded in full and sees the reason.
ALTER TABLE bookings ADD COLUMN declined_at    timestamptz;
ALTER TABLE bookings ADD COLUMN decline_reason text CHECK (decline_reason IS NULL OR decline_reason IN ('not_qualified', 'against_rules'));
ALTER TABLE bookings ADD COLUMN decline_note   text;
