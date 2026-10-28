-- A waiting list that converts (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 5). ADDITIVE: where each sign-up came from (the same
-- first-party attribution as accounts: server/attribution.js; ?ref=tiktok, ?ref=instagram ...). Undo: migrations/down/051_waitlist_source.down.sql.
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS source jsonb;
