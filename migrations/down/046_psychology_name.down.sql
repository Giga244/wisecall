-- Undoes migrations/046_psychology_name.sql (run by hand, then delete its row from schema_migrations).
UPDATE niches SET name_ka = 'ფსიქოლოგია და კეთილდღეობა' WHERE key = 'psychology' AND name_ka = 'ფსიქოლოგია';
