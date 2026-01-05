-- Migration: Add onboarding tracking columns to profiles table
-- Run this in Supabase SQL Editor to enable the User Onboarding flow

-- Add onboarding_completed flag to track if user has completed initial setup
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Add user_profile_generated_at to track when user's own profile was last generated
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_profile_generated_at timestamptz NULL;

-- Add user_games_imported_count to track how many of the user's own games have been imported
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_games_imported_count int NOT NULL DEFAULT 0;

-- Add user_games_last_synced_at to track the last sync timestamp for incremental imports
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_games_last_synced_at timestamptz NULL;

-- Index for faster lookups of users who need onboarding
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_completed 
  ON profiles (onboarding_completed) WHERE onboarding_completed = false;

-- Comments for documentation
COMMENT ON COLUMN profiles.onboarding_completed IS 'Whether user has completed initial onboarding (set platform username and synced games)';
COMMENT ON COLUMN profiles.user_profile_generated_at IS 'When the user''s own self-scout profile was last generated';
COMMENT ON COLUMN profiles.user_games_imported_count IS 'Number of user''s own games that have been imported';
COMMENT ON COLUMN profiles.user_games_last_synced_at IS 'Timestamp of the most recent game synced for incremental imports';
