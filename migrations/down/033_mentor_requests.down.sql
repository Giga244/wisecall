-- UNDO for 033_mentor_requests.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the
-- code:  psql "$DATABASE_URL" -1 -f migrations/down/033_mentor_requests.down.sql
-- What it loses: every "find me a mentor" request.
DROP TABLE IF EXISTS mentor_requests;
DELETE FROM schema_migrations WHERE name = '033_mentor_requests.sql';
