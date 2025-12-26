-- opening-tree style indexing for fast opponent move queries

create table if not exists public.opponent_move_events (
  profile_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  username text not null,
  platform_game_id text not null,
  played_at timestamptz null,
  speed text null,
  rated boolean null,
  fen text not null,
  uci text not null,
  san text null,
  ply int not null,
  is_opponent_move boolean not null,
  win int not null,
  loss int not null,
  draw int not null,
  constraint opponent_move_events_platform_check check (platform in ('lichess', 'chesscom')),
  constraint opponent_move_events_speed_check check (speed is null or speed in ('bullet', 'blitz', 'rapid', 'classical', 'correspondence')),
  primary key (profile_id, platform, platform_game_id, ply)
);

create index if not exists opponent_move_events_lookup_idx
  on public.opponent_move_events (profile_id, platform, username, fen, is_opponent_move);

create index if not exists opponent_move_events_played_at_idx
  on public.opponent_move_events (profile_id, platform, username, played_at);

create index if not exists opponent_move_events_speed_rated_idx
  on public.opponent_move_events (profile_id, platform, username, speed, rated);

alter table public.opponent_move_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponent_move_events' and policyname = 'opponent_move_events_select_own'
  ) then
    create policy opponent_move_events_select_own
      on public.opponent_move_events
      for select
      using (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponent_move_events' and policyname = 'opponent_move_events_insert_own'
  ) then
    create policy opponent_move_events_insert_own
      on public.opponent_move_events
      for insert
      with check (auth.uid() = profile_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'opponent_move_events' and policyname = 'opponent_move_events_delete_own'
  ) then
    create policy opponent_move_events_delete_own
      on public.opponent_move_events
      for delete
      using (auth.uid() = profile_id);
  end if;
end
$$;

create or replace function public.get_opponent_position_moves(
  in_platform text,
  in_username text,
  in_fen text,
  in_is_opponent_move boolean,
  in_speeds text[] default null,
  in_rated text default 'any',
  in_from timestamptz default null,
  in_to timestamptz default null
)
returns table (
  uci text,
  san text,
  played_count bigint,
  win bigint,
  loss bigint,
  draw bigint
)
language sql
stable
as $$
  select
    e.uci,
    max(e.san) as san,
    count(*) as played_count,
    sum(e.win) as win,
    sum(e.loss) as loss,
    sum(e.draw) as draw
  from public.opponent_move_events e
  where e.profile_id = auth.uid()
    and e.platform = in_platform
    and e.username = in_username
    and e.fen = in_fen
    and e.is_opponent_move = in_is_opponent_move
    and (in_from is null or e.played_at >= in_from)
    and (in_to is null or e.played_at <= in_to)
    and (
      in_speeds is null
      or array_length(in_speeds, 1) is null
      or e.speed is null
      or e.speed = any (in_speeds)
    )
    and (
      in_rated = 'any'
      or (in_rated = 'rated' and e.rated is true)
      or (in_rated = 'casual' and e.rated is false)
      or e.rated is null
    )
  group by e.uci
  order by played_count desc;
$$;
