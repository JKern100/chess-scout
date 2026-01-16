-- Create RPC function to merge opening_graph_nodes played_by JSON on upsert
-- This fixes the issue where incremental imports would overwrite existing data
-- instead of merging move counts.

-- Helper function to deep merge two played_by JSON objects
-- Structure: { opponent: { uci: { count, win, loss, draw, san, ... } }, against: { ... } }
CREATE OR REPLACE FUNCTION merge_played_by(existing jsonb, incoming jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  result jsonb := coalesce(existing, '{}'::jsonb);
  side text;
  uci text;
  existing_side jsonb;
  incoming_side jsonb;
  existing_move jsonb;
  incoming_move jsonb;
  merged_move jsonb;
BEGIN
  -- Merge each side (opponent, against)
  FOR side IN SELECT * FROM jsonb_object_keys(coalesce(incoming, '{}'::jsonb))
  LOOP
    existing_side := coalesce(result -> side, '{}'::jsonb);
    incoming_side := coalesce(incoming -> side, '{}'::jsonb);
    
    -- Merge each move in this side
    FOR uci IN SELECT * FROM jsonb_object_keys(incoming_side)
    LOOP
      existing_move := existing_side -> uci;
      incoming_move := incoming_side -> uci;
      
      IF existing_move IS NULL THEN
        -- New move, just add it
        existing_side := existing_side || jsonb_build_object(uci, incoming_move);
      ELSE
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
      END IF;
    END LOOP;
    
    result := result || jsonb_build_object(side, existing_side);
  END LOOP;
  
  RETURN result;
END;
$$;

-- RPC function to upsert opening_graph_nodes with merge
CREATE OR REPLACE FUNCTION upsert_opening_graph_nodes_merge(
  nodes jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  node_record record;
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR node_record IN SELECT * FROM jsonb_array_elements(nodes)
  LOOP
    INSERT INTO public.opening_graph_nodes (
      profile_id,
      platform,
      username,
      filter_key,
      fen,
      played_by,
      updated_at
    ) VALUES (
      current_user_id,
      node_record.value ->> 'platform',
      node_record.value ->> 'username',
      node_record.value ->> 'filter_key',
      node_record.value ->> 'fen',
      (node_record.value -> 'played_by')::jsonb,
      now()
    )
    ON CONFLICT (profile_id, platform, username, filter_key, fen)
    DO UPDATE SET
      played_by = merge_played_by(opening_graph_nodes.played_by, excluded.played_by),
      updated_at = now();
  END LOOP;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION merge_played_by(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_opening_graph_nodes_merge(jsonb) TO authenticated;
