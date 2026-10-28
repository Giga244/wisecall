-- What makes Wisecall ours (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 4). ADDITIVE: founding mentors, the university badge,
-- "show my profile on the home page" (off), and sample answers to the team's own questions. Undo: migrations/down/050_founding_university_samples.down.sql.

-- A mentor approved before launch is a founding mentor, for good. Every mentor approved so far was approved before launch (the site has
-- stayed in prelaunch: LAUNCH_MODE), so they are founding mentors, dated by their approval.
ALTER TABLE users ADD COLUMN IF NOT EXISTS founding_mentor_at timestamptz;
UPDATE users SET founding_mentor_at = COALESCE(verification_decided_at, now())
  WHERE verification_status = 'verified' AND founding_mentor_at IS NULL AND role IN ('mentor', 'both');

-- "University lecturer · <university>": from a checked page on a known university's site, or confirmed by an admin; an admin can remove it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS university_domain text CHECK (university_domain IS NULL OR university_domain ~ '^[a-z0-9.-]{3,80}$');
ALTER TABLE users ADD COLUMN IF NOT EXISTS university_badge text CHECK (university_badge IN ('confirmed', 'removed'));

-- The home page's "our mentors": only mentors who chose it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_on_home boolean NOT NULL DEFAULT false;

-- Questions the team writes, for approved mentors to answer before launch ("How do I choose a faculty?").
CREATE TABLE IF NOT EXISTS sample_questions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  question    text        NOT NULL CHECK (char_length(question) BETWEEN 20 AND 1000),
  niche       text,
  active      boolean     NOT NULL DEFAULT true,
  created_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- A sample answer is a public answer with no booking behind it: the same review, the same pages, the same withdraw, marked "sample".
ALTER TABLE public_answers ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE public_answers ADD COLUMN IF NOT EXISTS sample_question_id uuid REFERENCES sample_questions (id) ON DELETE SET NULL;
ALTER TABLE public_answers ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE public_answers ADD CONSTRAINT public_answers_booking_or_sample CHECK (booking_id IS NOT NULL OR is_sample);
CREATE UNIQUE INDEX IF NOT EXISTS public_answers_one_sample_idx ON public_answers (mentor_id, sample_question_id) WHERE is_sample AND sample_question_id IS NOT NULL;
-- (published still needs both people's yes; a sample has no asker, so the mentor's yes and the admin's review are what count)
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public_answers'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%asker_consent IS TRUE%' LOOP
    EXECUTE format('ALTER TABLE public_answers DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public_answers ADD CONSTRAINT public_answers_published_consent
  CHECK (status <> 'published' OR ((asker_consent IS TRUE OR is_sample) AND mentor_consent IS TRUE AND slug IS NOT NULL));
