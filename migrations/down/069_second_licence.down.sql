-- Undoes migrations/069_second_licence.sql (run by hand, then delete its row from schema_migrations). The second licences mentors named
-- are lost.
ALTER TABLE mentor_credentials DROP COLUMN IF EXISTS second_last4;
ALTER TABLE mentor_credentials DROP COLUMN IF EXISTS second_number_enc;
ALTER TABLE mentor_credentials DROP COLUMN IF EXISTS second_body;
