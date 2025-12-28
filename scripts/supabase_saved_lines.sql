-- saved_lines table for per-user saved analysis lines/variations

create table if not exists public.saved_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid null,
  opponent_platform text null,
  opponent_username text null,
  mode text not null,
  platform text null,
  starting_fen text not null,
  moves_san text[] not null default '{}',
  final_fen text not null,
  name text not null,
  notes text null,
  saved_at timestamptz not null default now(),
  constraint saved_lines_mode_check check (mode in ('simulation', 'analysis')),
  constraint saved_lines_platform_check check (platform is null or platform in ('lichess', 'chesscom')),
  constraint saved_lines_name_check check (char_length(name) > 0)
);

alter table public.saved_lines add column if not exists opponent_platform text null;
alter table public.saved_lines add column if not exists opponent_username text null;

create index if not exists saved_lines_user_saved_at_idx on public.saved_lines(user_id, saved_at desc);
create index if not exists saved_lines_user_opponent_idx on public.saved_lines(user_id, opponent_id);
create index if not exists saved_lines_user_opp_platform_username_idx on public.saved_lines(user_id, opponent_platform, opponent_username);

alter table public.saved_lines enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_lines' and policyname = 'saved_lines_select_own'
  ) then
    create policy saved_lines_select_own
      on public.saved_lines
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_lines' and policyname = 'saved_lines_insert_own'
  ) then
    create policy saved_lines_insert_own
      on public.saved_lines
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_lines' and policyname = 'saved_lines_update_own'
  ) then
    create policy saved_lines_update_own
      on public.saved_lines
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_lines' and policyname = 'saved_lines_delete_own'
  ) then
    create policy saved_lines_delete_own
      on public.saved_lines
      for delete
      using (auth.uid() = user_id);
  end if;
end
$$;
