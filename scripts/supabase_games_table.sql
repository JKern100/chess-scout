-- games table for storing imported PGNs per user
-- Each user has their own copy of games for their opponents

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('lichess', 'chesscom')),
  username text not null,
  platform_game_id text not null,
  played_at timestamptz null,
  pgn text not null,
  white_acpl integer null,
  black_acpl integer null,
  white_inaccuracies integer null,
  black_inaccuracies integer null,
  white_mistakes integer null,
  black_mistakes integer null,
  white_blunders integer null,
  black_blunders integer null,
  evals_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- IMPORTANT: unique per user+platform+game so each user can import the same game
  unique (profile_id, platform, platform_game_id)
);

-- Index for efficient lookups by user + opponent
create index if not exists games_user_opponent_idx
  on public.games (profile_id, platform, username);

-- Index for date filtering
create index if not exists games_played_at_idx
  on public.games (profile_id, platform, username, played_at desc);

-- Enable RLS
alter table public.games enable row level security;

-- Users can only see/modify their own games
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'games' and policyname = 'games_select_own'
  ) then
    create policy games_select_own on public.games for select using (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'games' and policyname = 'games_insert_own'
  ) then
    create policy games_insert_own on public.games for insert with check (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'games' and policyname = 'games_update_own'
  ) then
    create policy games_update_own on public.games for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'games' and policyname = 'games_delete_own'
  ) then
    create policy games_delete_own on public.games for delete using (auth.uid() = profile_id);
  end if;
end
$$;

-- Comment for documentation
comment on table public.games is 'Imported chess games with PGN data, per user per opponent';
comment on column public.games.username is 'Opponent username (normalized to lowercase)';
comment on column public.games.platform_game_id is 'Lichess/Chess.com game ID';
