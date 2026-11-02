-- Undoes 057_categories_detail.sql. (Mentors in "politics" keep a working category: "other".)
UPDATE users SET niche = 'other' WHERE niche = 'politics';
UPDATE users SET extra_niches = array_remove(extra_niches, 'politics') WHERE 'politics' = ANY(extra_niches);
DELETE FROM niches WHERE key = 'politics';
ALTER TABLE bookings DROP COLUMN IF EXISTS direction_id;
DROP INDEX IF EXISTS users_field_idx;
ALTER TABLE users DROP COLUMN IF EXISTS country, DROP COLUMN IF EXISTS university, DROP COLUMN IF EXISTS direction_other,
  DROP COLUMN IF EXISTS directions, DROP COLUMN IF EXISTS extra_fields, DROP COLUMN IF EXISTS field_id;
