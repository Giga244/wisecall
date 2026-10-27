-- The Georgian name of the psychology category (docs/CLAUDE-CODE-APPLY-STEP1-MOBILE.md): "ფსიქოლოგია და კეთილდღეობა" made academics think it
-- was only for wellbeing or therapy; it is "ფსიქოლოგია" now. The key (psychology) stays. DATA ONLY, one row, and only while it still has the
-- old name (an admin's own rename is kept). Undo: migrations/down/046_psychology_name.down.sql.
UPDATE niches SET name_ka = 'ფსიქოლოგია' WHERE key = 'psychology' AND name_ka = 'ფსიქოლოგია და კეთილდღეობა';
