-- The one-off "profile update" email to approved mentors (admin → Mentors, "პროფილის განახლების წერილი"; server/profileUpdateEmail.js):
-- when it was sent to this mentor. Set before the email goes out, so nobody gets it twice; cleared again only when the email service
-- refused it (then it can be sent once more).
-- ADDITIVE ONLY: one nullable column. Undo: migrations/down/071_profile_update_email.down.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_update_sent_at timestamptz;
