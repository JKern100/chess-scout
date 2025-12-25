import { Chess } from "chess.js";

export type MoveSelectionStrategy = "proportional" | "random";

export type MoveStats = {
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

export type OpponentModel = {
  builtAtMs: number;
  buildMs: number;
  maxGames: number;
  opponentMap: Map<string, PositionStats>;
  againstOpponentMap: Map<string, PositionStats>;
};

export type CacheMeta = {
  status: "hit" | "miss";
  max_games: number;
  age_ms: number;
  build_ms: number;
};

export type NextMoveOptions = {
  position: string;
  opponent: {
    totalCount: number;
    moves: MoveStats[];
  };
  againstOpponent: {
    totalCount: number;
    moves: MoveStats[];
  };
  depthRemaining: number;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const statsCache = new Map<string, OpponentModel>();

export function normalizeFen(fen: string) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return fen.trim();
  return parts.slice(0, 4).join(" ");
}

function sampleMove(moves: MoveStats[], mode: MoveSelectionStrategy): MoveStats | null {
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
  try {
    return chess.move({ from, to, promotion });
  } catch {
    return null;
  }
}

function computeOpponentMoveDepth(params: {
  startFenKey: string;
  opponentMap: Map<string, PositionStats>;
  againstOpponentMap: Map<string, PositionStats>;
  maxOpponentMoves: number;
  maxPlies: number;
}): number {
  const { startFenKey, opponentMap, againstOpponentMap, maxOpponentMoves, maxPlies } = params;

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

    const againstPos = againstOpponentMap.get(fenKey);
    if (!againstPos) return opponentMoves;
    const replyMoves = Array.from(againstPos.moves.values()).sort((a, b) => b.count - a.count);
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

export async function getOrBuildOpponentModel(params: {
  supabase: any;
  profileId: string;
  platform: string;
  username: string;
  maxGames: number;
}): Promise<{ model: OpponentModel; cache: CacheMeta }> {
  const key = getCacheKey({
    profileId: params.profileId,
    platform: params.platform,
    username: params.username,
  });

  const cached = statsCache.get(key);
  const now = Date.now();
  if (cached && now - cached.builtAtMs < CACHE_TTL_MS && cached.maxGames >= params.maxGames) {
    return {
      model: cached,
      cache: {
        status: "hit",
        max_games: cached.maxGames,
        age_ms: now - cached.builtAtMs,
        build_ms: cached.buildMs,
      },
    };
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
  const againstOpponentMap = new Map<string, PositionStats>();

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

      const uci = `${mv.from}${mv.to}${mv.promotion ? mv.promotion : ""}`;

      let played: any = null;
      try {
        played = replay.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      } catch {
        break;
      }
      if (!played) break;

      if (moveColor === oppColor) {
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
        continue;
      }

      let pos = againstOpponentMap.get(fenKey);
      if (!pos) {
        pos = { moves: new Map() };
        againstOpponentMap.set(fenKey, pos);
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

  const built: OpponentModel = {
    builtAtMs: now,
    maxGames: params.maxGames,
    buildMs: Date.now() - buildStart,
    opponentMap,
    againstOpponentMap,
  };

  statsCache.set(key, built);

  return {
    model: built,
    cache: {
      status: "miss",
      max_games: built.maxGames,
      age_ms: 0,
      build_ms: built.buildMs,
    },
  };
}

export function getNextMoveOptions(params: {
  model: OpponentModel;
  fen: string;
  maxDepth: number;
}): NextMoveOptions {
  const startFenKey = normalizeFen(params.fen);

  const startPos = params.model.opponentMap.get(startFenKey);
  const opponentMoves = startPos ? Array.from(startPos.moves.values()) : [];
  const opponentTotalCount = opponentMoves.reduce((sum, m) => sum + (m.count ?? 0), 0);

  const againstPos = params.model.againstOpponentMap.get(startFenKey);
  const againstMoves = againstPos ? Array.from(againstPos.moves.values()) : [];
  const againstTotalCount = againstMoves.reduce((sum, m) => sum + (m.count ?? 0), 0);

  const depthRemaining = computeOpponentMoveDepth({
    startFenKey,
    opponentMap: params.model.opponentMap,
    againstOpponentMap: params.model.againstOpponentMap,
    maxOpponentMoves: params.maxDepth,
    maxPlies: Math.max(8, params.maxDepth * 2),
  });

  return {
    position: startFenKey,
    opponent: {
      totalCount: opponentTotalCount,
      moves: opponentMoves.sort((a, b) => b.count - a.count),
    },
    againstOpponent: {
      totalCount: againstTotalCount,
      moves: againstMoves.sort((a, b) => b.count - a.count),
    },
    depthRemaining,
  };
}

export function selectMove(params: {
  moves: MoveStats[];
  strategy: MoveSelectionStrategy;
}) {
  return sampleMove(params.moves, params.strategy);
}
