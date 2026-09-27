-- UNDO for 018_verification_v2.sql. NOT applied automatically (the server only runs migrations/*.sql, not this folder).
-- Run it by hand, in one transaction, only together with a rollback of the code to before verification rules v2:
--   psql "$DATABASE_URL" -1 -f migrations/down/018_verification_v2.down.sql
-- What it loses: everything mentors entered in the new Experience form (tags, years, story), their evidence list, the automatic
-- analyses and account signals. Nothing that existed before 018 is touched: old steps, documents, KYC results and statuses stay.
-- Take a backup first (Render: Dashboard > the database > Backups).

DELETE FROM verification_steps WHERE step = 'experience' AND reason = 'carried over from verification rules v1';
DELETE FROM verification_audit WHERE action IN ('migrated_to_rules_v2', 'migration_notice_sent');

DROP TABLE IF EXISTS account_signals;
DROP TABLE IF EXISTS verification_reviews;
DROP TABLE IF EXISTS mentor_evidence;

ALTER TABLE users DROP COLUMN IF EXISTS specialty_tags;
ALTER TABLE users DROP COLUMN IF EXISTS years_experience;
ALTER TABLE users DROP COLUMN IF EXISTS story;
ALTER TABLE users DROP COLUMN IF EXISTS application_submitted_at;
ALTER TABLE users DROP COLUMN IF EXISTS verification_rules;

DELETE FROM schema_migrations WHERE name = '018_verification_v2.sql';
