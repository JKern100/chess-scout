-- Migration: Create profiles table for user identity settings
-- Run this in Supabase SQL Editor to enable the Account & Identity System

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  primary_platform text CHECK (primary_platform IN ('lichess', 'chesscom')) DEFAULT 'lichess',
  platform_username text,
  display_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only view their own profile
CREATE POLICY "Users can view own profile"
  ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- RLS Policy: Users can insert their own profile
CREATE POLICY "Users can insert own profile"
  ON profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- RLS Policy: Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Index for faster lookups by platform username
CREATE INDEX IF NOT EXISTS idx_profiles_platform_username 
  ON profiles (primary_platform, platform_username);

-- Comment for documentation
COMMENT ON TABLE profiles IS 'User identity settings for Self-Scout reports';
COMMENT ON COLUMN profiles.primary_platform IS 'Primary chess platform (lichess or chesscom)';
COMMENT ON COLUMN profiles.platform_username IS 'Username on the primary platform';
COMMENT ON COLUMN profiles.display_name IS 'Display name within Chess Scout';
