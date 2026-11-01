-- Questions from 16-17-year-olds (docs/CLAUDE-CODE-ASKERS-16-PLUS.md parts 3 and 5): fixed when the question is asked, and when the minor confirmed that
-- an adult pays. Prices, the fee, refunds and the bank do not change. ADDITIVE: every existing question stays "not a minor" (a constant default rewrites
-- nothing). Undo: migrations/down/054_minor_questions.down.sql.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS asker_minor boolean NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS adult_payer_confirmed_at timestamptz;
