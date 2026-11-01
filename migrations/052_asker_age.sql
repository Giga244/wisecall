-- Askers 16+, mentors stay 18+ (docs/CLAUDE-CODE-ASKERS-16-PLUS.md). ADDITIVE: only what the rule needs, the birth year and month (never the day),
-- the group worked out from it, and when it was confirmed. Existing accounts stay NULL until they are asked at their next login.
-- Undo: migrations/down/052_asker_age.down.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_ym text CHECK (birth_ym IS NULL OR birth_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_group text CHECK (age_group IS NULL OR age_group IN ('minor_16_17', 'adult'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_confirmed_at timestamptz;
CREATE INDEX IF NOT EXISTS users_minor_idx ON users (birth_ym) WHERE age_group = 'minor_16_17';
