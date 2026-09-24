-- Video interviews for regulated niches. An admin publishes time slots, a mentor picks one, the admin
-- adds the meeting link and afterwards records the result.
--   open       free to book
--   booked     a mentor has chosen it (booked_by is set)
--   completed  the interview took place and a result was recorded
--   cancelled  cancelled by an admin
CREATE TABLE interview_slots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at    timestamptz NOT NULL,
  minutes      integer     NOT NULL DEFAULT 20 CHECK (minutes BETWEEN 5 AND 120),
  status       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'booked', 'completed', 'cancelled')),
  booked_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  booked_at    timestamptz,
  meeting_link text,
  link_sent_at timestamptz,
  result       text CHECK (result IN ('passed', 'failed')),
  reason       text,            -- shown to the mentor with the result
  notes        text,            -- private to admins
  decided_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at   timestamptz,
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interview_slots_start_idx ON interview_slots (starts_at);
-- A mentor can hold one booked interview at a time.
CREATE UNIQUE INDEX interview_slots_one_booking ON interview_slots (booked_by) WHERE status = 'booked';
