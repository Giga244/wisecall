-- UNDO for 024_receipts.sql. NOT applied automatically. Run by hand, in one transaction, only together with a rollback of the code:
--   psql "$DATABASE_URL" -1 -f migrations/down/024_receipts.down.sql
-- What it loses: the receipt numbers already given out (they must not be reused: keep a copy for the accountant first).
DROP TABLE IF EXISTS receipts;
DELETE FROM schema_migrations WHERE name = '024_receipts.sql';
