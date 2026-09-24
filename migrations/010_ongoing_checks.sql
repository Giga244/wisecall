-- Checks that continue after a mentor is approved: probation for a new mentor's first answers, and
-- reports from buyers.

-- Probation. A new mentor's first answers are held for an admin. The buyer does not see a held answer;
-- it is released when an admin approves it, or automatically after answer_held_until unless it (or the
-- mentor) has been flagged. The mentor's payout hold period starts when the answer is released.
--   none      not part of probation
--   held      waiting; the buyer cannot see it yet
--   released  the buyer can see it
--   rejected  an admin rejected it and the buyer was refunded
ALTER TABLE bookings ADD COLUMN answer_review text NOT NULL DEFAULT 'none' CHECK (answer_review IN ('none', 'held', 'released', 'rejected'));
ALTER TABLE bookings ADD COLUMN answer_held_until timestamptz;
ALTER TABLE bookings ADD COLUMN answer_released_at timestamptz;
ALTER TABLE bookings ADD COLUMN answer_flagged_at timestamptz;
CREATE INDEX bookings_held_idx ON bookings (answer_held_until) WHERE answer_review = 'held';

-- "Report this mentor". Who reported is only ever visible to admins. A person can have one open
-- report per mentor.
CREATE TABLE mentor_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reporter_id     uuid        REFERENCES users (id) ON DELETE SET NULL,
  booking_id      uuid        REFERENCES bookings (id) ON DELETE SET NULL,
  reason          text        NOT NULL CHECK (reason IN ('misleading', 'fake_credentials', 'inappropriate', 'spam', 'other')),
  details         text,
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution      text        CHECK (resolution IN ('dismissed', 'upheld')),
  resolution_note text,
  resolved_by     uuid        REFERENCES users (id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mentor_reports_one_open ON mentor_reports (mentor_id, reporter_id) WHERE status = 'open';
CREATE INDEX mentor_reports_status_idx ON mentor_reports (status, created_at DESC);
