-- Add activity tracking columns to profiles table for Admin Dashboard
-- These columns track user engagement metrics

-- Activity tracking columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS opponents_scouted INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reports_generated INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS simulations_run INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_session_minutes INTEGER DEFAULT 0;

-- Create index for admin queries
CREATE INDEX IF NOT EXISTS idx_profiles_last_active ON profiles(last_active DESC);

-- Comment on columns for documentation
COMMENT ON COLUMN profiles.last_active IS 'Timestamp of last user activity';
COMMENT ON COLUMN profiles.opponents_scouted IS 'Count of unique opponents scouted';
COMMENT ON COLUMN profiles.reports_generated IS 'Count of AI reports generated';
COMMENT ON COLUMN profiles.simulations_run IS 'Count of Shadow Boxer simulations run';
COMMENT ON COLUMN profiles.total_session_minutes IS 'Cumulative session time in minutes';
