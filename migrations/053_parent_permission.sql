-- Parent or guardian permission for 16-17 (docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 2): when the minor confirmed it. No parent's email or name is
-- asked for or stored. ADDITIVE. Undo: migrations/down/053_parent_permission.down.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_permission_at timestamptz;
