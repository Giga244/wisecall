-- Rich, optional profiles (docs/PROFILES-PLAN.md): list sections (experience, education, licences, projects, journey), skills, language
-- levels, more links, per-section visibility, the "verified" mark per item, reports and admin hiding. ADDITIVE ONLY: new tables; nothing
-- existing changes. People who already shared a headline, about, languages or links keep them visible as today (see the last statement).
-- Undo: migrations/down/039_profiles_rich.down.sql.

CREATE TABLE profile_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  section       text        NOT NULL CHECK (section IN ('experience', 'education', 'licence', 'project', 'journey')),
  position      integer     NOT NULL DEFAULT 0,
  data          jsonb       NOT NULL,
  verified_at   timestamptz,
  verified_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
  verified_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_items_user_idx ON profile_items (user_id, section, position);

-- A project's picture (the profile-photo pipeline: re-encoded, so no EXIF).
CREATE TABLE profile_item_images (
  item_id    uuid        PRIMARY KEY REFERENCES profile_items (id) ON DELETE CASCADE,
  mime       text        NOT NULL,
  data       bytea       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profile_settings (
  user_id         uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  skills          text[]      NOT NULL DEFAULT '{}',
  top_skills      text[]      NOT NULL DEFAULT '{}',
  language_levels jsonb       NOT NULL DEFAULT '{}'::jsonb,
  links           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  visibility      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  admin_hidden    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  hidden_at       timestamptz,
  hidden_reason   text,
  hidden_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
  search_text     text        NOT NULL DEFAULT '',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profile_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reporter_id uuid        REFERENCES users (id) ON DELETE SET NULL,
  reason      text        NOT NULL CHECK (reason IN ('fake', 'offensive', 'personal_info', 'spam', 'other')),
  details     text        CHECK (details IS NULL OR char_length(details) <= 1000),
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution  text,
  resolved_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX profile_reports_one_open ON profile_reports (owner_id, reporter_id) WHERE status = 'open';

-- Nothing disappears: whoever already shared one of these keeps it visible to the people who could see it before.
INSERT INTO profile_settings (user_id, visibility)
SELECT u.id, jsonb_strip_nulls(jsonb_build_object(
         'headline', CASE WHEN COALESCE(u.headline, u.current_work, u.city) IS NOT NULL THEN 'everyone' END,
         'about', CASE WHEN u.bio IS NOT NULL AND u.bio <> '' THEN 'everyone' END,
         'languages', CASE WHEN cardinality(COALESCE(u.languages, '{}')) > 0 THEN 'everyone' END,
         'links', CASE WHEN COALESCE(u.linkedin_url, u.website_url) IS NOT NULL THEN 'everyone' END))
  FROM users u
 WHERE u.deleted_at IS NULL
   AND (COALESCE(u.headline, u.current_work, u.city, u.bio, u.linkedin_url, u.website_url) IS NOT NULL OR cardinality(COALESCE(u.languages, '{}')) > 0)
ON CONFLICT (user_id) DO NOTHING;
