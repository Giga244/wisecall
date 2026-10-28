-- Undoes migrations/048_mentor_journey.sql (run by hand, then delete its row from schema_migrations). It refuses while a university page is
-- kept as evidence: change those to 'company' first (UPDATE mentor_evidence SET kind = 'company' WHERE kind = 'university').
ALTER TABLE users DROP COLUMN IF EXISTS id_reminders_sent;
ALTER TABLE users DROP COLUMN IF EXISTS apply_reminders_sent;
ALTER TABLE users DROP COLUMN IF EXISTS apply_touched_at;
ALTER TABLE mentor_evidence DROP CONSTRAINT IF EXISTS mentor_evidence_kind_check;
ALTER TABLE mentor_evidence ADD CONSTRAINT mentor_evidence_kind_check CHECK (kind IN ('linkedin', 'website', 'portfolio', 'social', 'publication', 'company',
  'diploma', 'product', 'testimonials', 'work_email', 'other'));
