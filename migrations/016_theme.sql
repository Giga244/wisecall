-- The colour theme a person chose (System, Light or Dark), kept on the account so it follows them across devices.
-- null = they never chose one: each device uses its own setting (System by default).
ALTER TABLE users ADD COLUMN theme text CHECK (theme IN ('system', 'light', 'dark'));
