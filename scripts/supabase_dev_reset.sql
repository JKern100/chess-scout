begin;

-- Clear aggregated opening graph data
truncate table public.opening_graph_examples restart identity;
truncate table public.opening_graph_nodes restart identity;

-- Clear move-by-move data
truncate table public.opponent_move_events restart identity;

-- Clear calculated profile aggregates
truncate table public.opponent_profiles restart identity;
truncate table public.opponent_style_markers restart identity;

-- Clear game and opponent records
truncate table public.games restart identity;
truncate table public.opponents restart identity;

-- Clear import session history
truncate table public.imports restart identity;

-- Clear saved prep lines
truncate table public.saved_lines restart identity;

-- Clear any user-generated analysis or temporary data
truncate table public.analysis_sessions restart identity;
truncate table public.analysis_moves restart identity;
truncate table public.user_preferences restart identity;

commit;
