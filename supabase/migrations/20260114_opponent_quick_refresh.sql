-- Add columns for lightweight quick refresh summaries
-- These are separate from full import/refresh timestamps

-- last_quick_refreshed_at: timestamp of last headers-only refresh on app open
alter table public.opponents
  add column if not exists last_quick_refreshed_at timestamptz null;

-- last_known_ratings: jsonb snapshot of ratings at last quick refresh
-- Example: {"bullet": {"rating": 1850, "games": 500}, "blitz": {"rating": 1920, "games": 1200}, ...}
alter table public.opponents
  add column if not exists last_known_ratings jsonb null;

-- last_known_ratings_at: when the ratings snapshot was taken
alter table public.opponents
  add column if not exists last_known_ratings_at timestamptz null;

-- Index for efficient queries on quick refresh timestamp
create index if not exists opponents_last_quick_refreshed_at_idx
  on public.opponents (user_id, last_quick_refreshed_at)
  where archived_at is null;
