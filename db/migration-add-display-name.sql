-- Add display_name column to users table
-- This allows users to customize how their name appears in the header

ALTER TABLE users ADD COLUMN display_name TEXT;

-- Set default display_name to username extracted from email for existing users
UPDATE users SET display_name = SUBSTR(email, 1, INSTR(email, '@') - 1) WHERE email IS NOT NULL AND display_name IS NULL;
