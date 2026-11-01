-- Contact details stopped in a question or an answer (docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 4): who, where and which kinds, for the admins' counts per
-- person. The text itself is never kept. ADDITIVE. Undo: migrations/down/055_contact_blocks.down.sql.
CREATE TABLE IF NOT EXISTS contact_blocks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surface    text NOT NULL CHECK (surface IN ('question', 'answer')),
  kinds      text[] NOT NULL,
  minor      boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_blocks_user_idx ON contact_blocks (user_id, created_at DESC);
