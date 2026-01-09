import { Chess } from "chess.js";
import { createHash } from "node:crypto";
import ecoIndexRaw from "@/server/openings/eco_index.json";

export type ChessPlatform = "lichess" | "chesscom";
export type LichessSpeed = "bullet" | "blitz" | "rapid" | "classical" | "correspondence";

export type OpponentProfileFilters = {
  speeds: LichessSpeed[];
  rated: "any" | "rated" | "casual";
  from: string | null;
  to: string | null;
};

type EcoEntry = {
  eco: string;
  name: string;
  moves_san: string[];
};

type GameNorm = {
  id: string;
  played_at: string | null;
  speed: LichessSpeed | null;
  rated: boolean | null;
  opponent_color: "w" | "b";
  result: "win" | "loss" | "draw" | "unknown";
  moves_san: string[];
  // Pre-computed style stats (computed during PGN parsing)
  style?: {
    castle_type: "K" | "Q" | null;
    castle_move: number | null;
    queen_traded_by_20: boolean;
    ks_storm: boolean;
    qs_storm: boolean;
    pawns_advanced_by_10: number;
    captures_by_15: number;
    checks_by_15: number;
  };
  // Engine analysis data (from Lichess computer analysis)
  white_acpl?: number | null;
  black_acpl?: number | null;
  white_blunders?: number | null;
  black_blunders?: number | null;
  evals?: Array<{ e: number | null; m: number | null }> | null;
};

type OpponentMoveEventRow = {
  platform_game_id: string | null;
  played_at: string | null;
  speed: string | null;
  rated: boolean | null;
  ply: number | null;
  is_opponent_move: boolean | null;
  san: string | null;
  uci: string | null;
  win: number | null;
  loss: number | null;
  draw: number | null;
};

export type OpponentProfileGameNorm = GameNorm;

export type V2OpeningRow = {
  eco: string | null;
  name: string;
  games: number;
  pct: number;
};

export type V2BranchMove = {
  move: string;
  games: number;
  pct: number;
};

export type V2BranchNode = {
  ply: number;
  prefix: string[];
  total: number;
  next: V2BranchMove[];
};

export type V2StyleSignals = {
  castling: {
    kingside: number;
    queenside: number;
    none: number;
    avg_castle_move: number | null;
  };
  queen_trade_by_20: {
    traded: number;
    not_traded: number;
    pct: number;
  };
  pawn_storm_after_castle: {
    kingside_pct: number;
    queenside_pct: number;
  };
  aggression: {
    avg_pawns_advanced_by_10: number;
    avg_captures_by_15: number;
    avg_checks_by_15: number;
  };
};

export type V2Results = {
  overall: { win: number; draw: number; loss: number; total: number };
  by_color: {
    as_white: { win: number; draw: number; loss: number; total: number };
    as_black: { win: number; draw: number; loss: number; total: number };
  };
};

export type V2DatasetSummary = {
  games_analyzed: number;
  date_range_start: string | null;
  date_range_end: string | null;
  speeds: Partial<Record<LichessSpeed, number>>;
  colors: { white: number; black: number };
  dominant_speed: LichessSpeed | null;
};

export type V2SegmentProfile = {
  dataset: V2DatasetSummary;
  openings: {
    as_white: V2OpeningRow[];
    as_black_vs_e4: V2OpeningRow[];
    as_black_vs_d4: V2OpeningRow[];
    as_black_vs_c4?: V2OpeningRow[];
    as_black_vs_nf3?: V2OpeningRow[];
    sample_warning: string | null;
  };
  repertoire: {
    vs_e4: { nodes: V2BranchNode[] };
    vs_d4: { nodes: V2BranchNode[] };
  };
  style: V2StyleSignals;
  results: V2Results;
};

export type OpponentProfileV2 = {
  profile_version: 2;
  generated_at: string;
  filters_used: OpponentProfileFilters;
  games_analyzed: number;
  date_range_start: string | null;
  date_range_end: string | null;
  source_game_ids_hash: string;
  segments: {
    all: V2SegmentProfile;
    bullet?: V2SegmentProfile;
    blitz?: V2SegmentProfile;
    rapid?: V2SegmentProfile;
    classical?: V2SegmentProfile;
  };
  engineInsights: null;
  message?: string;
};

function getPgnTagValue(pgn: string, tag: string): string | null {
  const re = new RegExp(`^\\[${tag}\\s+\\"([^\\"]*)\\"\\]$`, "mi");
  const m = pgn.match(re);
  const raw = (m?.[1] ?? "").trim();
  return raw ? raw : null;
}

function inferSpeedFromPgn(pgn: string): LichessSpeed | null {
  const speedTag = getPgnTagValue(pgn, "Speed");
  if (speedTag) {
    const s = speedTag.trim().toLowerCase();
    if (["bullet", "blitz", "rapid", "classical", "correspondence"].includes(s)) return s as LichessSpeed;
  }

  const event = (getPgnTagValue(pgn, "Event") ?? "").toLowerCase();
  if (event.includes("bullet")) return "bullet";
  if (event.includes("blitz")) return "blitz";
  if (event.includes("rapid")) return "rapid";
  if (event.includes("classical")) return "classical";
  if (event.includes("correspondence")) return "correspondence";
  return null;
}

function inferRatedFromPgn(pgn: string): boolean | null {
  const ratedTag = getPgnTagValue(pgn, "Rated");
  if (ratedTag) {
    const v = ratedTag.trim().toLowerCase();
    if (["true", "yes", "1"].includes(v)) return true;
    if (["false", "no", "0"].includes(v)) return false;
  }

  const event = (getPgnTagValue(pgn, "Event") ?? "").toLowerCase();
  if (event.includes("rated")) return true;
  if (event.includes("casual")) return false;
  return null;
}

function inferDateFromPgn(pgn: string): string | null {
  // Try UTCDate + UTCTime first (most accurate)
  const utcDate = getPgnTagValue(pgn, "UTCDate");
  const utcTime = getPgnTagValue(pgn, "UTCTime");
  if (utcDate && /^\d{4}\.\d{2}\.\d{2}$/.test(utcDate)) {
    const dateStr = utcDate.replace(/\./g, "-");
    const timeStr = utcTime && /^\d{2}:\d{2}:\d{2}$/.test(utcTime) ? utcTime : "12:00:00";
    try {
      return new Date(`${dateStr}T${timeStr}Z`).toISOString();
    } catch {
      // Fall through to Date tag
    }
  }
  // Fallback to Date tag
  const dateTag = getPgnTagValue(pgn, "Date");
  if (dateTag && /^\d{4}\.\d{2}\.\d{2}$/.test(dateTag)) {
    const dateStr = dateTag.replace(/\./g, "-");
    try {
      return new Date(`${dateStr}T12:00:00Z`).toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function inferOpponentColorFromPgn(pgn: string, opponentUsername: string): "w" | "b" | null {
  const re = /^\[(White|Black)\s+"([^"]+)"\]$/gm;
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

function parseDateRangeIso(params: { from: string | null; to: string | null }) {
  const fromRaw = params.from?.trim() || null;
  const toRaw = params.to?.trim() || null;

  const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  // For date-only strings, set `from` to start of day and `to` to end of day
  // so that filtering includes all games on both boundary dates.
  const fromIso = fromRaw
    ? isDateOnly(fromRaw)
      ? `${fromRaw}T00:00:00.000Z`
      : new Date(fromRaw).toISOString()
    : null;

  const toIso = toRaw
    ? isDateOnly(toRaw)
      ? `${toRaw}T23:59:59.999Z`
      : new Date(toRaw).toISOString()
    : null;

  return { fromIso, toIso };
}

function moveNumberForPly(ply: number, mover: "w" | "b"): number {
  const fullMove = Math.floor((ply + 1) / 2);
  return mover === "w" ? fullMove : fullMove;
}

function hasQueens(chess: Chess) {
  const b = chess.board();
  let hasW = false;
  let hasB = false;
  for (const row of b) {
    for (const p of row) {
      if (!p) continue;
      if (p.type === "q" && p.color === "w") hasW = true;
      if (p.type === "q" && p.color === "b") hasB = true;
    }
  }
  return { hasW, hasB };
}

function computeStyleFromMoves(
  movesSan: string[],
  oppColor: "w" | "b"
): GameNorm["style"] {
  const replay = new Chess();
  let castleType: "K" | "Q" | null = null;
  let castleMove: number | null = null;
  let queenTradedBy20 = false;
  let ksStorm = false;
  let qsStorm = false;
  let pawnsAdvancedBy10 = 0;
  let capturesBy15 = 0;
  let checksBy15 = 0;

  for (let i = 0; i < movesSan.length; i++) {
    const ply = i + 1;
    const mover = ply % 2 === 1 ? "w" : "b";
    const san = movesSan[i] ?? "";

    let played: any = null;
    try {
      played = replay.move(san as any);
    } catch {
      break;
    }
    if (!played) break;

    if (castleType == null && mover === oppColor) {
      if (san === "O-O" || san === "0-0") {
        castleType = "K";
        castleMove = Math.floor((ply + 1) / 2);
      } else if (san === "O-O-O" || san === "0-0-0") {
        castleType = "Q";
        castleMove = Math.floor((ply + 1) / 2);
      }
    }

    if (!queenTradedBy20 && ply <= 40) {
      const { hasW, hasB } = hasQueens(replay);
      if (!hasW && !hasB) queenTradedBy20 = true;
    }

    if (ply <= 20 && mover === oppColor) {
      if (castleType === "K") {
        if (played.piece === "p" && (played.to?.[0] === "g" || played.to?.[0] === "h") && (played.to?.[1] === "4" || played.to?.[1] === "5")) {
          ksStorm = true;
        }
      }
      if (castleType === "Q") {
        if (played.piece === "p" && (played.to?.[0] === "a" || played.to?.[0] === "b") && (played.to?.[1] === "4" || played.to?.[1] === "5")) {
          qsStorm = true;
        }
      }
    }

    if (ply <= 10 && mover === oppColor && played.piece === "p") {
      pawnsAdvancedBy10 += 1;
    }

    if (ply <= 15 && mover === oppColor) {
      if (played.captured) capturesBy15 += 1;
      if (san.includes("+")) checksBy15 += 1;
    }
  }

  return {
    castle_type: castleType,
    castle_move: castleMove,
    queen_traded_by_20: queenTradedBy20,
    ks_storm: ksStorm,
    qs_storm: qsStorm,
    pawns_advanced_by_10: pawnsAdvancedBy10,
    captures_by_15: capturesBy15,
    checks_by_15: checksBy15,
  };
}

function computeHash(ids: string[]) {
  const h = createHash("sha256");
  h.update(ids.join(","), "utf8");
  return h.digest("hex").slice(0, 16);
}

function pickDominantSpeed(counts: Partial<Record<LichessSpeed, number>>): LichessSpeed | null {
  let best: { s: LichessSpeed; n: number } | null = null;
  for (const s of ["bullet", "blitz", "rapid", "classical", "correspondence"] as const) {
    const n = Number(counts[s] ?? 0);
    if (n <= 0) continue;
    if (!best || n > best.n) best = { s, n };
  }
  return best?.s ?? null;
}

function normalizeEcoIndex(raw: any): EcoEntry[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((e) => ({ eco: String(e?.eco ?? ""), name: String(e?.name ?? ""), moves_san: Array.isArray(e?.moves_san) ? e.moves_san.map((m: any) => String(m)) : [] }))
    .filter((e) => e.eco && e.name && e.moves_san.length > 0);
}

const ECO_INDEX: EcoEntry[] = normalizeEcoIndex(ecoIndexRaw);

function matchEco(movesSan: string[], maxPly: number): { eco: string | null; name: string } {
  const sample = movesSan.slice(0, Math.max(0, maxPly));
  let best: EcoEntry | null = null;
  for (const entry of ECO_INDEX) {
    const m = entry.moves_san;
    if (m.length > sample.length) continue;
    let ok = true;
    for (let i = 0; i < m.length; i += 1) {
      if (sample[i] !== m[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (!best || m.length > best.moves_san.length) best = entry;
  }
  if (!best) {
    return { eco: null, name: "Unknown" };
  }
  return { eco: best.eco, name: best.name };
}

function addWdl(target: { win: number; draw: number; loss: number; total: number }, result: GameNorm["result"]) {
  target.total += 1;
  if (result === "win") target.win += 1;
  else if (result === "loss") target.loss += 1;
  else if (result === "draw") target.draw += 1;
}

function pct(n: number, d: number) {
  if (d <= 0) return 0;
  return (n / d) * 100;
}

function topOpenings(rows: Array<{ eco: string | null; name: string }>, topN: number): V2OpeningRow[] {
  const counts = new Map<string, { eco: string | null; name: string; n: number }>();
  for (const r of rows) {
    const key = `${r.eco ?? ""}|${r.name}`;
    const cur = counts.get(key) ?? { eco: r.eco, name: r.name, n: 0 };
    cur.n += 1;
    counts.set(key, cur);
  }

  const total = rows.length;
  const sorted = Array.from(counts.values()).sort((a, b) => b.n - a.n);
  const top = sorted.slice(0, topN);
  const otherN = sorted.slice(topN).reduce((s, x) => s + x.n, 0);

  const out: V2OpeningRow[] = top.map((t) => ({ eco: t.eco, name: t.name, games: t.n, pct: pct(t.n, total) }));
  if (otherN > 0) out.push({ eco: null, name: "Other", games: otherN, pct: pct(otherN, total) });
  return out;
}

function branchNodes(params: {
  games: GameNorm[];
  filter: (g: GameNorm) => boolean;
  depthPly: number;
  minCount: number;
}): V2BranchNode[] {
  const games = params.games.filter(params.filter);
  const nodes: V2BranchNode[] = [];

  let prefix: string[] = [];
  for (let ply = 1; ply <= params.depthPly; ply += 1) {
    const nextCounts = new Map<string, number>();
    let total = 0;

    for (const g of games) {
      if (g.moves_san.length < prefix.length + 1) continue;
      let ok = true;
      for (let i = 0; i < prefix.length; i += 1) {
        if (g.moves_san[i] !== prefix[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const mv = g.moves_san[prefix.length];
      if (!mv) continue;
      total += 1;
      nextCounts.set(mv, (nextCounts.get(mv) ?? 0) + 1);
    }

    if (total <= 0) break;

    const movesSorted = Array.from(nextCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .filter(([, n]) => n >= params.minCount);

    if (movesSorted.length === 0) break;

    const next = movesSorted.slice(0, 6).map(([move, gamesN]) => ({ move, games: gamesN, pct: pct(gamesN, total) }));

    nodes.push({ ply, prefix: [...prefix], total, next });

    prefix = [...prefix, next[0].move];
  }

  return nodes;
}

function computeStyleSignals(games: GameNorm[]): V2StyleSignals {
  let castlesK = 0;
  let castlesQ = 0;
  let castlesNone = 0;
  let castleMoveSum = 0;
  let castleMoveCount = 0;

  let queenTradedBy20 = 0;
  let queenNotTradedBy20 = 0;

  let ksStormGames = 0;
  let qsStormGames = 0;
  let ksEligible = 0;
  let qsEligible = 0;

  let pawnsAdvancedSum = 0;
  let capturesSum = 0;
  let checksSum = 0;
  let aggrCount = 0;

  for (const g of games) {
    const s = g.style;
    if (!s) continue;

    if (s.castle_type === "K") castlesK += 1;
    else if (s.castle_type === "Q") castlesQ += 1;
    else castlesNone += 1;

    if (s.castle_move != null) {
      castleMoveSum += s.castle_move;
      castleMoveCount += 1;
    }

    if (s.queen_traded_by_20) queenTradedBy20 += 1;
    else queenNotTradedBy20 += 1;

    if (s.castle_type === "K") {
      ksEligible += 1;
      if (s.ks_storm) ksStormGames += 1;
    }
    if (s.castle_type === "Q") {
      qsEligible += 1;
      if (s.qs_storm) qsStormGames += 1;
    }

    pawnsAdvancedSum += s.pawns_advanced_by_10;
    capturesSum += s.captures_by_15;
    checksSum += s.checks_by_15;
    aggrCount += 1;
  }

  const total = games.length;

  return {
    castling: {
      kingside: castlesK,
      queenside: castlesQ,
      none: castlesNone,
      avg_castle_move: castleMoveCount > 0 ? Math.round((castleMoveSum / castleMoveCount) * 10) / 10 : null,
    },
    queen_trade_by_20: {
      traded: queenTradedBy20,
      not_traded: queenNotTradedBy20,
      pct: pct(queenTradedBy20, total),
    },
    pawn_storm_after_castle: {
      kingside_pct: pct(ksStormGames, ksEligible),
      queenside_pct: pct(qsStormGames, qsEligible),
    },
    aggression: {
      avg_pawns_advanced_by_10: aggrCount > 0 ? Math.round((pawnsAdvancedSum / aggrCount) * 10) / 10 : 0,
      avg_captures_by_15: aggrCount > 0 ? Math.round((capturesSum / aggrCount) * 10) / 10 : 0,
      avg_checks_by_15: aggrCount > 0 ? Math.round((checksSum / aggrCount) * 10) / 10 : 0,
    },
  };
}

function buildSegmentProfile(games: GameNorm[]): V2SegmentProfile {
  const speedsCounts: Partial<Record<LichessSpeed, number>> = {};
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  let white = 0;
  let black = 0;

  const overall = { win: 0, draw: 0, loss: 0, total: 0 };
  const asWhite = { win: 0, draw: 0, loss: 0, total: 0 };
  const asBlack = { win: 0, draw: 0, loss: 0, total: 0 };

  const openingsAsWhite: Array<{ eco: string | null; name: string }> = [];
  const openingsBlackE4: Array<{ eco: string | null; name: string }> = [];
  const openingsBlackD4: Array<{ eco: string | null; name: string }> = [];
  const openingsBlackC4: Array<{ eco: string | null; name: string }> = [];
  const openingsBlackNf3: Array<{ eco: string | null; name: string }> = [];

  for (const g of games) {
    if (g.played_at) {
      const iso = new Date(g.played_at).toISOString();
      if (!dateMin || iso < dateMin) dateMin = iso;
      if (!dateMax || iso > dateMax) dateMax = iso;
    }

    if (g.speed) speedsCounts[g.speed] = (speedsCounts[g.speed] ?? 0) + 1;

    if (g.opponent_color === "w") white += 1;
    else black += 1;

    addWdl(overall, g.result);
    if (g.opponent_color === "w") addWdl(asWhite, g.result);
    else addWdl(asBlack, g.result);

    const { eco, name } = matchEco(g.moves_san, 24);

    if (g.opponent_color === "w") {
      openingsAsWhite.push({ eco, name });
    } else {
      const w1 = g.moves_san[0] ?? "";
      if (w1 === "e4") openingsBlackE4.push({ eco, name });
      if (w1 === "d4") openingsBlackD4.push({ eco, name });
      if (w1 === "c4") openingsBlackC4.push({ eco, name });
      if (w1 === "Nf3") openingsBlackNf3.push({ eco, name });
    }
  }

  const gamesAnalyzed = overall.total;

  const sampleWarning = gamesAnalyzed > 0 && gamesAnalyzed < 50 ? "Small sample size (< 50 games)." : null;

  const vsE4Nodes = branchNodes({
    games,
    filter: (g) => g.opponent_color === "b" && (g.moves_san[0] ?? "") === "e4",
    depthPly: 10,
    minCount: 10,
  });

  const vsD4Nodes = branchNodes({
    games,
    filter: (g) => g.opponent_color === "b" && (g.moves_san[0] ?? "") === "d4",
    depthPly: 10,
    minCount: 10,
  });

  return {
    dataset: {
      games_analyzed: gamesAnalyzed,
      date_range_start: dateMin,
      date_range_end: dateMax,
      speeds: speedsCounts,
      colors: { white, black },
      dominant_speed: pickDominantSpeed(speedsCounts),
    },
    openings: {
      as_white: topOpenings(openingsAsWhite, 5),
      as_black_vs_e4: topOpenings(openingsBlackE4, 5),
      as_black_vs_d4: topOpenings(openingsBlackD4, 5),
      as_black_vs_c4: openingsBlackC4.length >= 30 ? topOpenings(openingsBlackC4, 5) : undefined,
      as_black_vs_nf3: openingsBlackNf3.length >= 30 ? topOpenings(openingsBlackNf3, 5) : undefined,
      sample_warning: sampleWarning,
    },
    repertoire: {
      vs_e4: { nodes: vsE4Nodes },
      vs_d4: { nodes: vsD4Nodes },
    },
    style: computeStyleSignals(games),
    results: {
      overall,
      by_color: { as_white: asWhite, as_black: asBlack },
    },
  };
}

export async function buildOpponentProfileV2(params: {
  supabase: any;
  profileId: string;
  platform: ChessPlatform;
  username: string;
  filters: OpponentProfileFilters;
  maxGamesCap?: number | null;
  segmentMinGames?: number;
  includeNormalized?: boolean;
  preferEvents?: boolean;
}): Promise<{ profile: OpponentProfileV2; filtersUsed: OpponentProfileFilters; normalized?: GameNorm[] }>
{
  const { fromIso, toIso } = parseDateRangeIso({ from: params.filters.from, to: params.filters.to });
  const usernameKey = params.username.trim().toLowerCase();

  let speedsFilter = (params.filters.speeds ?? []) as LichessSpeed[];
  const allSpeeds: LichessSpeed[] = ["bullet", "blitz", "rapid", "classical", "correspondence"];
  if (speedsFilter.length >= allSpeeds.length && allSpeeds.every((s) => speedsFilter.includes(s))) {
    speedsFilter = [];
  }
  const ratedFilter = (params.filters.rated ?? "any") as "any" | "rated" | "casual";

  const batchSize = 500;
  let offset = 0;
  let fetchedTotal = 0;

  const maxGamesCap = params.maxGamesCap == null ? null : Number(params.maxGamesCap);

  async function fetchNormalizedFromGames(): Promise<GameNorm[]> {
    const rows: Array<{
      id: string;
      played_at: string | null;
      pgn: string;
      platform_game_id: string | null;
      white_acpl?: number | null;
      black_acpl?: number | null;
      white_blunders?: number | null;
      black_blunders?: number | null;
      evals_json?: Array<{ e: number | null; m: number | null }> | null;
    }> = [];

    for (;;) {
      if (maxGamesCap != null && fetchedTotal >= maxGamesCap) break;
      const remaining = maxGamesCap == null ? batchSize : Math.min(batchSize, maxGamesCap - fetchedTotal);
      if (remaining <= 0) break;

      // Fetch ALL games without date filter - we'll filter in code after extracting dates from PGN
      // This handles games where played_at is NULL in the database
      const query = params.supabase
        .from("games")
        .select("id, pgn, played_at, platform_game_id, white_acpl, black_acpl, white_blunders, black_blunders, evals_json")
        .eq("profile_id", params.profileId)
        .eq("platform", params.platform)
        .ilike("username", usernameKey)
        .order("played_at", { ascending: false, nullsFirst: false });

      const { data, error } = await query.range(offset, offset + remaining - 1);
      if (error) throw error;
      const batch = (data ?? []) as Array<{
        id: string;
        played_at: string | null;
        pgn: string;
        platform_game_id: string | null;
        white_acpl?: number | null;
        black_acpl?: number | null;
        white_blunders?: number | null;
        black_blunders?: number | null;
        evals_json?: Array<{ e: number | null; m: number | null }> | null;
      }>;
      if (batch.length === 0) break;

      rows.push(...batch);
      fetchedTotal += batch.length;
      offset += batch.length;

      if (batch.length < remaining) break;
    }

    const normalized: GameNorm[] = [];

    for (const row of rows) {
      const pgn = String((row as any)?.pgn ?? "");
      if (!pgn) continue;

      // Get played_at from DB or extract from PGN as fallback
      let playedAtIso = row.played_at ? new Date(row.played_at).toISOString() : null;
      if (!playedAtIso) {
        playedAtIso = inferDateFromPgn(pgn);
      }

      // Apply date filter in code (since we fetched all games from DB)
      if (fromIso && playedAtIso && playedAtIso < fromIso) continue;
      if (toIso && playedAtIso && playedAtIso > toIso) continue;

      if (speedsFilter.length > 0) {
        const s = inferSpeedFromPgn(pgn);
        if (s && !speedsFilter.includes(s)) continue;
      }

      if (ratedFilter !== "any") {
        const isRated = inferRatedFromPgn(pgn);
        if (isRated !== null) {
          if (ratedFilter === "rated" && !isRated) continue;
          if (ratedFilter === "casual" && isRated) continue;
        }
      }

      const oppColor = inferOpponentColorFromPgn(pgn, params.username);
      if (!oppColor) continue;

      const speed = inferSpeedFromPgn(pgn);
      const rated = inferRatedFromPgn(pgn);

      const resTag = inferResultFromPgn(pgn);
      let result: GameNorm["result"] = "unknown";
      if (resTag === "1/2-1/2") result = "draw";
      else if (resTag === "1-0") result = oppColor === "w" ? "win" : "loss";
      else if (resTag === "0-1") result = oppColor === "b" ? "win" : "loss";

      const chess = new Chess();
      try {
        chess.loadPgn(pgn, { strict: false });
      } catch {
        continue;
      }

      const moves = (chess.history() ?? []).map((m) => String(m));
      const style = computeStyleFromMoves(moves, oppColor);

      normalized.push({
        id: String((row as any)?.id ?? (row as any)?.platform_game_id ?? ""),
        played_at: playedAtIso,
        speed,
        rated,
        opponent_color: oppColor,
        result,
        moves_san: moves,
        style,
        white_acpl: row.white_acpl ?? null,
        black_acpl: row.black_acpl ?? null,
        white_blunders: row.white_blunders ?? null,
        black_blunders: row.black_blunders ?? null,
        evals: row.evals_json ?? null,
      });
    }

    return normalized;
  }

  async function fetchNormalizedFromEvents(): Promise<GameNorm[]> {
    const eventBatchSize = 1000;
    let eventOffset = 0;
    const capGames = maxGamesCap == null ? 20000 : maxGamesCap;
    const byGame = new Map<
      string,
      {
        played_at: string | null;
        speed: LichessSpeed | null;
        rated: boolean | null;
        zeroBasedPly: boolean;
        opponent_color: "w" | "b";
        result: GameNorm["result"];
        movesByPly: string[];
      }
    >();

    for (;;) {
      const { data, error } = await (() => {
        let q = params.supabase
          .from("opponent_move_events")
          .select("platform_game_id, played_at, speed, rated, ply, is_opponent_move, san, uci, win, loss, draw")
          .eq("profile_id", params.profileId)
          .eq("platform", params.platform)
          .ilike("username", usernameKey)
          .order("played_at", { ascending: false })
          .order("ply", { ascending: true })
          .range(eventOffset, eventOffset + eventBatchSize - 1);

        if (fromIso) q = q.gte("played_at", fromIso);
        if (toIso) q = q.lte("played_at", toIso);
        if (speedsFilter.length > 0) q = q.in("speed", speedsFilter);
        if (ratedFilter !== "any") q = q.eq("rated", ratedFilter === "rated");

        return q;
      })();

      if (error) throw error;
      const batch = (data ?? []) as OpponentMoveEventRow[];
      if (batch.length === 0) break;

      for (const r of batch) {
        const gameId = (r.platform_game_id ?? "").trim();
        if (!gameId) continue;

        const plyRaw = typeof r.ply === "number" ? r.ply : null;

        let rec = byGame.get(gameId);
        if (!rec) {
          if (byGame.size >= capGames) continue;

          const playedAtIso = r.played_at ? new Date(r.played_at).toISOString() : null;
          const speed =
            typeof r.speed === "string" &&
            ["bullet", "blitz", "rapid", "classical", "correspondence"].includes(r.speed.toLowerCase())
              ? (r.speed.toLowerCase() as LichessSpeed)
              : null;

          const rated = typeof r.rated === "boolean" ? r.rated : null;

          const zeroBasedPly = plyRaw === 0;

          // Infer opponent color from first ply. Support both 0-based and 1-based ply.
          const isOpp = typeof r.is_opponent_move === "boolean" ? r.is_opponent_move : null;
          const opponent_color: "w" | "b" = (plyRaw === 0 || plyRaw === 1) && isOpp === true ? "w" : "b";

          const win = Number(r.win ?? 0);
          const loss = Number(r.loss ?? 0);
          const draw = Number(r.draw ?? 0);
          const result: GameNorm["result"] = win > 0 ? "win" : loss > 0 ? "loss" : draw > 0 ? "draw" : "unknown";

          rec = {
            played_at: playedAtIso,
            speed,
            rated,
            zeroBasedPly,
            opponent_color,
            result,
            movesByPly: [],
          };
          byGame.set(gameId, rec);
        }

        // If the first event we see isn't ply=0 (e.g. legacy 1-based), keep 1-based.
        // If this game uses 0-based ply, shift ALL moves by +1 so downstream code can treat it as 1-based.
        const plyAdj =
          plyRaw == null ? null : rec.zeroBasedPly ? plyRaw + 1 : plyRaw;

        const ply = plyAdj;
        if (!ply || ply <= 0) continue;
        const move = (r.san ?? r.uci ?? "").trim();
        if (!move) continue;
        if (Number.isFinite(ply - 1) && ply - 1 >= 0) {
          rec.movesByPly[ply - 1] = move;
        }
      }

      if (byGame.size >= capGames) break;
      eventOffset += batch.length;
      if (batch.length < eventBatchSize) break;
    }

    return Array.from(byGame.entries())
      .map(([gameId, g]) => ({
        id: gameId,
        played_at: g.played_at,
        speed: g.speed,
        rated: g.rated,
        opponent_color: g.opponent_color,
        result: g.result,
        moves_san: g.movesByPly.filter((m) => typeof m === "string" && m.trim()),
      }))
      .sort((a, b) => {
        const aa = a.played_at ?? "";
        const bb = b.played_at ?? "";
        return bb.localeCompare(aa);
      });
  }

  let normalized: GameNorm[] = [];
  if (params.preferEvents) {
    try {
      normalized = await fetchNormalizedFromEvents();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const fallbackOk = msg.includes("relation") || msg.includes("opponent_move_events") || msg.includes("does not exist") || msg.includes("column");
      if (!fallbackOk) throw e;
      normalized = [];
    }
  }

  if (normalized.length === 0) {
    try {
      normalized = await fetchNormalizedFromGames();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const fallbackOk = msg.includes("relation") || msg.includes("games") || msg.includes("does not exist") || msg.includes("column");
      if (!fallbackOk) throw e;
      normalized = [];
    }
  }

  if (normalized.length === 0) {
    normalized = await fetchNormalizedFromEvents();
  }

  const nowIso = new Date().toISOString();
  const idsHash = computeHash(normalized.map((g) => g.id).sort());

  const segmentMin = typeof params.segmentMinGames === "number" ? params.segmentMinGames : 100;

  const allSeg = buildSegmentProfile(normalized);

  const segments: any = { all: allSeg };

  const bySpeedGroups: Partial<Record<LichessSpeed, GameNorm[]>> = {};
  for (const g of normalized) {
    if (!g.speed) continue;
    const arr = bySpeedGroups[g.speed] ?? [];
    arr.push(g);
    bySpeedGroups[g.speed] = arr;
  }

  for (const s of ["bullet", "blitz", "rapid", "classical"] as const) {
    const group = bySpeedGroups[s] ?? [];
    if (group.length >= segmentMin) {
      segments[s] = buildSegmentProfile(group);
    }
  }

  const profile: OpponentProfileV2 = {
    profile_version: 2,
    generated_at: nowIso,
    filters_used: { speeds: speedsFilter, rated: ratedFilter, from: params.filters.from, to: params.filters.to },
    games_analyzed: allSeg.dataset.games_analyzed,
    date_range_start: allSeg.dataset.date_range_start,
    date_range_end: allSeg.dataset.date_range_end,
    source_game_ids_hash: idsHash,
    segments,
    engineInsights: null,
  };

  if (profile.games_analyzed === 0) {
    profile.message = params.platform === "chesscom" ? "No Chess.com games available yet." : "No games matched the selected filters.";
  }

  return { profile, filtersUsed: profile.filters_used, normalized: params.includeNormalized ? normalized : undefined };
}
