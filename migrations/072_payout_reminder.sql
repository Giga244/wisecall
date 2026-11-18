-- A bank account (IBAN) is no longer needed to be shown on the site: a mentor adds it when they withdraw. A mentor with money on their
-- balance and no bank account gets one email, "add your bank account to withdraw", at most once a week (server/payoutReminder.js).
-- payout_reminder_sent_at: when that email was last sent to this mentor.
-- ADDITIVE ONLY: one nullable column. Undo: migrations/down/072_payout_reminder.down.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_reminder_sent_at timestamptz;
