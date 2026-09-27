-- "I am 18 or older", confirmed at sign-up (a box on the form; for a Google sign-up, on the next page). Additive only; the undo
-- script is migrations/down/027_adult_confirmed.down.sql. Accounts from before this migration keep null (they accepted the Terms,
-- which already require 18+).
ALTER TABLE users ADD COLUMN adult_confirmed_at timestamptz;
