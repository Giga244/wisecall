-- PART 2 "Your field": every mentor describes their field in their own words (users.custom_niche, until now only used with "Other"),
-- up to 60 characters instead of 40, next to the closest category (users.niche) or "Other". field_override: an admin decided that the
-- words do not name a regulated profession (see server/fieldRules.js); it is cleared when the mentor changes their field or title.
-- ADDITIVE ONLY: the length limit only grows and one column is added; no existing row changes. Undo: migrations/down/028_your_field.down.sql.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_custom_niche_check;
ALTER TABLE users ADD CONSTRAINT users_custom_niche_check CHECK (custom_niche IS NULL OR char_length(custom_niche) BETWEEN 3 AND 60);
ALTER TABLE users ADD COLUMN field_override boolean NOT NULL DEFAULT false;
