-- Undoes 064_new_categories.sql. Mentors in the new niches go back to "other" with their own words kept (users.custom_niche), and their
-- new fields and directions are cleared, so nobody is left in a niche that no longer exists.
UPDATE users SET niche = 'other' WHERE niche IN ('economics', 'social_sciences', 'humanities', 'aviation', 'maritime', 'public_service',
  'security_defense', 'logistics', 'beauty', 'fashion', 'performing_arts', 'allied_health');
UPDATE users SET extra_niches = (SELECT coalesce(array_agg(n), '{}') FROM unnest(extra_niches) n WHERE n NOT IN ('economics', 'social_sciences',
  'humanities', 'aviation', 'maritime', 'public_service', 'security_defense', 'logistics', 'beauty', 'fashion', 'performing_arts', 'allied_health'))
  WHERE extra_niches && ARRAY['economics', 'social_sciences', 'humanities', 'aviation', 'maritime', 'public_service', 'security_defense',
  'logistics', 'beauty', 'fashion', 'performing_arts', 'allied_health'];
DELETE FROM niches WHERE key IN ('economics', 'social_sciences', 'humanities', 'aviation', 'maritime', 'public_service', 'security_defense',
  'logistics', 'beauty', 'fashion', 'performing_arts', 'allied_health');
-- (the new fields and their directions: code-only ids, unknown once the code is rolled back)
UPDATE users SET field_id = NULL WHERE field_id IN ('econ', 'social', 'hum', 'avia', 'sea', 'vet', 'public', 'security', 'logistics', 'beauty', 'fashion', 'perform', 'allied');
UPDATE users SET extra_fields = (SELECT coalesce(array_agg(f), '{}') FROM unnest(extra_fields) f WHERE f NOT IN ('econ', 'social', 'hum', 'avia', 'sea', 'vet',
  'public', 'security', 'logistics', 'beauty', 'fashion', 'perform', 'allied')) WHERE cardinality(extra_fields) > 0;
UPDATE users SET directions = (SELECT coalesce(array_agg(d), '{}') FROM unnest(directions) d WHERE split_part(d, '.', 1) NOT IN ('econ', 'social', 'hum', 'avia',
  'sea', 'vet', 'public', 'security', 'logistics', 'beauty', 'fashion', 'perform', 'allied')) WHERE cardinality(directions) > 0;
