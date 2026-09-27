-- The Inbox (Phase 3): conversations and notifications. Additive only; the undo script is migrations/down/021_inbox.down.sql.
--   booking thread  one per paid booking, between the asker and the mentor (the question and the answer stay in bookings)
--   support thread  a person and the Wisecall team
--   system thread   one per person: messages from Wisecall
CREATE TABLE threads (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text        NOT NULL CHECK (kind IN ('booking', 'support', 'system')),
  booking_id      uuid        UNIQUE REFERENCES bookings (id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES users (id) ON DELETE CASCADE,          -- support / system: the person the thread is with
  subject         text,
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  assigned_to     uuid        REFERENCES users (id) ON DELETE SET NULL,         -- support: the admin handling it
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'booking') = (booking_id IS NOT NULL)),
  CHECK (kind = 'booking' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX threads_one_system_per_user ON threads (user_id) WHERE kind = 'system';
CREATE INDEX threads_user_idx    ON threads (user_id, last_message_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX threads_support_idx ON threads (status, last_message_at DESC) WHERE kind = 'support';

CREATE TABLE messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid        NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  sender_id   uuid        REFERENCES users (id) ON DELETE SET NULL,             -- null = Wisecall
  sender_role text        NOT NULL CHECK (sender_role IN ('asker', 'mentor', 'user', 'support', 'system')),
  kind        text        NOT NULL DEFAULT 'text'
                          CHECK (kind IN ('text', 'follow_up_question', 'follow_up_reply', 'event', 'internal_note')),
  body        text        NOT NULL DEFAULT '',                                  -- plain text only, never HTML
  event       text,                                                             -- kind = event: paid, answered, refunded, ...
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_thread_idx ON messages (thread_id, created_at);
-- ONE free follow-up question and ONE follow-up reply per booking thread, enforced by the database itself.
CREATE UNIQUE INDEX messages_one_follow_up       ON messages (thread_id) WHERE kind = 'follow_up_question';
CREATE UNIQUE INDEX messages_one_follow_up_reply ON messages (thread_id) WHERE kind = 'follow_up_reply';

-- Messages refused because they carried contact details or an outside-payment request. The text itself is NOT kept.
CREATE TABLE blocked_messages (
  id         bigserial   PRIMARY KEY,
  thread_id  uuid        REFERENCES threads (id) ON DELETE CASCADE,
  sender_id  uuid        REFERENCES users (id) ON DELETE CASCADE,
  reasons    text[]      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blocked_messages_sender_idx ON blocked_messages (sender_id, created_at DESC);

CREATE TABLE thread_reads (
  thread_id    uuid        NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE message_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid        NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  reporter_id uuid        REFERENCES users (id) ON DELETE SET NULL,
  reason      text        NOT NULL CHECK (reason IN ('contact_details', 'abuse', 'spam', 'scam', 'other')),
  details     text,
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution  text,
  resolved_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX message_reports_one_open ON message_reports (message_id, reporter_id) WHERE status = 'open';

-- The notification centre: the same events as the emails.
CREATE TABLE notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text        NOT NULL,
  thread_id  uuid        REFERENCES threads (id) ON DELETE CASCADE,
  booking_id uuid        REFERENCES bookings (id) ON DELETE CASCADE,
  data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx   ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- Settings -> Notifications: the optional email categories a person turned off (transactional emails always go).
CREATE TABLE notification_settings (
  user_id    uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  email_off  text[]      NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
