-- docs/CLAUDE-CODE-SEO.md 5: "რჩევები", articles the owner writes in Admin for what students search for (how to choose a profession,
-- which faculty, ...). One row per article, with its Georgian text, its English text, or both (a language exists when its title, intro and
-- body are all there). Nothing is public until an admin presses Publish (status 'published'); a draft, or an article taken down again,
-- answers 404 and is not in the sitemap. Nothing is seeded: the table starts empty.
-- ADDITIVE ONLY: one new table. Undo: migrations/down/068_articles.down.sql.
CREATE TABLE IF NOT EXISTS articles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text        NOT NULL UNIQUE,              -- the address: /ka/advice-articles/<slug> and /advice-articles/<slug>
  status              text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  category            text,                                     -- a field id (server/categories.js); NULL = general
  author_name         text        NOT NULL DEFAULT '',          -- the real author, as the owner typed it
  article_date        date,                                     -- the date shown on the article (set by the admin, or the day of the first publish)
  title_ka            text        NOT NULL DEFAULT '',
  intro_ka            text        NOT NULL DEFAULT '',
  body_ka             text        NOT NULL DEFAULT '',
  title_en            text        NOT NULL DEFAULT '',
  intro_en            text        NOT NULL DEFAULT '',
  body_en             text        NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),       -- the text was last changed
  published_at        timestamptz,                              -- the last time Publish was pressed
  first_published_at  timestamptz,                              -- once public, the address (slug) no longer changes
  created_by          uuid        REFERENCES users(id) ON DELETE SET NULL,
  published_by        uuid        REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS articles_published ON articles (article_date DESC, created_at DESC) WHERE status = 'published';
