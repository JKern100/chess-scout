create table if not exists public.opponent_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  username text not null,
  ratings jsonb null,
  fetched_at timestamptz null,
  filters_json jsonb null,
  stats_json jsonb null,
  games_analyzed int null,
  generated_at timestamptz null,
  profile_version int not null default 2,
  profile_json jsonb null,
  date_range_start timestamptz null,
  date_range_end timestamptz null,
  source_game_ids_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opponent_profiles_platform_check check (platform in ('lichess', 'chesscom')),
  unique (profile_id, platform, username)
);

alter table public.opponent_profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponent_profiles' and policyname = 'opponent_profiles_select_own'
  ) then
    create policy opponent_profiles_select_own
      on public.opponent_profiles
      for select
      using (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponent_profiles' and policyname = 'opponent_profiles_insert_own'
  ) then
    create policy opponent_profiles_insert_own
      on public.opponent_profiles
      for insert
      with check (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponent_profiles' and policyname = 'opponent_profiles_update_own'
  ) then
    create policy opponent_profiles_update_own
      on public.opponent_profiles
      for update
      using (auth.uid() = profile_id)
      with check (auth.uid() = profile_id);
  end if;
end
$$;

alter table public.opponent_profiles add column if not exists filters_json jsonb null;
alter table public.opponent_profiles add column if not exists stats_json jsonb null;
alter table public.opponent_profiles add column if not exists games_analyzed int null;
alter table public.opponent_profiles add column if not exists generated_at timestamptz null;
alter table public.opponent_profiles add column if not exists profile_version int not null default 2;
alter table public.opponent_profiles add column if not exists profile_json jsonb null;
alter table public.opponent_profiles add column if not exists date_range_start timestamptz null;
alter table public.opponent_profiles add column if not exists date_range_end timestamptz null;
alter table public.opponent_profiles add column if not exists source_game_ids_hash text null;
