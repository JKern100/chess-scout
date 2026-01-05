-- Migration: Add AI narrative columns to opponent_profiles table
-- Run this in Supabase SQL Editor to enable AI-generated profile narratives

-- Add quick summary narrative (short version)
ALTER TABLE opponent_profiles ADD COLUMN IF NOT EXISTS ai_quick_summary TEXT;

-- Add comprehensive report narrative (full version)
ALTER TABLE opponent_profiles ADD COLUMN IF NOT EXISTS ai_comprehensive_report TEXT;

-- Add narrative generation timestamp
ALTER TABLE opponent_profiles ADD COLUMN IF NOT EXISTS ai_narrative_generated_at TIMESTAMPTZ;

-- Add subject type (self or opponent) to track narrative perspective
ALTER TABLE opponent_profiles ADD COLUMN IF NOT EXISTS ai_subject_type TEXT CHECK (ai_subject_type IN ('self', 'opponent'));

-- Add model used for generation (for debugging/versioning)
ALTER TABLE opponent_profiles ADD COLUMN IF NOT EXISTS ai_model_used TEXT;

-- Index for faster lookups of profiles with narratives
CREATE INDEX IF NOT EXISTS idx_opponent_profiles_narrative_generated
  ON opponent_profiles (ai_narrative_generated_at) 
  WHERE ai_narrative_generated_at IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN opponent_profiles.ai_quick_summary IS 'AI-generated quick summary paragraph (5-7 sentences)';
COMMENT ON COLUMN opponent_profiles.ai_comprehensive_report IS 'AI-generated comprehensive coach-style report (full markdown)';
COMMENT ON COLUMN opponent_profiles.ai_narrative_generated_at IS 'When the AI narrative was last generated';
COMMENT ON COLUMN opponent_profiles.ai_subject_type IS 'Whether narrative was generated for self-analysis or opponent-analysis';
COMMENT ON COLUMN opponent_profiles.ai_model_used IS 'Gemini model used to generate the narrative';
