-- Categories that fit Georgian professionals (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 3). ADDITIVE, plus clearer Georgian
-- names: users.niche stays the main category (everything that reads it keeps working); up to two extra categories; whether the mentor
-- mainly teaches or researches, works in practice, or both. The renames change a name only while it is still the old one (an admin's own
-- rename is kept). Undo: migrations/down/049_categories.down.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_niches text[] NOT NULL DEFAULT '{}' CHECK (cardinality(extra_niches) <= 2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS practice_kind text CHECK (practice_kind IN ('academic', 'practitioner', 'both'));

UPDATE niches SET name_ka = 'IT სფერო' WHERE key = 'tech' AND name_ka = 'ტექნოლოგია';
UPDATE niches SET name_ka = 'განათლება და სწავლება' WHERE key = 'teaching' AND name_ka = 'სწავლება';
UPDATE niches SET name_ka = 'ხელოვნება და ხელნაკეთობა' WHERE key = 'creative' AND name_ka = 'კრეატიული';
UPDATE niches SET name_ka = 'წერა და ჟურნალისტიკა' WHERE key = 'writing' AND name_ka = 'წერა';
UPDATE niches SET name_ka = 'მშობლობა და ბავშვის აღზრდა' WHERE key = 'parenting' AND name_ka = 'მშობლობა';
UPDATE niches SET name_ka = 'მეცნიერება და კვლევა' WHERE key = 'science' AND name_ka = 'მეცნიერება';
UPDATE niches SET name_ka = 'სპორტი და მწვრთნელობა' WHERE key = 'sports_coaching' AND name_ka = 'სპორტული მწვრთნელობა';
UPDATE niches SET name_ka = 'მონაცემთა ანალიზი და ხელოვნური ინტელექტი' WHERE key = 'data_ai' AND name_ka = 'მონაცემები და ხელოვნური ინტელექტი';
