-- The home page's phone shows a random published answer each time (docs/CLAUDE-CODE-RANDOM-PHONE.md): an admin can keep any one of them
-- off the phone. (Pinning one to be shown first stays in site_settings 'home_qa'.)
-- ADDITIVE: a new empty column, no existing row changes. Undo: migrations/down/062_phone_hidden.down.sql.
ALTER TABLE public_answers ADD COLUMN IF NOT EXISTS phone_hidden_at timestamptz;
