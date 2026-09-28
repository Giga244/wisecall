-- UNDO for 029_payout_change_hold.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the
-- code:  psql "$DATABASE_URL" -1 -f migrations/down/029_payout_change_hold.down.sql
-- What it loses: the end of any running 72-hour payout hold (those payouts become payable at once).
ALTER TABLE users DROP COLUMN IF EXISTS payout_hold_until;
DELETE FROM schema_migrations WHERE name = '029_payout_change_hold.sql';
