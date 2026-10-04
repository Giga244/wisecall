-- UNDO for 032_public_answers.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the
-- code:  psql "$DATABASE_URL" -1 -f migrations/down/032_public_answers.down.sql
-- What it loses: every public answer (and its "helpful" votes) and the mentors' "public answers" setting. The questions and answers
-- themselves stay in their bookings.
DROP TABLE IF EXISTS public_answer_votes;
DROP TABLE IF EXISTS public_answers;
ALTER TABLE users DROP COLUMN IF EXISTS public_answers_pref;
DELETE FROM schema_migrations WHERE name = '032_public_answers.sql';
