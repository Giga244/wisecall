-- Vets and nutritionists get their own regulated categories (until now their chips counted as medicine, which asks for a doctor's state certificate).
-- Still never approved automatically, still reviewed by a person; what is accepted is their own diploma, certificate or licence (server/verification/
-- registries.js). ADDITIVE: no existing mentor changes. Undo: migrations/down/058_vet_nutrition.down.sql.
INSERT INTO niches (key, name_en, name_ka, icon, regulated, sort) VALUES
  ('veterinary', 'Veterinary medicine', 'ვეტერინარია', 'medicine', true, 366),
  ('nutrition', 'Nutrition', 'ნუტრიციოლოგია', 'medicine', true, 367)
ON CONFLICT (key) DO NOTHING;
