-- opponents table for per-user saved opponents

create table if not exists public.opponents (
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  username text not null,
  created_at timestamptz not null default now(),
  last_refreshed_at timestamptz null,
  archived_at timestamptz null,
  constraint opponents_platform_check check (platform in ('lichess', 'chesscom')),
  constraint opponents_username_check check (char_length(username) > 0),
  primary key (user_id, platform, username)
);

alter table public.opponents
  add column if not exists archived_at timestamptz null;

alter table public.opponents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponents' and policyname = 'opponents_select_own'
  ) then
    create policy opponents_select_own
      on public.opponents
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponents' and policyname = 'opponents_insert_own'
  ) then
    create policy opponents_insert_own
      on public.opponents
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponents' and policyname = 'opponents_update_own'
  ) then
    create policy opponents_update_own
      on public.opponents
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponents' and policyname = 'opponents_delete_own'
  ) then
    create policy opponents_delete_own
      on public.opponents
      for delete
      using (auth.uid() = user_id);
  end if;
end
$$;
