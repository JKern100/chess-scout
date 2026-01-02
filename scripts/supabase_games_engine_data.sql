-- Migration: Add engine analysis columns to games table
-- Run this in Supabase SQL Editor to enable engine-based metrics

-- Add columns for Lichess computer analysis data
ALTER TABLE games ADD COLUMN IF NOT EXISTS white_acpl integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS black_acpl integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS white_inaccuracies integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS black_inaccuracies integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS white_mistakes integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS black_mistakes integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS white_blunders integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS black_blunders integer;

-- Per-move evals stored as JSONB array (compact storage)
-- Format: [{"e": 15}, {"e": -20}, {"e": 50, "m": 3}] where e=eval in centipawns, m=mate in N
ALTER TABLE games ADD COLUMN IF NOT EXISTS evals_json jsonb;

-- Index for filtering games with analysis
CREATE INDEX IF NOT EXISTS idx_games_has_analysis ON games ((white_acpl IS NOT NULL));

-- Comment for documentation
COMMENT ON COLUMN games.white_acpl IS 'Average centipawn loss for White (from Lichess analysis)';
COMMENT ON COLUMN games.black_acpl IS 'Average centipawn loss for Black (from Lichess analysis)';
COMMENT ON COLUMN games.evals_json IS 'Per-move evaluations as JSONB array [{e: cp, m: mate}, ...]';
