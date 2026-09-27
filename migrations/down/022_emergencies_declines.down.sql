-- UNDO for 022_emergencies_declines.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of
-- the code:  psql "$DATABASE_URL" -1 -f migrations/down/022_emergencies_declines.down.sql
-- What it loses: the emergency log for admins, and why a question was declined (the refunds themselves stay). Take a backup first.
ALTER TABLE bookings DROP COLUMN IF EXISTS decline_note;
ALTER TABLE bookings DROP COLUMN IF EXISTS decline_reason;
ALTER TABLE bookings DROP COLUMN IF EXISTS declined_at;
DROP TABLE IF EXISTS safety_events;
DELETE FROM schema_migrations WHERE name = '022_emergencies_declines.sql';
