-- Strict mentor verification: instead of one admin checklist, every mentor has a set of steps
-- (email, ID check, name match, sample answer, proof link, licence, ...). Which steps are required
-- depends on the niche (see server/verification/rules.js). Final approval by an admin is only
-- possible when every required step has passed.

-- 'suspended' hides a mentor at once (their open questions are refunded).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_verification_status_check;
ALTER TABLE users ADD CONSTRAINT users_verification_status_check
  CHECK (verification_status IN ('none', 'pending', 'verified', 'rejected', 'suspended'));

ALTER TABLE users ADD COLUMN verification_decided_at timestamptz;
ALTER TABLE users ADD COLUMN suspended_at timestamptz;
ALTER TABLE users ADD COLUMN suspension_reason text;
-- The old three-checkbox record is replaced by the steps below.
ALTER TABLE users DROP COLUMN verification_checks;

-- One row per mentor per step.
--   pending  submitted (or auto-flagged) and waiting for a decision
--   passed   approved
--   failed   rejected; the mentor is told why and can try again
-- evidence holds only non-sensitive details that admins need (never ID images or licence numbers).
CREATE TABLE verification_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  step        text        NOT NULL,
  status      text        NOT NULL CHECK (status IN ('pending', 'passed', 'failed')),
  evidence    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  reason      text,
  decided_by  uuid        REFERENCES users (id),                -- null = the system (or the ID provider)
  decided_at  timestamptz,
  expires_at  timestamptz,                                      -- for things that need re-checking, like licences
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, step)
);
CREATE INDEX verification_steps_status_idx ON verification_steps (status, updated_at);

-- Who did what, when. Never edited or deleted.
CREATE TABLE verification_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  actor_id     uuid        REFERENCES users (id),               -- null = the system
  actor_label  text,                                            -- 'system', 'kyc-provider', or an admin's email at the time
  action       text        NOT NULL,                            -- step_passed, step_failed, step_submitted, approved, rejected, suspended, ...
  step         text,
  from_status  text,
  to_status    text,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_audit_mentor_idx ON verification_audit (mentor_id, created_at DESC);

-- Mentors approved under the old, weaker process must go through the new steps. Nobody real is
-- affected yet: this only moves them back to "pending" so they disappear from listings.
UPDATE users SET verification_status = 'pending' WHERE verification_status = 'verified';
