-- opening_graph preset filter support (Option A)
-- Adds filter_key so we can store multiple aggregate graphs per opponent.

begin;

-- Nodes: add filter_key and widen uniqueness.
alter table public.opening_graph_nodes add column if not exists filter_key text not null default 'all';

alter table public.opening_graph_nodes drop constraint if exists opening_graph_nodes_profile_id_platform_username_fen_key;
alter table public.opening_graph_nodes add constraint opening_graph_nodes_unique_key unique (profile_id, platform, username, filter_key, fen);

drop index if exists public.opening_graph_nodes_lookup_idx;
create index if not exists opening_graph_nodes_lookup_idx
  on public.opening_graph_nodes (profile_id, platform, username, filter_key, fen);

-- Examples: add filter_key and widen uniqueness.
alter table public.opening_graph_examples add column if not exists filter_key text not null default 'all';

alter table public.opening_graph_examples drop constraint if exists opening_graph_examples_profile_id_platform_username_fen_uci_platform_game_id_key;
alter table public.opening_graph_examples add constraint opening_graph_examples_unique_key unique (profile_id, platform, username, filter_key, fen, uci, platform_game_id);

drop index if exists public.opening_graph_examples_lookup_idx;
create index if not exists opening_graph_examples_lookup_idx
  on public.opening_graph_examples (profile_id, platform, username, filter_key, fen, uci);

commit;
