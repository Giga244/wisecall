-- Professional credentials: a licence or registration number, private documents (licence scans,
-- diplomas, proof of role), and a verified work email.

-- The licence number is stored encrypted and shown only to admins. Only the last four characters are
-- kept readable. holder_name is the name as it is written on the licence (compared with the ID name).
CREATE TABLE mentor_credentials (
  user_id            uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  license_number_enc text        NOT NULL,
  license_last4      text,
  issuing_body       text        NOT NULL,
  holder_name        text        NOT NULL,
  valid_until        date,
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Uploaded files. The bytes are encrypted (AES-256-GCM) before they are stored in the database, so
-- they are never on the web server's disk, never reachable by a public address, and only an admin can
-- download them. delete_after is set when a decision is made on the step; a background job then removes
-- the row 90 days later.
CREATE TABLE verification_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  step         text        NOT NULL,
  filename     text        NOT NULL,
  mime         text        NOT NULL CHECK (mime IN ('application/pdf', 'image/jpeg')),
  size         integer     NOT NULL,
  data_enc     bytea       NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  delete_after timestamptz
);
CREATE INDEX verification_documents_user_idx ON verification_documents (user_id, step);
CREATE INDEX verification_documents_purge_idx ON verification_documents (delete_after) WHERE delete_after IS NOT NULL;

-- Work email at a company or institution (free mailbox providers are refused by the server).
ALTER TABLE users ADD COLUMN work_email text;
ALTER TABLE users ADD COLUMN work_email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN work_email_code_hash text;
ALTER TABLE users ADD COLUMN work_email_code_expires_at timestamptz;
