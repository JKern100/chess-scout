-- openingtree-style aggregated opening graph (compact index)

create table if not exists public.opening_graph_nodes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  username text not null,
  fen text not null,
  played_by jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opening_graph_nodes_platform_check check (platform in ('lichess', 'chesscom')),
  unique (profile_id, platform, username, fen)
);

create index if not exists opening_graph_nodes_lookup_idx
  on public.opening_graph_nodes (profile_id, platform, username, fen);

alter table public.opening_graph_nodes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opening_graph_nodes' and policyname = 'opening_graph_nodes_select_own'
  ) then
    create policy opening_graph_nodes_select_own
      on public.opening_graph_nodes
      for select
      using (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opening_graph_nodes' and policyname = 'opening_graph_nodes_insert_own'
  ) then
    create policy opening_graph_nodes_insert_own
      on public.opening_graph_nodes
      for insert
      with check (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opening_graph_nodes' and policyname = 'opening_graph_nodes_update_own'
  ) then
    create policy opening_graph_nodes_update_own
      on public.opening_graph_nodes
      for update
      using (auth.uid() = profile_id)
      with check (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opening_graph_nodes' and policyname = 'opening_graph_nodes_delete_own'
  ) then
    create policy opening_graph_nodes_delete_own
      on public.opening_graph_nodes
      for delete
      using (auth.uid() = profile_id);
  end if;
end
$$;

create table if not exists public.opening_graph_examples (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  username text not null,
  fen text not null,
  uci text not null,
  platform_game_id text not null,
  played_at timestamptz null,
  result text null,
  url text null,
  created_at timestamptz not null default now(),
  constraint opening_graph_examples_platform_check check (platform in ('lichess', 'chesscom')),
  unique (profile_id, platform, username, fen, uci, platform_game_id)
);

create index if not exists opening_graph_examples_lookup_idx
  on public.opening_graph_examples (profile_id, platform, username, fen, uci);

alter table public.opening_graph_examples enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opening_graph_examples' and policyname = 'opening_graph_examples_select_own'
  ) then
    create policy opening_graph_examples_select_own
      on public.opening_graph_examples
      for select
      using (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opening_graph_examples' and policyname = 'opening_graph_examples_insert_own'
  ) then
    create policy opening_graph_examples_insert_own
      on public.opening_graph_examples
      for insert
      with check (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opening_graph_examples' and policyname = 'opening_graph_examples_delete_own'
  ) then
    create policy opening_graph_examples_delete_own
      on public.opening_graph_examples
      for delete
      using (auth.uid() = profile_id);
  end if;
end
$$;
