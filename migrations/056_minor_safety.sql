-- Reports and the check on answers to minors (docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 6). ADDITIVE, except that two reasons are added to the ones a report on a
-- mentor may have (no existing row changes). Undo: migrations/down/056_minor_safety.down.sql.
-- An answer to a minor that waits for an admin, with no automatic release, and when the admins were last reminded of it.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS answer_minor_hold_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS minor_hold_reminded_at timestamptz;
CREATE INDEX IF NOT EXISTS bookings_minor_hold_idx ON bookings (answer_minor_hold_at) WHERE answer_minor_hold_at IS NOT NULL AND answer_review = 'held';
-- A mentor reports a question.
CREATE TABLE IF NOT EXISTS question_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  reporter_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  reason          text NOT NULL CHECK (reason IN ('contact_request', 'inappropriate', 'unsafe', 'spam', 'other')),
  details         text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution      text CHECK (resolution IN ('dismissed', 'upheld')),
  resolution_note text,
  resolved_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS question_reports_one_open ON question_reports (booking_id, reporter_id) WHERE status = 'open';
ALTER TABLE mentor_reports DROP CONSTRAINT IF EXISTS mentor_reports_reason_check;
ALTER TABLE mentor_reports ADD CONSTRAINT mentor_reports_reason_check CHECK (reason IN ('misleading', 'fake_credentials', 'inappropriate', 'spam', 'other', 'contact_request', 'unsafe'));
-- When something first happened on the site: 'first_live' is the day the first 3 months of the check on answers to minors count from.
CREATE TABLE IF NOT EXISTS site_facts (
  key text PRIMARY KEY,
  at  timestamptz NOT NULL DEFAULT now()
);
