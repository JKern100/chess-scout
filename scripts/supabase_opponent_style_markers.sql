create table if not exists public.opponent_style_markers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  username text not null,
  source_type text not null,
  marker_key text not null,
  label text not null,
  strength text not null,
  tooltip text not null,
  metrics_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opponent_style_markers_platform_check check (platform in ('lichess', 'chesscom')),
  constraint opponent_style_markers_source_type_check check (source_type in ('PROFILE', 'SESSION'))
);

create unique index if not exists opponent_style_markers_uniq
  on public.opponent_style_markers (profile_id, platform, username, source_type, marker_key);

alter table public.opponent_style_markers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponent_style_markers' and policyname = 'opponent_style_markers_select_own'
  ) then
    create policy opponent_style_markers_select_own
      on public.opponent_style_markers
      for select
      using (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponent_style_markers' and policyname = 'opponent_style_markers_write_own'
  ) then
    create policy opponent_style_markers_write_own
      on public.opponent_style_markers
      for all
      using (auth.uid() = profile_id)
      with check (auth.uid() = profile_id);
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'scout_benchmarks'
      and column_name = 'pawn_push_m15_avg'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'scout_benchmarks'
      and column_name = 'aggression_m15_avg'
  ) then
    alter table public.scout_benchmarks
      rename column pawn_push_m15_avg to aggression_m15_avg;
  end if;
end $$;

alter table public.scout_benchmarks
  add column if not exists aggression_m15_avg numeric(4,2);

update public.scout_benchmarks
set aggression_m15_avg = case
  when category = 'Open' then 4.50
  when category = 'Semi-Open' then 4.20
  when category = 'Indian' then 3.50
  when category = 'Closed' then 3.20
  when category = 'Flank' then 2.80
  else aggression_m15_avg
end
where aggression_m15_avg is null;
