-- Migration: Add player_color column to synthetic_opponent_games
-- This allows storing the same game twice (once per color) with different style scores

-- Add the column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'synthetic_opponent_games' 
    AND column_name = 'player_color'
  ) THEN
    ALTER TABLE public.synthetic_opponent_games 
    ADD COLUMN player_color text NOT NULL DEFAULT 'w' 
    CHECK (player_color IN ('w', 'b'));
  END IF;
END $$;

-- Drop the old unique constraint and add the new one with player_color
DO $$
BEGIN
  -- Drop old constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'synthetic_opponent_games_synthetic_opponent_id_lichess_game_key'
  ) THEN
    ALTER TABLE public.synthetic_opponent_games 
    DROP CONSTRAINT synthetic_opponent_games_synthetic_opponent_id_lichess_game_key;
  END IF;
  
  -- Add new constraint with player_color
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'synthetic_opponent_games_synthetic_opponent_id_lichess_game_key'
  ) THEN
    ALTER TABLE public.synthetic_opponent_games 
    ADD CONSTRAINT synthetic_opponent_games_synthetic_opponent_id_lichess_game_key 
    UNIQUE (synthetic_opponent_id, lichess_game_id, player_color);
  END IF;
END $$;

-- Add index for querying by player_color
CREATE INDEX IF NOT EXISTS synthetic_opponent_games_color_idx 
  ON public.synthetic_opponent_games (synthetic_opponent_id, player_color);
