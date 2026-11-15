-- docs/CLAUDE-CODE-MENTOR-MATCH.md: "Find your mentor" (stage 1, rules only). One row per match that was made: the category and how many
-- mentors were found (the simple counts the admins see). A signed-in person's answers are kept with it (their stage, starting-point tags,
-- directions and what worries them most), so a later stage can use them; the free text is emptied after 30 days (server/matching.js
-- purgeOld). A visitor without an account leaves nothing but the count: no answers, no text.
-- The free text is never shown to mentors or admins.
-- ADDITIVE ONLY: one new table. Undo: migrations/down/067_match_runs.down.sql.
CREATE TABLE IF NOT EXISTS match_runs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  field_id    text        NOT NULL,                       -- the category the student chose (server/categories.js)
  results     smallint    NOT NULL CHECK (results BETWEEN 0 AND 10), -- how many mentors were shown
  user_id     uuid        REFERENCES users(id) ON DELETE CASCADE,    -- only for a signed-in person
  stage       text,                                       -- school | university | switching | working (signed in only)
  start_tags  text[],
  directions  text[],
  worry       text                                        -- the free text (signed in only; emptied after 30 days; never shown to anyone)
);
CREATE INDEX IF NOT EXISTS match_runs_created ON match_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS match_runs_user ON match_runs (user_id) WHERE user_id IS NOT NULL;
