-- Mentor verification, rules v2: Identity -> Experience -> Review (see server/verification/rules.js).
-- ADDITIVE ONLY: new columns and tables; no column or table is dropped and no existing row is deleted or changed, except that the new
-- columns get their first values. Old verification steps stay in verification_steps for the record. Every data change below is safe to
-- run on a database where part of it already exists. To undo it, see migrations/down/018_verification_v2.down.sql.

-- The Experience form. (Title = users.role_title, niche = users.niche, sample answer = users.sample_answer: already there.)
ALTER TABLE users ADD COLUMN specialty_tags           text[]   NOT NULL DEFAULT '{}';   -- up to 8 (checked in code)
ALTER TABLE users ADD COLUMN years_experience         smallint CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 70);
ALTER TABLE users ADD COLUMN story                    text;                             -- "Your story", 100-1500 characters (checked in code)
ALTER TABLE users ADD COLUMN application_submitted_at timestamptz;                      -- when the mentor last pressed "Submit for review"
ALTER TABLE users ADD COLUMN verification_rules       smallint NOT NULL DEFAULT 2;      -- which rules version made the last decision

-- Evidence: at least one item of ANY kind; none is required by itself.
CREATE TABLE mentor_evidence (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind          text        NOT NULL CHECK (kind IN ('linkedin', 'website', 'portfolio', 'social', 'publication', 'company',
                                                     'diploma', 'product', 'testimonials', 'work_email', 'other')),
  url           text,                                   -- http(s) only (checked in code)
  registry_id   text,                                   -- kind = company: a Georgian Public Registry identification code
  document_id   uuid        REFERENCES verification_documents (id) ON DELETE SET NULL, -- kind = diploma: the uploaded file (encrypted, admin-only)
  note          text,                                   -- what it is, in the mentor's words (max 200)
  check_status  text        NOT NULL DEFAULT 'unchecked'
                            CHECK (check_status IN ('unchecked', 'ok', 'warning', 'failed', 'admin_check')),
  auto_verified boolean     NOT NULL DEFAULT false,     -- the page opened AND showed the mentor's name or brand
  check_result  jsonb       NOT NULL DEFAULT '{}'::jsonb, -- final address, HTTP status, page title/description, domain age, flags
  checked_at    timestamptz,
  decided_by    uuid        REFERENCES users (id),      -- an admin who confirmed or refused it by hand (diplomas, company IDs)
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mentor_evidence_user_idx ON mentor_evidence (user_id);
CREATE INDEX mentor_evidence_url_idx  ON mentor_evidence (lower(url)) WHERE url IS NOT NULL;           -- the same link on several accounts
CREATE UNIQUE INDEX mentor_evidence_one_url ON mentor_evidence (user_id, lower(url)) WHERE url IS NOT NULL;

-- Each automatic analysis (step 3). Kept as history: an admin sees the latest one on top, and why it came out that way.
CREATE TABLE verification_reviews (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rules_version    smallint      NOT NULL,
  trigger          text          NOT NULL CHECK (trigger IN ('submitted', 'resubmitted', 'identity', 'migrated', 'admin_rerun')),
  submitted_at     timestamptz,                             -- which submission this analysed (users.application_submitted_at)
  status           text          NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  checks           jsonb         NOT NULL DEFAULT '{}'::jsonb,  -- identity, age 18+, names, link checks, account signals
  ai               jsonb,                                       -- the validated AI result: 5 scores, red flags, summaries, recommendation
  ai_model         text,                                        -- the model whose answer was used
  ai_error         text,                                        -- why the AI step was skipped or failed (it then goes to a person)
  ai_attempts      jsonb         NOT NULL DEFAULT '[]'::jsonb,  -- every call: model, tokens, cost, stop reason
  ai_input_tokens  integer       NOT NULL DEFAULT 0,
  ai_output_tokens integer       NOT NULL DEFAULT 0,
  ai_cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
  risk             text          CHECK (risk IN ('low', 'medium', 'high')),
  outcome          text          CHECK (outcome IN ('auto_approved', 'needs_human')),
  reasons          jsonb         NOT NULL DEFAULT '[]'::jsonb,  -- why it came out this way (codes the admin panel explains)
  created_at       timestamptz   NOT NULL DEFAULT now(),
  finished_at      timestamptz
);
CREATE INDEX verification_reviews_user_idx  ON verification_reviews (user_id, created_at DESC);
CREATE INDEX verification_reviews_cost_idx  ON verification_reviews (created_at) WHERE ai_cost_usd > 0;

-- Account signals for the risk level (many applications from one network or device). Only keyed hashes are stored: comparable with
-- each other, never reversible to an IP address. Deleted after 180 days by the housekeeping job.
CREATE TABLE account_signals (
  id          bigserial   PRIMARY KEY,
  user_id     uuid        REFERENCES users (id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('signup', 'login', 'application')),
  ip_hash     text,
  device_hash text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_signals_ip_idx     ON account_signals (ip_hash, created_at DESC);
CREATE INDEX account_signals_device_idx ON account_signals (device_hash, created_at DESC);
CREATE INDEX account_signals_age_idx    ON account_signals (created_at);

-- ---- Carry over what mentors already did (rules v1 -> v2) ----------------------------------------------------------------------
-- Decisions already made were made under the first rules.
UPDATE users SET verification_rules = 1 WHERE verification_status IN ('verified', 'suspended', 'rejected');

-- Evidence from the old steps: the proof link, a portfolio, a company ID, uploaded diplomas / role proofs, a verified work email.
INSERT INTO mentor_evidence (user_id, kind, url, created_at)
  SELECT id, CASE WHEN proof_url ~* '^https?://([a-z]+\.)?linkedin\.com/' THEN 'linkedin' ELSE 'other' END, left(proof_url, 500), created_at
    FROM users WHERE role IN ('mentor', 'both') AND proof_url ~* '^https?://[^\s]+$'
  ON CONFLICT DO NOTHING;
INSERT INTO mentor_evidence (user_id, kind, url, created_at)
  SELECT user_id, 'portfolio', left(evidence->>'url', 500), created_at FROM verification_steps
   WHERE step = 'portfolio' AND evidence->>'url' ~* '^https?://[^\s]+$'
  ON CONFLICT DO NOTHING;
INSERT INTO mentor_evidence (user_id, kind, registry_id, check_status, created_at)
  SELECT s.user_id, 'company', s.evidence->>'companyId', 'admin_check', s.created_at FROM verification_steps s
   WHERE s.step = 'company_id' AND coalesce(s.evidence->>'companyId', '') <> ''
     AND NOT EXISTS (SELECT 1 FROM mentor_evidence e WHERE e.user_id = s.user_id AND e.kind = 'company' AND e.registry_id = s.evidence->>'companyId');
INSERT INTO mentor_evidence (user_id, kind, document_id, check_status, created_at)
  SELECT d.user_id, 'diploma', d.id, 'admin_check', d.uploaded_at FROM verification_documents d
   WHERE d.step IN ('diploma', 'role_proof')
     AND NOT EXISTS (SELECT 1 FROM mentor_evidence e WHERE e.document_id = d.id);
INSERT INTO mentor_evidence (user_id, kind, check_status, auto_verified, created_at)
  SELECT s.user_id, 'work_email', 'ok', true, s.created_at FROM verification_steps s
   WHERE s.step = 'work_email' AND s.status = 'passed'
     AND NOT EXISTS (SELECT 1 FROM mentor_evidence e WHERE e.user_id = s.user_id AND e.kind = 'work_email');

-- Approved (and suspended) mentors keep their approval: the Experience step counts as passed, dated when they were approved, and
-- their application counts as submitted.
INSERT INTO verification_steps (user_id, step, status, reason, decided_at)
  SELECT id, 'experience', 'passed', 'carried over from verification rules v1', coalesce(verification_decided_at, now())
    FROM users WHERE role IN ('mentor', 'both') AND verification_status IN ('verified', 'suspended')
  ON CONFLICT (user_id, step) DO NOTHING;
UPDATE users SET application_submitted_at = coalesce(verification_decided_at, created_at)
 WHERE role IN ('mentor', 'both') AND verification_status IN ('verified', 'suspended') AND application_submitted_at IS NULL;
INSERT INTO verification_audit (mentor_id, actor_label, action, reason)
  SELECT u.id, 'system', 'migrated_to_rules_v2', 'verification rules v2: earlier steps carried over'
    FROM users u WHERE u.role IN ('mentor', 'both') AND u.verification_status <> 'none'
     AND NOT EXISTS (SELECT 1 FROM verification_audit a WHERE a.mentor_id = u.id AND a.action = 'migrated_to_rules_v2');

-- A long enough profile bio becomes the starting "Your story" (the mentor can edit it before submitting).
UPDATE users SET story = left(bio, 1500) WHERE role IN ('mentor', 'both') AND story IS NULL AND length(coalesce(bio, '')) >= 100;
-- (The server then, after it starts: works out the age step from the ID check for everyone who passed it, analyses pending applications
--  whose Experience form is complete, and sends the others one "we simplified verification" email. See server/verification/carryOver.js.)
