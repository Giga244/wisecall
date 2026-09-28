-- PART 3 (docs/AUDIT.md #10): people who sign up from now on start with a profile only the people they had a question with can see
-- ("contacts"): askers write about health, law and money, and their usernames come from their names. A mentor's profile becomes public
-- when they are approved (it is listed anyway). EXISTING ACCOUNTS DO NOT CHANGE: only the default for new rows.
-- Undo: migrations/down/030_private_profiles_by_default.down.sql.
ALTER TABLE users ALTER COLUMN profile_visibility SET DEFAULT 'contacts';

-- docs/AUDIT.md #17: the account-signal lookups by user.
CREATE INDEX IF NOT EXISTS account_signals_user_idx ON account_signals (user_id, created_at DESC);
