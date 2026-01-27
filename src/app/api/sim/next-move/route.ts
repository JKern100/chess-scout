import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeFen, type MoveSelectionStrategy } from "@/server/opponentModel";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { Chess } from "chess.js";

type Mode = MoveSelectionStrategy;

export async function POST(request: Request) {
  try {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profileId = user.id;

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const platform = String(body?.platform ?? "lichess");
  const username = String(body?.username ?? "").trim().toLowerCase();
  const fen = String(body?.fen ?? "").trim();
  const mode = (String(body?.mode ?? "proportional") as Mode) ?? "proportional";
  const maxDepth = Math.min(Math.max(Number(body?.max_depth ?? 16), 1), 40);
  const prefetch = Boolean(body?.prefetch);
  const forceRpc = Boolean(body?.force_rpc);
  const syntheticOpponentId = typeof body?.synthetic_opponent_id === "string" ? body.synthetic_opponent_id : null;

  const speedsProvided = Array.isArray(body?.speeds) || typeof body?.speeds === "string";
  const speedsRaw = Array.isArray(body?.speeds)
    ? (body.speeds as any[])
    : typeof body?.speeds === "string"
      ? [body.speeds]
      : [];
  const speeds = speedsRaw
    .map((s) => String(s))
    .filter((s) => ["bullet", "blitz", "rapid", "classical", "correspondence"].includes(s)) as Array<
    "bullet" | "blitz" | "rapid" | "classical" | "correspondence"
  >;

  // Important semantics:
  // - speeds not provided => treat as "any" (no speed filter)
  // - speeds provided but empty => treat as "none" (match nothing)
  // - all 5 speeds selected => treat as "any"
  const speedsFilter: (typeof speeds) | null = !speedsProvided ? null : speeds.length >= 5 ? null : speeds;

  const ratedRaw = String(body?.rated ?? "any");
  const rated = ratedRaw === "rated" ? "rated" : ratedRaw === "casual" ? "casual" : "any";

  const fromRaw = typeof body?.from === "string" ? String(body.from).trim() : null;
  const toRaw = typeof body?.to === "string" ? String(body.to).trim() : null;

  // Convert date-only strings to proper ISO timestamps.
  // `from` should be start of day, `to` should be end of day to include all games on boundary dates.
  const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = fromRaw && fromRaw.trim() ? (isDateOnly(fromRaw) ? `${fromRaw}T00:00:00.000Z` : new Date(fromRaw).toISOString()) : null;
  const to = toRaw && toRaw.trim() ? (isDateOnly(toRaw) ? `${toRaw}T23:59:59.999Z` : new Date(toRaw).toISOString()) : null;

  const shouldAllowGraphFallback =
    !from &&
    !to &&
    !(Array.isArray(speedsFilter) && speedsFilter.length > 1) &&
    !(speedsProvided && speeds.length === 0);

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  if (!fen) {
    return NextResponse.json({ error: "fen is required" }, { status: 400 });
  }

  try {
    const chess = new Chess(fen);
    if (chess.isGameOver()) {
      const outcome = chess.isCheckmate()
        ? "Checkmate"
        : chess.isStalemate()
          ? "Stalemate"
          : chess.isThreefoldRepetition()
            ? "Threefold repetition"
            : chess.isInsufficientMaterial()
              ? "Insufficient material"
              : chess.isDraw()
                ? "Draw"
                : "Game over";

      const positionKey = normalizeFen(fen);
      return NextResponse.json({
        cache: { status: "db", max_games: 0, age_ms: 0, build_ms: 0 },
        filter_meta: {
          requested: { speeds: speedsFilter, rated, from, to },
          source: "terminal",
          opening_graph_key_used: null,
          approximate: false,
          date_filter_ignored: false,
          client_tree_enabled: false,
          showing_all_time: false,
          date_refine_available: false,
        },
        terminal: { is_game_over: true, outcome },
        position: positionKey,
        mode,
        available_count: 0,
        available_total_count: 0,
        available_against_count: 0,
        available_against_total_count: 0,
        depth_remaining: 0,
        move: null,
        moves: [],
        moves_against: [],
      });
    }
  } catch {
    // ignore invalid fen; downstream will handle
  }

  const startFenKey = normalizeFen(fen);

  const cache = { status: "db", max_games: 0, age_ms: 0, build_ms: 0 };

  // Handle synthetic opponents - compute move stats from synthetic_opponent_games
  if (syntheticOpponentId) {
    // Verify the synthetic opponent belongs to this user
    const { data: syntheticOpponent, error: syntheticError } = await supabase
      .from("synthetic_opponents")
      .select("id, name, opening_fen")
      .eq("id", syntheticOpponentId)
      .eq("profile_id", profileId)
      .single();

    if (syntheticError || !syntheticOpponent) {
      return NextResponse.json({ error: "Synthetic opponent not found" }, { status: 404 });
    }

    // Parse the FEN to determine whose turn it is
    const fenParts = fen.split(" ");
    const turnToMove = fenParts[1] === "b" ? "b" : "w";

    // Fetch games for this synthetic opponent filtered by player color
    // Only get games where the analyzed color matches whose turn it is
    const { data: games, error: gamesError } = await supabase
      .from("synthetic_opponent_games")
      .select("moves_san, result, style_score, player_color")
      .eq("synthetic_opponent_id", syntheticOpponentId)
      .eq("player_color", turnToMove)
      .order("style_score", { ascending: false });

    if (gamesError) {
      return NextResponse.json({ error: gamesError.message }, { status: 500 });
    }

    // Compute move stats from games at the requested position
    const moveCounts = new Map<string, { san: string; count: number; win: number; loss: number; draw: number }>();
    const moveCountsAgainst = new Map<string, { san: string; count: number; win: number; loss: number; draw: number }>();
    
    // For each game, replay moves and find games that reach this position
    for (const game of (games || [])) {
      const movesSan = game.moves_san as string[];
      if (!Array.isArray(movesSan) || movesSan.length === 0) continue;

      try {
        const gameChess = new Chess();
        let matchedPosition = false;
        let plyAtMatch = -1;

        // Replay the game to find if it passes through this position
        for (let i = 0; i < movesSan.length; i++) {
          const currentFenKey = normalizeFen(gameChess.fen());
          
          if (currentFenKey === startFenKey) {
            matchedPosition = true;
            plyAtMatch = i;
            
            // The next move in the game is what was played from this position
            const nextMoveSan = movesSan[i];
            if (nextMoveSan) {
              const move = gameChess.move(nextMoveSan);
              if (move) {
                const uci = move.from + move.to + (move.promotion || "");
                const currentTurn = i % 2 === 0 ? "w" : "b"; // ply 0 = white's move
                
                // Determine if this is opponent's move or player's move
                // For synthetic opponents, we treat all games as "opponent" data
                const bucket = moveCounts;
                const existing = bucket.get(uci);
                const isWhiteWin = game.result === "1-0";
                const isBlackWin = game.result === "0-1";
                const isDraw = game.result === "1/2-1/2";
                
                if (existing) {
                  existing.count += 1;
                  if (isWhiteWin) existing.win += 1;
                  else if (isBlackWin) existing.loss += 1;
                  else if (isDraw) existing.draw += 1;
                } else {
                  bucket.set(uci, {
                    san: nextMoveSan,
                    count: 1,
                    win: isWhiteWin ? 1 : 0,
                    loss: isBlackWin ? 1 : 0,
                    draw: isDraw ? 1 : 0,
                  });
                }
              }
            }
            break; // Only count each game once per position
          }
          
          // Try to play the next move
          const played = gameChess.move(movesSan[i]!);
          if (!played) break; // Invalid move, stop replaying
        }
      } catch {
        // Skip games with invalid moves
        continue;
      }
    }

    // Convert to array and sort by count
    const movesOpponent = Array.from(moveCounts.entries())
      .map(([uci, stats]) => ({
        uci,
        san: stats.san,
        played_count: stats.count,
        win: stats.win,
        loss: stats.loss,
        draw: stats.draw,
      }))
      .sort((a, b) => b.played_count - a.played_count);

    const movesAgainst = Array.from(moveCountsAgainst.entries())
      .map(([uci, stats]) => ({
        uci,
        san: stats.san,
        played_count: stats.count,
        win: stats.win,
        loss: stats.loss,
        draw: stats.draw,
      }))
      .sort((a, b) => b.played_count - a.played_count);

    const availableTotalCount = movesOpponent.reduce((s, m) => s + m.played_count, 0);
    const availableAgainstTotalCount = movesAgainst.reduce((s, m) => s + m.played_count, 0);

    // Pick a move using the selected strategy
    function pickMove(moves: typeof movesOpponent) {
      if (moves.length === 0) return null;
      if (mode === "random") {
        return moves[Math.floor(Math.random() * moves.length)] ?? null;
      }
      const total = moves.reduce((s, m) => s + m.played_count, 0);
      if (total <= 0) return moves[0] ?? null;
      let r = Math.random() * total;
      for (const m of moves) {
        r -= m.played_count;
        if (r <= 0) return m;
      }
      return moves[moves.length - 1] ?? null;
    }

    const picked = pickMove(movesOpponent);

    return NextResponse.json({
      cache: { status: "synthetic", max_games: games?.length ?? 0, age_ms: 0, build_ms: 0 },
      filter_meta: {
        requested: { speeds: null, rated: "any", from: null, to: null },
        source: "synthetic_opponent",
        opening_graph_key_used: null,
        approximate: false,
        date_filter_ignored: false,
        client_tree_enabled: false,
        showing_all_time: true,
        date_refine_available: false,
        synthetic_opponent_id: syntheticOpponentId,
        synthetic_opponent_name: syntheticOpponent.name,
      },
      position: startFenKey,
      mode,
      available_count: movesOpponent.length,
      available_total_count: availableTotalCount,
      available_against_count: movesAgainst.length,
      available_against_total_count: availableAgainstTotalCount,
      depth_remaining: 0,
      move: picked,
      moves: movesOpponent.slice(0, 30),
      moves_against: movesAgainst.slice(0, 30),
    });
  }

  // Phase 1a: When analysis_v2_client_tree is enabled, always use opening_graph_nodes
  const useClientTree = isFeatureEnabled('analysis_v2_client_tree');
  const canUseOpeningGraphPresets = !forceRpc && !from && !to && platform === "lichess";

  const openingGraphKeyExact = (() => {
    if (!canUseOpeningGraphPresets) return null;
    if (rated === "rated" || rated === "casual") return rated;
    if (Array.isArray(speedsFilter) && speedsFilter.length === 1) return `speed:${speedsFilter[0]}`;
    // Only use the 'all' graph when there is no explicit speed filter.
    if (speedsFilter === null) return "all";
    return null;
  })();

  const openingGraphKeyFallback = (() => {
    // If any date range is set, we can't represent it with preset graphs.
    // We'll still use a reasonable fallback ('all') if the RPC yields nothing.
    if (platform !== "lichess") return null;
    if (rated === "rated" || rated === "casual") return rated;
    if (Array.isArray(speedsFilter) && speedsFilter.length === 1) return `speed:${speedsFilter[0]}`;
    return "all";
  })();

  const filterMetaBase = {
    requested: {
      speeds: speedsFilter,
      rated,
      from,
      to,
    },
  };

  async function fetchMovesFromOpeningGraph(params: {
    fenKey: string;
    side: "opponent" | "against";
    filterKey: string;
  }): Promise<Array<{ uci: string; san: string | null; played_count: number; win: number; loss: number; draw: number }>> {
    if (!params.filterKey) return [];
    const { data, error } = await supabase
      .from("opening_graph_nodes")
      .select("played_by")
      .eq("profile_id", profileId)
      .eq("platform", platform)
      .eq("username", username)
      .eq("filter_key", params.filterKey)
      .eq("fen", params.fenKey)
      .maybeSingle();

    if (error) throw error;

    const playedBy = (data as any)?.played_by as any;
    const bucket = params.side === "opponent" ? playedBy?.opponent : playedBy?.against;
    const entries = bucket && typeof bucket === "object" ? Object.entries(bucket) : [];

    return entries
      .map(([uci, agg]: any) => ({
        uci: String(uci ?? ""),
        san: agg?.san != null ? String(agg.san) : null,
        played_count: Number(agg?.count ?? 0),
        win: Number(agg?.win ?? 0),
        loss: Number(agg?.loss ?? 0),
        draw: Number(agg?.draw ?? 0),
      }))
      .filter((m) => m.uci && m.played_count > 0)
      .sort((a, b) => b.played_count - a.played_count);
  }

  async function fetchMoves(params: {
    fenKey: string;
    isOpponentMove: boolean;
    fallbackKey: string | null;
  }): Promise<
    Array<{ uci: string; san: string | null; played_count: number; win: number; loss: number; draw: number }>
  > {
    // Phase 1a: When useClientTree is enabled, only use opening_graph_nodes (no RPC)
    if (useClientTree) {
      // Try exact filter key first
      if (openingGraphKeyExact) {
        const fromGraph = await fetchMovesFromOpeningGraph({
          fenKey: params.fenKey,
          side: params.isOpponentMove ? "opponent" : "against",
          filterKey: openingGraphKeyExact,
        });
        if (fromGraph.length > 0) return fromGraph;
      }
      
      // Fall back to best available graph (handles date filters gracefully)
      if (params.fallbackKey) {
        const fromFallback = await fetchMovesFromOpeningGraph({
          fenKey: params.fenKey,
          side: params.isOpponentMove ? "opponent" : "against",
          filterKey: params.fallbackKey,
        });
        if (fromFallback.length > 0) return fromFallback;
        
        // Last-resort: try 'all' if specific filter returned nothing
        if (params.fallbackKey !== "all") {
          return await fetchMovesFromOpeningGraph({
            fenKey: params.fenKey,
            side: params.isOpponentMove ? "opponent" : "against",
            filterKey: "all",
          });
        }
      }
      
      return [];
    }
    
    // Legacy path: use RPC when feature flag is disabled
    if (openingGraphKeyExact) {
      const fromGraph = await fetchMovesFromOpeningGraph({
        fenKey: params.fenKey,
        side: params.isOpponentMove ? "opponent" : "against",
        filterKey: openingGraphKeyExact,
      });
      
      // If the preset graph isn't materialized for this opponent yet, fall back to exact RPC.
      if (fromGraph.length > 0) return fromGraph;
    }

    const { data, error } = await supabase.rpc("get_opponent_position_moves", {
      in_platform: platform,
      in_username: username,
      in_fen: params.fenKey,
      in_is_opponent_move: params.isOpponentMove,
      in_speeds: speedsFilter === null ? null : speedsFilter,
      in_rated: rated,
      in_from: from,
      in_to: to,
    });

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? (data as any[]) : [];
    const out = rows.map((m) => ({
      uci: String(m?.uci ?? ""),
      san: m?.san != null ? String(m.san) : null,
      played_count: Number(m?.played_count ?? 0),
      win: Number(m?.win ?? 0),
      loss: Number(m?.loss ?? 0),
      draw: Number(m?.draw ?? 0),
    })).filter((m) => m.uci);

    if (out.length > 0) return out;

    // If RPC returned empty but we have date filters, fall back to opening_graph
    // and let the client know the data is approximate (not filtered by date)
    if ((from || to) && params.fallbackKey) {
      const fromFallback = await fetchMovesFromOpeningGraph({
        fenKey: params.fenKey,
        side: params.isOpponentMove ? "opponent" : "against",
        filterKey: params.fallbackKey,
      });
      if (fromFallback.length > 0) return fromFallback;
    }

    if (shouldAllowGraphFallback && params.fallbackKey) {
      const fromFallback = await fetchMovesFromOpeningGraph({
        fenKey: params.fenKey,
        side: params.isOpponentMove ? "opponent" : "against",
        filterKey: params.fallbackKey,
      });

      if (fromFallback.length > 0) return fromFallback;

      // Last-resort UX fallback: if the user requested a single-speed subset but we don't have
      // the speed-specific graph and there are no events yet, fall back to 'all' instead of
      // showing zero moves.
      if (params.fallbackKey.startsWith("speed:") && params.fallbackKey !== "all") {
        return await fetchMovesFromOpeningGraph({
          fenKey: params.fenKey,
          side: params.isOpponentMove ? "opponent" : "against",
          filterKey: "all",
        });
      }
    }

    return out;
  }

  function pickMove(
    moves: Array<{ uci: string; san: string | null; played_count: number; win: number; loss: number; draw: number }>
  ) {
    if (moves.length === 0) return null;
    if (mode === "random") {
      return moves[Math.floor(Math.random() * moves.length)] ?? null;
    }
    const total = moves.reduce((s, m) => s + m.played_count, 0);
    if (total <= 0) return moves[0] ?? null;
    let r = Math.random() * total;
    for (const m of moves) {
      r -= m.played_count;
      if (r <= 0) return m;
    }
    return moves[moves.length - 1] ?? null;
  }

  if (prefetch) {
    // Warm path: prime PostgREST / DB caches by issuing a cheap query.
    try {
      await fetchMoves({ fenKey: startFenKey, isOpponentMove: true, fallbackKey: openingGraphKeyFallback });
    } catch {
      // ignore
    }
    return NextResponse.json({
      cache,
      position: startFenKey,
      mode,
      available_count: 0,
      available_total_count: 0,
      available_against_count: 0,
      available_against_total_count: 0,
      depth_remaining: 0,
      move: null,
      moves: [],
      moves_against: [],
      prefetched: true,
    });
  }

  const usedFallback = !openingGraphKeyExact && Boolean(openingGraphKeyFallback);
  const hasDateFilter = Boolean(from || to);

  const [movesOpponent, movesAgainst] = await Promise.all([
    fetchMoves({ fenKey: startFenKey, isOpponentMove: true, fallbackKey: openingGraphKeyFallback }),
    fetchMoves({ fenKey: startFenKey, isOpponentMove: false, fallbackKey: openingGraphKeyFallback }),
  ]);

  const availableTotalCount = movesOpponent.reduce((s, m) => s + m.played_count, 0);
  const availableAgainstTotalCount = movesAgainst.reduce((s, m) => s + m.played_count, 0);
  const picked = pickMove(movesOpponent);

  const isApproximate = Boolean(
    !openingGraphKeyExact &&
      usedFallback &&
      (from || to || (Array.isArray(speedsFilter) && speedsFilter.length > 1))
  );
  
  // Phase 1a: When useClientTree is enabled, date filters show "All-time" data with refinement available
  const dateFilterAppliedButIgnored = Boolean(
    hasDateFilter && 
    (movesOpponent.length > 0 || movesAgainst.length > 0) &&
    (useClientTree || usedFallback)
  );
  
  // New metadata for Phase 1a UX: indicates data source and refinement status
  const dataSource = useClientTree 
    ? (openingGraphKeyExact ? "opening_graph_exact" : "opening_graph_fallback")
    : (openingGraphKeyExact ? "opening_graph" : usedFallback ? "opening_graph_fallback" : "rpc");

  return NextResponse.json({
    cache,
    filter_meta: {
      ...filterMetaBase,
      source: dataSource,
      opening_graph_key_used: openingGraphKeyExact ?? (usedFallback ? openingGraphKeyFallback : null),
      approximate: isApproximate,
      date_filter_ignored: dateFilterAppliedButIgnored,
      // Phase 1a: New fields for improved UX
      client_tree_enabled: useClientTree,
      showing_all_time: hasDateFilter && dateFilterAppliedButIgnored,
      date_refine_available: hasDateFilter && dateFilterAppliedButIgnored && isFeatureEnabled('analysis_v2_date_refine'),
    },
    position: startFenKey,
    mode,
    available_count: movesOpponent.length,
    available_total_count: availableTotalCount,
    available_against_count: movesAgainst.length,
    available_against_total_count: availableAgainstTotalCount,
    depth_remaining: 0,
    move: picked
      ? {
          uci: picked.uci,
          san: (picked as any).san ?? null,
          played_count: (picked as any).played_count ?? 0,
          win: (picked as any).win ?? 0,
          loss: (picked as any).loss ?? 0,
          draw: (picked as any).draw ?? 0,
        }
      : null,
    moves: movesOpponent.slice(0, 30),
    moves_against: movesAgainst.slice(0, 30),
  });
  } catch (e) {
    const anyErr = e as any;
    const status = Number(anyErr?.status);
    const msg = e instanceof Error ? e.message : typeof anyErr?.message === "string" ? anyErr.message : "Internal Server Error";
    if (Number.isFinite(status) && status >= 400 && status < 600) {
      return NextResponse.json({ error: msg }, { status });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
