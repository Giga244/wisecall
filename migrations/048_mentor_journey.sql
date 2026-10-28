-- The mentor journey (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 2). ADDITIVE ONLY: one more evidence kind (a university page)
-- and three columns for the application reminders; nothing existing changes. Undo: migrations/down/048_mentor_journey.down.sql.

-- A lecturer's page on a university's own site.
ALTER TABLE mentor_evidence DROP CONSTRAINT IF EXISTS mentor_evidence_kind_check;
ALTER TABLE mentor_evidence ADD CONSTRAINT mentor_evidence_kind_check CHECK (kind IN ('linkedin', 'website', 'portfolio', 'social', 'publication', 'company',
  'diploma', 'product', 'testimonials', 'work_email', 'other', 'university'));

-- When the application last changed, and which reminders went out (at most two of each: a third is never sent).
ALTER TABLE users ADD COLUMN IF NOT EXISTS apply_touched_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS apply_reminders_sent smallint NOT NULL DEFAULT 0 CHECK (apply_reminders_sent BETWEEN 0 AND 2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_reminders_sent smallint NOT NULL DEFAULT 0 CHECK (id_reminders_sent BETWEEN 0 AND 2);
