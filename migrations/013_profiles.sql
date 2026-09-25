-- Public profiles for everyone (askers and mentors): a username, a photo, and a few details.

ALTER TABLE users ADD COLUMN username            text;
ALTER TABLE users ADD COLUMN username_changed_at timestamptz;          -- null until the person changes the username themselves
ALTER TABLE users ADD COLUMN username_confirmed  boolean NOT NULL DEFAULT true; -- false for a name we suggested (Google sign-in) until they accept or change it
ALTER TABLE users ADD COLUMN headline            text;                 -- "What I do", for example "Medical student at TSMU"
ALTER TABLE users ADD COLUMN current_work        text;                 -- current work or study
ALTER TABLE users ADD COLUMN city                text;
ALTER TABLE users ADD COLUMN languages           text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN linkedin_url        text;
ALTER TABLE users ADD COLUMN website_url         text;
ALTER TABLE users ADD COLUMN profile_visibility  text NOT NULL DEFAULT 'public' CHECK (profile_visibility IN ('public', 'contacts'));
ALTER TABLE users ADD COLUMN photo_updated_at    timestamptz;          -- null = no photo (initials are shown)

-- People who sign in with Google can have no password at all.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX users_username_key ON users (lower(username));

-- Every username someone has given up keeps pointing at them (old links redirect) and cannot be taken by anyone else.
CREATE TABLE username_history (
  old_username text        PRIMARY KEY,           -- lower case
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX username_history_user_idx ON username_history (user_id);

-- The profile photo, already resized and stripped of its metadata, kept in the database (see server/images.js).
CREATE TABLE user_photos (
  user_id    uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  mime       text        NOT NULL,
  data       bytea       NOT NULL,
  source     text        NOT NULL CHECK (source IN ('upload', 'google')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
