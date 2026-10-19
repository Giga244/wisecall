-- The question a visitor typed on the home page before joining the waiting list (docs/CLAUDE-CODE-UX-WALKTHROUGH.md E): shown to the
-- admins as anonymous demand (the text and the field only, never with the email), to know which mentors to recruit. ADDITIVE ONLY: one
-- nullable column; nothing existing changes. Undo: migrations/down/044_waitlist_question.down.sql.
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS wanted_question text CHECK (wanted_question IS NULL OR char_length(wanted_question) <= 300);
