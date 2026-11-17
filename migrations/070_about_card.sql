-- "შენ შესახებ" is required for new applications (server/mentorStory.js aboutReason). An approved mentor without one is never hidden,
-- blocked or sent back to review: the dashboard shows them one card, "add „შენ შესახებ“", until they write it or close the card.
-- about_card_dismissed_at: when that card was closed (it does not come back).
-- ADDITIVE ONLY: one nullable column. Undo: migrations/down/070_about_card.down.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS about_card_dismissed_at timestamptz;
