-- 16 fields, chips inside them, specializations (docs/CLAUDE-CODE-CATEGORIES.md, docs/PLAN-CATEGORIES.md). ADDITIVE: users.niche stays what the rules read
-- (a licence, "never approved automatically") and no existing value changes. The new columns are filled for existing mentors at server start
-- (server/categories.js mapExisting). Undo: migrations/down/057_categories_detail.down.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS field_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_fields text[] NOT NULL DEFAULT '{}' CHECK (cardinality(extra_fields) <= 2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS directions text[] NOT NULL DEFAULT '{}' CHECK (cardinality(directions) <= 5);
ALTER TABLE users ADD COLUMN IF NOT EXISTS direction_other jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS university text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country text;
CREATE INDEX IF NOT EXISTS users_field_idx ON users (field_id) WHERE field_id IS NOT NULL;
-- The chip a question was asked in, for the admins' demand per chip.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS direction_id text;
-- Field 12 (Politics & International Relations) had no niche of its own.
INSERT INTO niches (key, name_en, name_ka, icon, regulated, sort)
  VALUES ('politics', 'Politics & International Relations', 'პოლიტიკა და საერთაშორისო ურთიერთობები', 'spark', false, 365) ON CONFLICT (key) DO NOTHING;
