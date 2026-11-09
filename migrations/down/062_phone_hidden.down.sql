-- Undoes 062_phone_hidden.sql. (Answers an admin kept off the home page's phone may be shown there again.)
ALTER TABLE public_answers DROP COLUMN IF EXISTS phone_hidden_at;
