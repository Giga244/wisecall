-- Wrong email codes are counted per account (docs/AUDIT.md #2): after 5 wrong codes the code is cleared and a new one must be asked
-- for. The same for the work-email code (the optional "Work email verified" badge). Additive only.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_code_attempts      smallint NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS work_email_code_attempts smallint NOT NULL DEFAULT 0;
