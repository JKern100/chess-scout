-- Ensure public.imports exists and has all columns expected by the import APIs

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null,
  platform text not null,
  username text not null,
  status text not null default 'running',
  imported_count int not null default 0,
  last_game_at timestamptz null,
  cursor_until timestamptz null,
  newest_game_at timestamptz null,
  ready boolean not null default false,
  stage text not null default 'indexing',
  archived_count int not null default 0,
  last_success_at timestamptz null,
  expires_at timestamptz null,
  last_error text null,
  scout_base_since timestamptz null,
  scout_base_count int null,
  scout_base_fallback boolean not null default false,
  scout_base_fallback_limit int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill missing columns if the table existed with an older schema
alter table public.imports add column if not exists profile_id uuid;
alter table public.imports add column if not exists target_type text;
alter table public.imports add column if not exists platform text;
alter table public.imports add column if not exists username text;
alter table public.imports add column if not exists status text;
alter table public.imports add column if not exists imported_count int;
alter table public.imports add column if not exists last_game_at timestamptz;
alter table public.imports add column if not exists cursor_until timestamptz;
alter table public.imports add column if not exists newest_game_at timestamptz;
alter table public.imports add column if not exists ready boolean;
alter table public.imports add column if not exists stage text;
alter table public.imports add column if not exists archived_count int;
alter table public.imports add column if not exists last_success_at timestamptz;
alter table public.imports add column if not exists expires_at timestamptz;
alter table public.imports add column if not exists last_error text;
alter table public.imports add column if not exists scout_base_since timestamptz;
alter table public.imports add column if not exists scout_base_count int;
alter table public.imports add column if not exists scout_base_fallback boolean;
alter table public.imports add column if not exists scout_base_fallback_limit int;
alter table public.imports add column if not exists created_at timestamptz;
alter table public.imports add column if not exists updated_at timestamptz;

-- Defaults (safe; will no-op if already set)
alter table public.imports alter column ready set default false;
alter table public.imports alter column stage set default 'indexing';
alter table public.imports alter column archived_count set default 0;
alter table public.imports alter column scout_base_fallback set default false;
alter table public.imports alter column scout_base_fallback_limit set default 100;

-- Ensure upsert conflict target exists
create unique index if not exists imports_unique_profile_target_platform_username
  on public.imports (profile_id, target_type, platform, username);

create index if not exists imports_profile_updated_at_idx
  on public.imports (profile_id, updated_at desc);

alter table public.imports enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'imports' and policyname = 'imports_select_own'
  ) then
    create policy imports_select_own on public.imports for select using (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'imports' and policyname = 'imports_insert_own'
  ) then
    create policy imports_insert_own on public.imports for insert with check (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'imports' and policyname = 'imports_update_own'
  ) then
    create policy imports_update_own on public.imports for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'imports' and policyname = 'imports_delete_own'
  ) then
    create policy imports_delete_own on public.imports for delete using (auth.uid() = profile_id);
  end if;
end
$$;
