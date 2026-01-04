-- Add missing columns to existing profiles table
-- Run this if the profiles table exists but is missing columns

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS primary_platform TEXT,
ADD COLUMN IF NOT EXISTS platform_username TEXT,
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Add comments to describe the columns
COMMENT ON COLUMN profiles.primary_platform IS 'Primary chess platform (lichess, chess.com, etc.)';
COMMENT ON COLUMN profiles.platform_username IS 'Username on the primary platform';
COMMENT ON COLUMN profiles.display_name IS 'Custom display name for the user';

-- Update existing RLS policies if needed
-- The existing policies should already allow users to access their own profile data
