-- ID verification (KYC) through an external provider. We NEVER store ID images or the document
-- number. Only what an admin needs to compare names and know the check happened is kept: the
-- provider's session id, its status, the verified full name and date of birth (both encrypted),
-- the country, and when it was decided.
CREATE TABLE kyc_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider            text        NOT NULL,
  provider_session_id text        NOT NULL,
  status              text        NOT NULL DEFAULT 'created'
                      CHECK (status IN ('created', 'approved', 'declined', 'in_review', 'expired', 'not_finished')),
  verified_name_enc   text,                    -- AES-256-GCM, see server/cryptoBox.js
  birth_date_enc      text,
  country             text,                    -- ISO 3166 code of the issuing country
  decided_at          timestamptz,
  last_event_id       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_session_id)
);
CREATE INDEX kyc_sessions_user_idx ON kyc_sessions (user_id, created_at DESC);

-- Webhook deliveries already handled (providers retry, so each event id is processed once).
CREATE TABLE kyc_events (
  event_id     text PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now()
);
