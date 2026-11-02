-- Undoes 058_vet_nutrition.sql. (Their mentors go back to medicine, the category they had before: still regulated.)
UPDATE users SET niche = 'medicine' WHERE niche IN ('veterinary', 'nutrition');
UPDATE users SET extra_niches = array_remove(array_remove(extra_niches, 'veterinary'), 'nutrition') WHERE extra_niches && ARRAY['veterinary', 'nutrition'];
DELETE FROM niches WHERE key IN ('veterinary', 'nutrition');
