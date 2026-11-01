-- Undoes 056_minor_safety.sql. (Reports with the two newer reasons become "other", so the older rule holds.)
DROP TABLE IF EXISTS site_facts;
UPDATE mentor_reports SET reason = 'other' WHERE reason IN ('contact_request', 'unsafe');
ALTER TABLE mentor_reports DROP CONSTRAINT IF EXISTS mentor_reports_reason_check;
ALTER TABLE mentor_reports ADD CONSTRAINT mentor_reports_reason_check CHECK (reason IN ('misleading', 'fake_credentials', 'inappropriate', 'spam', 'other'));
DROP TABLE IF EXISTS question_reports;
DROP INDEX IF EXISTS bookings_minor_hold_idx;
ALTER TABLE bookings DROP COLUMN IF EXISTS minor_hold_reminded_at, DROP COLUMN IF EXISTS answer_minor_hold_at;
