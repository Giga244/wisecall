-- Two-way ratings. After a paid question is answered, the asker rates the mentor (stars, tags, a written review) and the mentor
-- rates the asker (stars, tags, an optional private note to the Wisecall team). Double-blind: neither sees the other's rating until
-- both have rated, or 7 days after the answer became readable, whichever is first (see server/ratings.js).

CREATE TABLE ratings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid        NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  direction     text        NOT NULL CHECK (direction IN ('asker_to_mentor', 'mentor_to_asker')),
  rater_id      uuid        NOT NULL REFERENCES users (id),
  ratee_id      uuid        NOT NULL REFERENCES users (id),
  stars         smallint    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags          text[]      NOT NULL DEFAULT '{}',
  review        text,                   -- the written review (asker to mentor only; public once revealed)
  private_note  text,                   -- a note to the Wisecall team (mentor to asker only; never shown to the person rated)
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  edited_at     timestamptz,            -- it can be changed until it is revealed, never afterwards
  revealed_at   timestamptz,            -- null = still hidden from the other person
  hidden_at     timestamptz,            -- taken down by an admin (who and why is in rating_audit)
  UNIQUE (booking_id, direction)        -- each of the two people rates once
);
CREATE INDEX ratings_visible_idx ON ratings (ratee_id, direction) WHERE revealed_at IS NOT NULL AND hidden_at IS NULL;
CREATE INDEX ratings_hidden_from_view_idx ON ratings (booking_id) WHERE revealed_at IS NULL;

-- The mentor may answer a public review once, in public.
CREATE TABLE review_replies (
  rating_id  uuid        PRIMARY KEY REFERENCES ratings (id) ON DELETE CASCADE,
  mentor_id  uuid        NOT NULL REFERENCES users (id),
  body       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden_at  timestamptz
);

-- "Report this review": goes to the admin queue. One report per person per review.
CREATE TABLE review_reports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rating_id       uuid        NOT NULL REFERENCES ratings (id) ON DELETE CASCADE,
  reporter_id     uuid        NOT NULL REFERENCES users (id),
  reason          text        NOT NULL CHECK (reason IN ('abusive', 'false', 'personal_info', 'spam', 'other')),
  details         text,
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution      text        CHECK (resolution IN ('dismissed', 'hidden')),
  resolution_note text,
  resolved_by     uuid        REFERENCES users (id),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rating_id, reporter_id)
);
CREATE INDEX review_reports_open_idx ON review_reports (created_at) WHERE status = 'open';

-- Every moderation action with the admin's written reason.
CREATE TABLE rating_audit (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rating_id  uuid        NOT NULL REFERENCES ratings (id) ON DELETE CASCADE,
  action     text        NOT NULL,       -- hidden, unhidden, report_dismissed, reply_hidden
  by_email   text        NOT NULL,
  reason     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Reminder emails ("please rate", after 2 and after 6 days), sent once per person per kind.
CREATE TABLE rating_reminders (
  booking_id uuid        NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  party      text        NOT NULL CHECK (party IN ('asker', 'mentor')),
  kind       text        NOT NULL CHECK (kind IN ('d2', 'd6')),
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, party, kind)
);

-- The reviews that already exist (they were public when they were written): asker to mentor, already revealed.
-- (bookings.rating, bookings.review and bookings.reviewed_at are no longer written or read.)
INSERT INTO ratings (booking_id, direction, rater_id, ratee_id, stars, review, submitted_at, revealed_at)
SELECT id, 'asker_to_mentor', seeker_id, mentor_id, rating, review, COALESCE(reviewed_at, now()), COALESCE(reviewed_at, now())
  FROM bookings WHERE rating IS NOT NULL;
