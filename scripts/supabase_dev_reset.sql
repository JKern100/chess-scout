begin;

-- Clear aggregated opening graph data
truncate table public.opening_graph_examples restart identity;
truncate table public.opening_graph_nodes restart identity;

-- Clear move-by-move data
truncate table public.opponent_move_events restart identity;

-- Clear calculated profile aggregates
truncate table public.opponent_profiles restart identity;

-- Clear game and opponent records
truncate table public.games restart identity;
truncate table public.opponents restart identity;

-- Clear import session history
truncate table public.imports restart identity;

-- Optional: Clear saved prep lines
truncate table public.saved_lines restart identity;

commit;
