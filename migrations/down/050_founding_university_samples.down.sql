-- Undoes migrations/050_founding_university_samples.sql (run by hand, then delete its row from schema_migrations). Sample answers are
-- deleted (they have no booking, which the old rules require); every answer from a real question stays.
DELETE FROM public_answers WHERE is_sample;
ALTER TABLE public_answers DROP CONSTRAINT IF EXISTS public_answers_published_consent;
ALTER TABLE public_answers ADD CONSTRAINT public_answers_check CHECK (status <> 'published' OR (asker_consent IS TRUE AND mentor_consent IS TRUE AND slug IS NOT NULL));
ALTER TABLE public_answers DROP CONSTRAINT IF EXISTS public_answers_booking_or_sample;
DROP INDEX IF EXISTS public_answers_one_sample_idx;
ALTER TABLE public_answers DROP COLUMN IF EXISTS is_sample;
ALTER TABLE public_answers DROP COLUMN IF EXISTS sample_question_id;
ALTER TABLE public_answers ALTER COLUMN booking_id SET NOT NULL;
DROP TABLE IF EXISTS sample_questions;
ALTER TABLE users DROP COLUMN IF EXISTS show_on_home;
ALTER TABLE users DROP COLUMN IF EXISTS university_badge;
ALTER TABLE users DROP COLUMN IF EXISTS university_domain;
ALTER TABLE users DROP COLUMN IF EXISTS founding_mentor_at;
