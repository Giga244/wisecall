-- docs/CLAUDE-CODE-NEW-CATEGORIES.md: 12 new niches for the new fields in server/categories.js. Two of the requested 14 already exist:
-- "Politics & International Relations" is the niche 'politics' (migration 019) and "Veterinary Medicine" is 'veterinary' (058).
-- Aviation, maritime and allied health are regulated (server/verification/registries.js): never approved automatically, a licence,
-- certificate or diploma is checked by a person. Only mentors who choose the new fields count as them: the directions that moved keep
-- the niche they had (server/categories.js MOVED), so no existing mentor's rules change.
-- ADDITIVE: no existing row changes. Undo: migrations/down/064_new_categories.down.sql.
INSERT INTO niches (key, name_en, name_ka, icon, regulated, sort) VALUES
  ('economics', 'Economics', 'ეკონომიკა', 'finance', false, 370),
  ('social_sciences', 'Social Sciences', 'სოციალური მეცნიერებები', 'science', false, 371),
  ('humanities', 'Humanities', 'ჰუმანიტარული მეცნიერებები', 'writing', false, 372),
  ('aviation', 'Aviation', 'ავიაცია', 'plane', true, 373),
  ('maritime', 'Maritime', 'საზღვაო საქმე', 'map', true, 374),
  ('public_service', 'Public Service & Diplomacy', 'საჯარო სამსახური და დიპლომატია', 'building', false, 375),
  ('security_defense', 'Law Enforcement & Military', 'სამართალდამცავი და სამხედრო სფერო', 'shield', false, 376),
  ('logistics', 'Logistics & Supply Chain', 'ლოგისტიკა და მიწოდების ჯაჭვი', 'cart', false, 377),
  ('beauty', 'Beauty & Cosmetology', 'სილამაზე და კოსმეტოლოგია', 'star', false, 378),
  ('fashion', 'Fashion', 'მოდა', 'design', false, 379),
  ('performing_arts', 'Theatre, Acting & Dance', 'თეატრი, მსახიობობა და ცეკვა', 'creative', false, 380),
  ('allied_health', 'Allied Health', 'ჯანდაცვის სხვა პროფესიები', 'medicine', true, 381)
ON CONFLICT (key) DO NOTHING;
