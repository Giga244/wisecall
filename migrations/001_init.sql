-- Wisecall initial schema

CREATE TABLE users (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text        NOT NULL,
  email                     text        NOT NULL,
  password_hash             text        NOT NULL,
  role                      text        NOT NULL DEFAULT 'seeker' CHECK (role IN ('seeker', 'mentor', 'both')),
  niche                     text,
  role_title                text,
  bio                       text,
  price                     integer     CHECK (price IS NULL OR price BETWEEN 1 AND 5000),
  color                     text,
  stripe_account_id         text,
  language                  text        NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ka')),
  verification_status       text        NOT NULL DEFAULT 'none' CHECK (verification_status IN ('none', 'pending', 'verified', 'rejected')),
  proof_url                 text,
  sample_answer             text,
  verification_note         text,
  verification_checks       jsonb,
  email_verified            boolean     NOT NULL DEFAULT false,
  email_code_hash           text,
  email_code_expires_at     timestamptz,
  reset_token_hash          text,
  reset_token_expires_at    timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_listed_idx ON users (niche) WHERE verification_status = 'verified';

CREATE TABLE bookings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seeker_id                 uuid        NOT NULL REFERENCES users (id),
  mentor_id                 uuid        NOT NULL REFERENCES users (id),
  question                  text        NOT NULL,
  answer                    text,
  rating                    smallint    CHECK (rating BETWEEN 1 AND 5),
  review                    text,
  reviewed_at               timestamptz,
  amount                    integer     NOT NULL CHECK (amount > 0),
  currency                  text        NOT NULL,
  platform_fee_percent      numeric     NOT NULL,
  platform_fee_amount       integer     NOT NULL,
  mentor_net_amount         integer     NOT NULL,
  status                    text        NOT NULL CHECK (status IN ('pending_payment', 'paid', 'answered', 'refunded', 'expired')),
  mode                      text        NOT NULL CHECK (mode IN ('stripe', 'simulated')),
  stripe_session_id         text,
  stripe_payment_intent_id  text,
  paid_at                   timestamptz,
  answered_at               timestamptz,
  answer_deadline           timestamptz,
  refunded_at               timestamptz,
  refund_reason             text,
  stripe_refund_id          text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bookings_seeker_idx ON bookings (seeker_id, created_at DESC);
CREATE INDEX bookings_mentor_idx ON bookings (mentor_id, created_at DESC);
CREATE INDEX bookings_status_idx ON bookings (status);
CREATE UNIQUE INDEX bookings_session_key ON bookings (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE UNIQUE INDEX bookings_payment_intent_key ON bookings (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- Stripe webhook idempotency: each event id is processed at most once.
CREATE TABLE stripe_events (
  id           text PRIMARY KEY,
  type         text        NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);
