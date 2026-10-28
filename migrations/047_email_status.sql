-- The last email result per person (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 1): "sent" when we hand an email to the provider,
-- then what the provider reports through its webhook (delivered, delayed, bounced, complained), so an admin can see that someone's code
-- never arrived. ADDITIVE ONLY: two nullable columns. Undo: migrations/down/047_email_status.down.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_status text CHECK (email_status IS NULL OR email_status IN ('sent', 'delivered', 'delayed', 'bounced', 'complained'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_status_at timestamptz;
