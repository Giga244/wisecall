-- PART 7A: public answers (an opt-in library). An answered question becomes a public page only when the asker AND the mentor agreed
-- and an admin approved it; either can withdraw it at any time. ADDITIVE ONLY: one new column (every mentor starts at "ask me each time")
-- and two new tables. Undo: migrations/down/032_public_answers.down.sql.
ALTER TABLE users ADD COLUMN public_answers_pref text NOT NULL DEFAULT 'ask' CHECK (public_answers_pref IN ('always', 'ask', 'never'));

CREATE TABLE public_answers (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid        NOT NULL UNIQUE REFERENCES bookings (id) ON DELETE CASCADE,
  mentor_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  asker_id           uuid        REFERENCES users (id) ON DELETE SET NULL,
  niche              text,
  regulated          boolean     NOT NULL DEFAULT false,
  status             text        NOT NULL CHECK (status IN ('declined', 'pending_mentor', 'pending_review', 'published', 'rejected', 'withdrawn')),
  asker_consent      boolean,
  asker_decided_at   timestamptz,
  mentor_consent     boolean,
  mentor_decided_at  timestamptz,
  question_public    text        CHECK (question_public IS NULL OR char_length(question_public) <= 1000),
  answer_public      text,
  slug               text        UNIQUE,
  allow_regulated    boolean     NOT NULL DEFAULT false,
  reviewed_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  reject_reason      text,
  published_at       timestamptz,
  withdrawn_at       timestamptz,
  withdrawn_by       text        CHECK (withdrawn_by IS NULL OR withdrawn_by IN ('asker', 'mentor', 'admin', 'account')),
  helpful_count      integer     NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- (published means both agreed: the database refuses anything else)
  CHECK (status <> 'published' OR (asker_consent IS TRUE AND mentor_consent IS TRUE AND slug IS NOT NULL))
);
CREATE INDEX public_answers_published_idx ON public_answers (published_at DESC) WHERE status = 'published';
CREATE INDEX public_answers_review_idx ON public_answers (created_at) WHERE status = 'pending_review';
CREATE INDEX public_answers_mentor_idx ON public_answers (mentor_id) WHERE status = 'published';

-- "Helpful": one per visitor (a keyed hash of a random id the visitor's browser keeps; nothing personal).
CREATE TABLE public_answer_votes (
  answer_id  uuid        NOT NULL REFERENCES public_answers (id) ON DELETE CASCADE,
  voter      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (answer_id, voter)
);
