-- Small settings an admin chooses on the site (docs/CLAUDE-CODE-NEW-HOME.md 2.2): for now which public answer the home page's phone shows
-- ('home_qa'). One row per setting.
-- ADDITIVE: a new table, no existing row changes. Undo: migrations/down/061_site_settings.down.sql.
CREATE TABLE IF NOT EXISTS site_settings (
  key         text        PRIMARY KEY,
  value       jsonb,
  updated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
