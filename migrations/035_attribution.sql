-- PART 9: where people come from (server/attribution.js). ADDITIVE ONLY: three nullable columns.
-- Undo: migrations/down/035_attribution.down.sql.
-- { source, medium, campaign, content, referrer (a domain), at (a date) } from the visitor's first visit, or NULL. Nothing personal.
ALTER TABLE users ADD COLUMN signup_source jsonb;
ALTER TABLE users ADD COLUMN application_source jsonb;
ALTER TABLE bookings ADD COLUMN source jsonb;
