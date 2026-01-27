-- Synthetic Opponents: Style + Opening based opponent profiles
-- These are virtual opponents created from Lichess Explorer data filtered by style

create table if not exists public.synthetic_opponents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  
  -- Display info
  name text not null,
  
  -- Configuration
  style_preset text not null check (style_preset in ('aggressive', 'positional', 'defensive')),
  opening_eco text null,
  opening_name text not null,
  opening_fen text not null,
  opening_moves_san text[] not null default '{}',
  rating_tier text not null check (rating_tier in ('all', '1600', '1800', 'masters')),
  
  -- Sync status
  sync_status text not null default 'pending' check (sync_status in ('pending', 'syncing', 'complete', 'error')),
  sync_error text null,
  sync_started_at timestamptz null,
  sync_completed_at timestamptz null,
  
  -- Stats
  games_fetched int not null default 0,
  games_scored int not null default 0,
  
  -- Computed style markers (cached for quick access)
  style_markers_json jsonb null,
  
  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  
  -- Unique constraint: one profile per user per opening+style+rating combo
  unique (profile_id, opening_fen, style_preset, rating_tier)
);

-- Synthetic opponent games: stores games fetched from Lichess Explorer
create table if not exists public.synthetic_opponent_games (
  id uuid primary key default gen_random_uuid(),
  synthetic_opponent_id uuid not null references public.synthetic_opponents(id) on delete cascade,
  
  -- Game identification
  lichess_game_id text not null,
  
  -- Game data
  pgn text not null,
  white_player text null,
  black_player text null,
  white_elo int null,
  black_elo int null,
  result text null check (result in ('1-0', '0-1', '1/2-1/2', '*')),
  played_at timestamptz null,
  
  -- Moves (parsed from PGN for quick access)
  moves_san text[] not null default '{}',
  
  -- Style scoring
  style_score float null,
  style_metrics_json jsonb null,
  
  -- Which color was analyzed for this entry (same game can have entries for both colors)
  player_color text not null default 'w' check (player_color in ('w', 'b')),
  
  -- Timestamps
  created_at timestamptz not null default now(),
  
  -- Unique per synthetic opponent per color (same game can be stored twice, once per color)
  unique (synthetic_opponent_id, lichess_game_id, player_color)
);

-- Indexes
create index if not exists synthetic_opponents_profile_idx 
  on public.synthetic_opponents (profile_id);
create index if not exists synthetic_opponents_status_idx 
  on public.synthetic_opponents (profile_id, sync_status);
create index if not exists synthetic_opponent_games_opponent_idx 
  on public.synthetic_opponent_games (synthetic_opponent_id);
create index if not exists synthetic_opponent_games_score_idx 
  on public.synthetic_opponent_games (synthetic_opponent_id, style_score desc nulls last);
create index if not exists synthetic_opponent_games_color_idx 
  on public.synthetic_opponent_games (synthetic_opponent_id, player_color);

-- Cache table for popular opening+style+rating combinations
create table if not exists public.synthetic_opponent_cache (
  id uuid primary key default gen_random_uuid(),
  
  -- Cache key components
  opening_fen text not null,
  style_preset text not null,
  rating_tier text not null,
  
  -- Cached data
  games_json jsonb not null,
  games_count int not null default 0,
  
  -- Cache metadata
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  hit_count int not null default 0,
  
  unique (opening_fen, style_preset, rating_tier)
);

create index if not exists synthetic_opponent_cache_lookup_idx 
  on public.synthetic_opponent_cache (opening_fen, style_preset, rating_tier);
create index if not exists synthetic_opponent_cache_expiry_idx 
  on public.synthetic_opponent_cache (expires_at);

-- Enable RLS
alter table public.synthetic_opponents enable row level security;
alter table public.synthetic_opponent_games enable row level security;
alter table public.synthetic_opponent_cache enable row level security;

-- RLS policies for synthetic_opponents
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'synthetic_opponents' and policyname = 'synthetic_opponents_select_own'
  ) then
    create policy synthetic_opponents_select_own
      on public.synthetic_opponents for select
      using (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'synthetic_opponents' and policyname = 'synthetic_opponents_insert_own'
  ) then
    create policy synthetic_opponents_insert_own
      on public.synthetic_opponents for insert
      with check (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'synthetic_opponents' and policyname = 'synthetic_opponents_update_own'
  ) then
    create policy synthetic_opponents_update_own
      on public.synthetic_opponents for update
      using (auth.uid() = profile_id)
      with check (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'synthetic_opponents' and policyname = 'synthetic_opponents_delete_own'
  ) then
    create policy synthetic_opponents_delete_own
      on public.synthetic_opponents for delete
      using (auth.uid() = profile_id);
  end if;
end
$$;

-- RLS policies for synthetic_opponent_games (via join to synthetic_opponents)
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'synthetic_opponent_games' and policyname = 'synthetic_opponent_games_select_own'
  ) then
    create policy synthetic_opponent_games_select_own
      on public.synthetic_opponent_games for select
      using (
        exists (
          select 1 from public.synthetic_opponents so
          where so.id = synthetic_opponent_id and so.profile_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'synthetic_opponent_games' and policyname = 'synthetic_opponent_games_insert_own'
  ) then
    create policy synthetic_opponent_games_insert_own
      on public.synthetic_opponent_games for insert
      with check (
        exists (
          select 1 from public.synthetic_opponents so
          where so.id = synthetic_opponent_id and so.profile_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'synthetic_opponent_games' and policyname = 'synthetic_opponent_games_delete_own'
  ) then
    create policy synthetic_opponent_games_delete_own
      on public.synthetic_opponent_games for delete
      using (
        exists (
          select 1 from public.synthetic_opponents so
          where so.id = synthetic_opponent_id and so.profile_id = auth.uid()
        )
      );
  end if;
end
$$;

-- Cache is readable by all authenticated users (shared cache)
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'synthetic_opponent_cache' and policyname = 'synthetic_opponent_cache_select_all'
  ) then
    create policy synthetic_opponent_cache_select_all
      on public.synthetic_opponent_cache for select
      using (auth.uid() is not null);
  end if;

  -- Insert/update only via service role (server-side)
end
$$;

-- Comments
comment on table public.synthetic_opponents is 'Virtual opponents created from Lichess Explorer data filtered by style preset and opening';
comment on table public.synthetic_opponent_games is 'Games fetched from Lichess Explorer for synthetic opponents';
comment on table public.synthetic_opponent_cache is 'Shared cache for popular opening+style+rating combinations';
