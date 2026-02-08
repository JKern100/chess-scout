-- Activity events table for granular user activity tracking
-- Used by the admin dashboard to show usage graphs and timelines

create table if not exists public.activity_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  metadata jsonb null,
  created_at timestamptz not null default now()
);

-- Index for admin queries: daily aggregation per user
create index if not exists activity_events_profile_created_idx
  on public.activity_events (profile_id, created_at desc);

-- Index for global daily aggregation
create index if not exists activity_events_created_idx
  on public.activity_events (created_at desc);

-- Index for event type filtering
create index if not exists activity_events_type_created_idx
  on public.activity_events (event_type, created_at desc);

-- Enable RLS
alter table public.activity_events enable row level security;

-- Users can insert their own events
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'activity_events' and policyname = 'activity_events_insert_own'
  ) then
    create policy activity_events_insert_own
      on public.activity_events for insert
      with check (auth.uid() = profile_id);
  end if;
end
$$;

-- Comments
comment on table public.activity_events is 'Granular user activity events for admin analytics';
comment on column public.activity_events.event_type is 'Event type: session_start, page_view, opponent_scouted, report_generated, simulation_run, analysis_opened';
