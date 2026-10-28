-- Undoes migrations/049_categories.sql (run by hand, then delete its row from schema_migrations). The extra categories and the
-- "teach / practise" choice are lost; the main category (users.niche) is untouched.
UPDATE niches SET name_ka = 'ტექნოლოგია' WHERE key = 'tech' AND name_ka = 'IT სფერო';
UPDATE niches SET name_ka = 'სწავლება' WHERE key = 'teaching' AND name_ka = 'განათლება და სწავლება';
UPDATE niches SET name_ka = 'კრეატიული' WHERE key = 'creative' AND name_ka = 'ხელოვნება და ხელნაკეთობა';
UPDATE niches SET name_ka = 'წერა' WHERE key = 'writing' AND name_ka = 'წერა და ჟურნალისტიკა';
UPDATE niches SET name_ka = 'მშობლობა' WHERE key = 'parenting' AND name_ka = 'მშობლობა და ბავშვის აღზრდა';
UPDATE niches SET name_ka = 'მეცნიერება' WHERE key = 'science' AND name_ka = 'მეცნიერება და კვლევა';
UPDATE niches SET name_ka = 'სპორტული მწვრთნელობა' WHERE key = 'sports_coaching' AND name_ka = 'სპორტი და მწვრთნელობა';
UPDATE niches SET name_ka = 'მონაცემები და ხელოვნური ინტელექტი' WHERE key = 'data_ai' AND name_ka = 'მონაცემთა ანალიზი და ხელოვნური ინტელექტი';
ALTER TABLE users DROP COLUMN IF EXISTS practice_kind;
ALTER TABLE users DROP COLUMN IF EXISTS extra_niches;
