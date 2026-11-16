-- "Fix: lawyers need only their bar number": a mentor in a regulated field may name a second licence or jurisdiction (a Georgian
-- advocate who is also admitted in New York). The body that issued it; its number is optional (kept encrypted, like the first one, with
-- its last characters for display). It has no end date and no document. An admin sees it next to the first licence.
-- (A licence with no end date needs no column: valid_until has always been nullable, and is empty for it.)
-- ADDITIVE ONLY: three nullable columns. Undo: migrations/down/069_second_licence.down.sql.
ALTER TABLE mentor_credentials ADD COLUMN IF NOT EXISTS second_body text;
ALTER TABLE mentor_credentials ADD COLUMN IF NOT EXISTS second_number_enc text;
ALTER TABLE mentor_credentials ADD COLUMN IF NOT EXISTS second_last4 text;
