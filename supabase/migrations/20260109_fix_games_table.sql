-- Ensure public.games exists and supports per-user upsert conflict target

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
  updated_at timestamptz not null default now()
);

-- Backfill missing columns if the table existed with an older schema
alter table public.games add column if not exists profile_id uuid;
alter table public.games add column if not exists platform text;
alter table public.games add column if not exists username text;
alter table public.games add column if not exists platform_game_id text;
alter table public.games add column if not exists played_at timestamptz;
alter table public.games add column if not exists pgn text;
alter table public.games add column if not exists white_acpl integer;
alter table public.games add column if not exists black_acpl integer;
alter table public.games add column if not exists white_inaccuracies integer;
alter table public.games add column if not exists black_inaccuracies integer;
alter table public.games add column if not exists white_mistakes integer;
alter table public.games add column if not exists black_mistakes integer;
alter table public.games add column if not exists white_blunders integer;
alter table public.games add column if not exists black_blunders integer;
alter table public.games add column if not exists evals_json jsonb;
alter table public.games add column if not exists created_at timestamptz;
alter table public.games add column if not exists updated_at timestamptz;

-- Ensure per-user uniqueness so PostgREST upsert can use on_conflict=profile_id,platform,platform_game_id
create unique index if not exists games_unique_user_platform_game
  on public.games (profile_id, platform, platform_game_id);

create index if not exists games_user_opponent_idx
  on public.games (profile_id, platform, username);

create index if not exists games_played_at_idx
  on public.games (profile_id, platform, username, played_at desc);

alter table public.games enable row level security;

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
