import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeFen, type MoveSelectionStrategy } from "@/server/opponentModel";

type Mode = MoveSelectionStrategy;

export async function POST(request: Request) {
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
  const username = String(body?.username ?? "").trim();
  const fen = String(body?.fen ?? "").trim();
  const mode = (String(body?.mode ?? "proportional") as Mode) ?? "proportional";
  const maxDepth = Math.min(Math.max(Number(body?.max_depth ?? 16), 1), 40);
  const prefetch = Boolean(body?.prefetch);

  const speedsRaw = Array.isArray(body?.speeds) ? (body.speeds as any[]) : [];
  const speeds = speedsRaw
    .map((s) => String(s))
    .filter((s) => ["bullet", "blitz", "rapid", "classical", "correspondence"].includes(s)) as Array<
    "bullet" | "blitz" | "rapid" | "classical" | "correspondence"
  >;

  const normalizedSpeeds =
    speeds.length >= 5 ? ([] as typeof speeds) : speeds;

  const ratedRaw = String(body?.rated ?? "any");
  const rated = ratedRaw === "rated" ? "rated" : ratedRaw === "casual" ? "casual" : "any";

  const from = typeof body?.from === "string" ? String(body.from) : null;
  const to = typeof body?.to === "string" ? String(body.to) : null;

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  if (!fen) {
    return NextResponse.json({ error: "fen is required" }, { status: 400 });
  }

  const startFenKey = normalizeFen(fen);

  const cache = { status: "db", max_games: 0, age_ms: 0, build_ms: 0 };

  const canUseOpeningGraph =
    normalizedSpeeds.length === 0 && rated === "any" && !from && !to && platform === "lichess";

  async function fetchMovesFromOpeningGraph(params: {
    fenKey: string;
    side: "opponent" | "against";
  }): Promise<Array<{ uci: string; san: string | null; played_count: number; win: number; loss: number; draw: number }>> {
    const { data, error } = await supabase
      .from("opening_graph_nodes")
      .select("played_by")
      .eq("profile_id", profileId)
      .eq("platform", platform)
      .eq("username", username)
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
  }): Promise<
    Array<{ uci: string; san: string | null; played_count: number; win: number; loss: number; draw: number }>
  > {
    if (canUseOpeningGraph) {
      return await fetchMovesFromOpeningGraph({
        fenKey: params.fenKey,
        side: params.isOpponentMove ? "opponent" : "against",
      });
    }

    const { data, error } = await supabase.rpc("get_opponent_position_moves", {
      in_platform: platform,
      in_username: username,
      in_fen: params.fenKey,
      in_is_opponent_move: params.isOpponentMove,
      in_speeds: normalizedSpeeds.length ? normalizedSpeeds : null,
      in_rated: rated,
      in_from: from ? new Date(from).toISOString() : null,
      in_to: to ? new Date(to).toISOString() : null,
    });

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? (data as any[]) : [];
    return rows.map((m) => ({
      uci: String(m?.uci ?? ""),
      san: m?.san != null ? String(m.san) : null,
      played_count: Number(m?.played_count ?? 0),
      win: Number(m?.win ?? 0),
      loss: Number(m?.loss ?? 0),
      draw: Number(m?.draw ?? 0),
    })).filter((m) => m.uci);
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
      await fetchMoves({ fenKey: startFenKey, isOpponentMove: true });
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

  const [movesOpponent, movesAgainst] = await Promise.all([
    fetchMoves({ fenKey: startFenKey, isOpponentMove: true }),
    fetchMoves({ fenKey: startFenKey, isOpponentMove: false }),
  ]);

  const availableTotalCount = movesOpponent.reduce((s, m) => s + m.played_count, 0);
  const availableAgainstTotalCount = movesAgainst.reduce((s, m) => s + m.played_count, 0);
  const picked = pickMove(movesOpponent);

  return NextResponse.json({
    cache,
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
}
