-- Create RPC function to merge opening_graph_nodes played_by JSON on upsert
-- This fixes the issue where incremental imports would overwrite existing data
-- instead of merging move counts.

-- Helper function to deep merge two played_by JSON objects
-- Structure: { opponent: { uci: { count, win, loss, draw, san, ... } }, against: { ... } }
create or replace function merge_played_by(existing jsonb, incoming jsonb)
returns jsonb
language plpgsql
as $$
declare
  result jsonb := coalesce(existing, '{}'::jsonb);
  side text;
  uci text;
  existing_side jsonb;
  incoming_side jsonb;
  existing_move jsonb;
  incoming_move jsonb;
  merged_move jsonb;
begin
  -- Merge each side (opponent, against)
  for side in select * from jsonb_object_keys(coalesce(incoming, '{}'::jsonb))
  loop
    existing_side := coalesce(result -> side, '{}'::jsonb);
    incoming_side := coalesce(incoming -> side, '{}'::jsonb);
    
    -- Merge each move in this side
    for uci in select * from jsonb_object_keys(incoming_side)
    loop
      existing_move := existing_side -> uci;
      incoming_move := incoming_side -> uci;
      
      if existing_move is null then
        -- New move, just add it
        existing_side := existing_side || jsonb_build_object(uci, incoming_move);
      else
        -- Merge counts
        merged_move := jsonb_build_object(
          'count', coalesce((existing_move ->> 'count')::int, 0) + coalesce((incoming_move ->> 'count')::int, 0),
          'win', coalesce((existing_move ->> 'win')::int, 0) + coalesce((incoming_move ->> 'win')::int, 0),
          'loss', coalesce((existing_move ->> 'loss')::int, 0) + coalesce((incoming_move ->> 'loss')::int, 0),
          'draw', coalesce((existing_move ->> 'draw')::int, 0) + coalesce((incoming_move ->> 'draw')::int, 0),
          'san', coalesce(incoming_move ->> 'san', existing_move ->> 'san'),
          'last_played_at', greatest(
            coalesce(existing_move ->> 'last_played_at', ''),
            coalesce(incoming_move ->> 'last_played_at', '')
          ),
          'opp_elo_sum', coalesce((existing_move ->> 'opp_elo_sum')::int, 0) + coalesce((incoming_move ->> 'opp_elo_sum')::int, 0),
          'opp_elo_count', coalesce((existing_move ->> 'opp_elo_count')::int, 0) + coalesce((incoming_move ->> 'opp_elo_count')::int, 0)
        );
        existing_side := existing_side || jsonb_build_object(uci, merged_move);
      end if;
    end loop;
    
    result := result || jsonb_build_object(side, existing_side);
  end loop;
  
  return result;
end;
$$;

-- RPC function to upsert opening_graph_nodes with merge
create or replace function upsert_opening_graph_nodes_merge(
  nodes jsonb
)
returns void
language plpgsql
security definer
as $$
declare
  node_record record;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  for node_record in select * from jsonb_array_elements(nodes)
  loop
    insert into public.opening_graph_nodes (
      profile_id,
      platform,
      username,
      filter_key,
      fen,
      played_by,
      updated_at
    ) values (
      current_user_id,
      node_record.value ->> 'platform',
      node_record.value ->> 'username',
      node_record.value ->> 'filter_key',
      node_record.value ->> 'fen',
      (node_record.value -> 'played_by')::jsonb,
      now()
    )
    on conflict (profile_id, platform, username, filter_key, fen)
    do update set
      played_by = merge_played_by(opening_graph_nodes.played_by, excluded.played_by),
      updated_at = now();
  end loop;
end;
$$;

-- Grant execute permission to authenticated users
grant execute on function merge_played_by(jsonb, jsonb) to authenticated;
grant execute on function upsert_opening_graph_nodes_merge(jsonb) to authenticated;
