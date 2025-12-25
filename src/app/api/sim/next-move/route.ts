import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Mode = "proportional" | "random";

type MoveStats = {
  uci: string;
  san?: string;
  count: number;
  win: number;
  loss: number;
  draw: number;
};

type PositionStats = {
  moves: Map<string, MoveStats>;
};

type AnyMoveStats = {
  uci: string;
  count: number;
};

type AnyPositionStats = {
  moves: Map<string, AnyMoveStats>;
};

type CachedStats = {
  builtAtMs: number;
  maxGames: number;
  buildMs: number;
  opponentMap: Map<string, PositionStats>;
  allMovesMap: Map<string, AnyPositionStats>;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const statsCache = new Map<string, CachedStats>();

function normalizeFen(fen: string) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return fen.trim();
  return parts.slice(0, 4).join(" ");
}

function sampleMove(moves: MoveStats[], mode: Mode): MoveStats | null {
  if (moves.length === 0) return null;

  if (mode === "random") {
    return moves[Math.floor(Math.random() * moves.length)] ?? null;
  }

  const total = moves.reduce((sum, m) => sum + m.count, 0);
  if (total <= 0) return moves[0] ?? null;

  let r = Math.random() * total;
  for (const m of moves) {
    r -= m.count;
    if (r <= 0) return m;
  }

  return moves[moves.length - 1] ?? null;
}

function inferOpponentColorFromPgn(pgn: string, opponentUsername: string): "w" | "b" | null {
  const re = /^\[(White|Black)\s+\"([^\"]+)\"\]$/gm;
  const opp = opponentUsername.trim().toLowerCase();

  let match: RegExpExecArray | null;
  let white: string | null = null;
  let black: string | null = null;

  while ((match = re.exec(pgn)) !== null) {
    const side = match[1];
    const name = (match[2] ?? "").trim();
    if (!name) continue;
    if (side === "White") white = name;
    if (side === "Black") black = name;
  }

  if (white?.trim().toLowerCase() === opp) return "w";
  if (black?.trim().toLowerCase() === opp) return "b";
  return null;
}

function inferResultFromPgn(pgn: string): "1-0" | "0-1" | "1/2-1/2" | "*" {
  const m = pgn.match(/^\[Result\s+\"(1-0|0-1|1\/2-1\/2|\*)\"\]$/m);
  return (m?.[1] as any) ?? "*";
}

function updateOutcome(stats: MoveStats, oppColor: "w" | "b", result: string) {
  if (result === "1/2-1/2") {
    stats.draw += 1;
    return;
  }

  if (result === "1-0") {
    if (oppColor === "w") stats.win += 1;
    else stats.loss += 1;
    return;
  }

  if (result === "0-1") {
    if (oppColor === "b") stats.win += 1;
    else stats.loss += 1;
    return;
  }
}

function applyUciMove(chess: Chess, uci: string) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? (uci.slice(4) as any) : undefined;
  return chess.move({ from, to, promotion });
}

function computeOpponentMoveDepth(params: {
  startFenKey: string;
  opponentMap: Map<string, PositionStats>;
  allMovesMap: Map<string, AnyPositionStats>;
  maxOpponentMoves: number;
  maxPlies: number;
}): number {
  const { startFenKey, opponentMap, allMovesMap, maxOpponentMoves, maxPlies } = params;

  let opponentMoves = 0;
  let fenKey = startFenKey;

  for (let ply = 0; ply < maxPlies; ply += 1) {
    const chess = new Chess();
    try {
      chess.load(fenKey);
    } catch {
      return opponentMoves;
    }

    const opponentPos = opponentMap.get(fenKey);
    if (opponentPos) {
      const moves = Array.from(opponentPos.moves.values()).sort((a, b) => b.count - a.count);
      const best = moves[0];
      if (!best) return opponentMoves;
      const played = applyUciMove(chess, best.uci);
      if (!played) return opponentMoves;

      opponentMoves += 1;
      if (opponentMoves >= maxOpponentMoves) return opponentMoves;
      fenKey = normalizeFen(chess.fen());
      continue;
    }

    const allPos = allMovesMap.get(fenKey);
    if (!allPos) return opponentMoves;
    const replyMoves = Array.from(allPos.moves.values()).sort((a, b) => b.count - a.count);
    const bestReply = replyMoves[0];
    if (!bestReply) return opponentMoves;
    const playedReply = applyUciMove(chess, bestReply.uci);
    if (!playedReply) return opponentMoves;
    fenKey = normalizeFen(chess.fen());
  }

  return opponentMoves;
}

function getCacheKey(params: { profileId: string; platform: string; username: string }) {
  return `${params.profileId}:${params.platform}:${params.username.toLowerCase()}`;
}

async function getOrBuildStats(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  profileId: string;
  platform: string;
  username: string;
  maxGames: number;
}) {
  const key = getCacheKey({
    profileId: params.profileId,
    platform: params.platform,
    username: params.username,
  });

  const cached = statsCache.get(key);
  const now = Date.now();
  if (cached && now - cached.builtAtMs < CACHE_TTL_MS && cached.maxGames >= params.maxGames) {
    return { cached, cacheStatus: "hit" as const };
  }

  const buildStart = Date.now();

  const { data: games, error } = await params.supabase
    .from("games")
    .select("pgn")
    .eq("profile_id", params.profileId)
    .eq("platform", params.platform)
    .eq("username", params.username)
    .order("played_at", { ascending: false })
    .limit(params.maxGames);

  if (error) {
    throw error;
  }

  const opponentMap = new Map<string, PositionStats>();
  const allMovesMap = new Map<string, AnyPositionStats>();

  for (const row of games ?? []) {
    const pgn = (row as any)?.pgn as string | undefined;
    if (!pgn) continue;

    const oppColor = inferOpponentColorFromPgn(pgn, params.username);
    if (!oppColor) continue;

    const result = inferResultFromPgn(pgn);

    const chess = new Chess();
    try {
      chess.loadPgn(pgn, { strict: false });
    } catch {
      continue;
    }

    const verbose = chess.history({ verbose: true }) as any[];
    const replay = new Chess();

    for (const mv of verbose) {
      const fenKey = normalizeFen(replay.fen());
      const moveColor = mv?.color as "w" | "b" | undefined;

      const allUci = `${mv.from}${mv.to}${mv.promotion ? mv.promotion : ""}`;
      let anyPos = allMovesMap.get(fenKey);
      if (!anyPos) {
        anyPos = { moves: new Map() };
        allMovesMap.set(fenKey, anyPos);
      }
      let anyMove = anyPos.moves.get(allUci);
      if (!anyMove) {
        anyMove = { uci: allUci, count: 0 };
        anyPos.moves.set(allUci, anyMove);
      }
      anyMove.count += 1;

      const played = replay.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      if (!played) break;

      if (moveColor !== oppColor) continue;

      const uci = allUci;
      let pos = opponentMap.get(fenKey);
      if (!pos) {
        pos = { moves: new Map() };
        opponentMap.set(fenKey, pos);
      }

      let s = pos.moves.get(uci);
      if (!s) {
        s = { uci, san: mv.san, count: 0, win: 0, loss: 0, draw: 0 };
        pos.moves.set(uci, s);
      }

      s.count += 1;
      updateOutcome(s, oppColor, result);
    }
  }

  const built: CachedStats = {
    builtAtMs: now,
    maxGames: params.maxGames,
    buildMs: Date.now() - buildStart,
    opponentMap,
    allMovesMap,
  };

  statsCache.set(key, built);
  return { cached: built, cacheStatus: "miss" as const };
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const maxGames = Math.min(Math.max(Number(body?.max_games ?? 500), 1), 2000);
  const maxDepth = Math.min(Math.max(Number(body?.max_depth ?? 16), 1), 40);

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  if (!fen) {
    return NextResponse.json({ error: "fen is required" }, { status: 400 });
  }

  const startFenKey = normalizeFen(fen);

  let cached: CachedStats;
  let cacheStatus: "hit" | "miss";
  try {
    const res = await getOrBuildStats({
      supabase,
      profileId: user.id,
      platform,
      username,
      maxGames,
    });
    cached = res.cached;
    cacheStatus = res.cacheStatus;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load opponent games";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const positionMap = cached.opponentMap;
  const allMovesMap = cached.allMovesMap;

  const startPos = positionMap.get(startFenKey);
  const availableMoves = startPos ? Array.from(startPos.moves.values()) : [];
  const availableTotalCount = availableMoves.reduce((sum, m) => sum + (m.count ?? 0), 0);

  const picked = sampleMove(availableMoves, mode);
  const depthRemaining = computeOpponentMoveDepth({
    startFenKey,
    opponentMap: positionMap,
    allMovesMap,
    maxOpponentMoves: maxDepth,
    maxPlies: Math.max(8, maxDepth * 2),
  });

  return NextResponse.json({
    cache: {
      status: cacheStatus,
      max_games: cached.maxGames,
      age_ms: Date.now() - cached.builtAtMs,
      build_ms: cached.buildMs,
    },
    position: startFenKey,
    mode,
    available_count: availableMoves.length,
    available_total_count: availableTotalCount,
    depth_remaining: depthRemaining,
    move: picked
      ? {
          uci: picked.uci,
          san: picked.san ?? null,
          played_count: picked.count,
          win: picked.win,
          loss: picked.loss,
          draw: picked.draw,
        }
      : null,
    moves: availableMoves
      .sort((a, b) => b.count - a.count)
      .slice(0, 30)
      .map((m) => ({
        uci: m.uci,
        san: m.san ?? null,
        played_count: m.count,
        win: m.win,
        loss: m.loss,
        draw: m.draw,
      })),
  });
}
