-- Migration: Add onboarding tracking columns to profiles table
-- These columns track user onboarding state and profile generation

-- Add onboarding and profile generation columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_games_imported_count INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_profile_generated_at TIMESTAMPTZ;

-- Mark existing users with a platform_username as already onboarded
-- (they completed setup before onboarding tracking existed)
UPDATE profiles 
SET onboarding_completed = TRUE 
WHERE platform_username IS NOT NULL 
  AND platform_username != '';

-- Comment on columns for documentation
COMMENT ON COLUMN profiles.onboarding_completed IS 'Whether user has completed the onboarding flow';
COMMENT ON COLUMN profiles.user_games_imported_count IS 'Number of games imported during onboarding';
COMMENT ON COLUMN profiles.user_profile_generated_at IS 'Timestamp when user profile was generated';
