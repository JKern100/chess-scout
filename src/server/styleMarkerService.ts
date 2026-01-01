import { Chess } from "chess.js";

export type ChessPlatform = "lichess" | "chesscom";

export type StyleMarkerSourceType = "PROFILE" | "SESSION";

export type StyleMarkerStrength = "Strong" | "Medium" | "Light";

export type StyleMarkerRow = {
  marker_key: string;
  label: string;
  strength: StyleMarkerStrength;
  tooltip: string;
  metrics_json?: any;
};

export type StyleMarkerGame = {
  id?: string;
  opponent_color?: "w" | "b";
  moves_san?: string[];
  pgn?: string;
  result?: "win" | "loss" | "draw" | "unknown";
  opening_category?: OpeningCategory;
};

type OpeningCategory = "Open" | "Semi-Open" | "Closed" | "Indian" | "Flank";

type BenchRow = {
  category: string;
  avg_castle_move: number | null;
  queen_trade_m20_rate: number | null;
  aggression_m15_avg: number | null;
  avg_game_length: number | null;
  opposite_castle_rate: number | null;
  eval_volatility_avg: number | null;
  book_match_avg: number | null;
  long_game_rate: number | null;
};

type ColorFilter = "all" | "white" | "black";

type ContextMetrics = {
  category: OpeningCategory;
  color: ColorFilter;
  sample_size: number;
  queen_trade_rate: number;
  aggression_avg: number;
  avg_game_length: number | null;
  avg_castle_ply: number | null;
  opposite_castle_rate: number;
  long_game_rate: number;
  long_game_win_rate: number | null;
};

type ContextualMarkerData = {
  summary: {
    overall: ContextMetrics;
    white: ContextMetrics;
    black: ContextMetrics;
  };
  contexts: Array<{
    category: OpeningCategory;
    color: ColorFilter;
    opponent_value: number;
    benchmark_value: number;
    diff_ratio: number;
    sample_size: number;
  }>;
  alerts: Array<{
    type: string;
    message: string;
    white_value: number;
    black_value: number;
  }>;
};

function normalizeMove(m: unknown) {
  return String(m ?? "").trim();
}

function diffStrength(diffRatio: number): StyleMarkerStrength | null {
  const abs = Math.abs(diffRatio);
  if (abs > 0.4) return "Strong";
  if (abs > 0.2) return "Medium";
  if (abs > 0.05) return "Light";
  return null;
}

function pct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function computeOpeningCategory(games: StyleMarkerGame[]): OpeningCategory {
  const counts = new Map<string, number>();

  for (const g of games) {
    const moves = Array.isArray(g.moves_san) ? g.moves_san : [];
    const m1 = normalizeMove(moves[0]);
    const m2 = normalizeMove(moves[1]);
    if (!m1) continue;

    const key = `${m1} ${m2}`.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let best: { key: string; n: number } | null = null;
  for (const [key, n] of counts.entries()) {
    if (!best || n > best.n) best = { key, n };
  }

  const top = best?.key ?? "";
  const m1 = top.split(/\s+/g)[0] ?? "";
  const m2 = top.split(/\s+/g)[1] ?? "";

  if (m1 === "e4") {
    if (m2 === "e5") return "Open";
    return "Semi-Open";
  }
  if (m1 === "d4") {
    if (m2 === "d5") return "Closed";
    return "Indian";
  }
  if (m1 === "c4" || m1 === "Nf3") return "Flank";

  return "Semi-Open";
}

/** Classify a single game's opening category based on first two moves */
function classifyGameCategory(moves: string[]): OpeningCategory {
  const m1 = normalizeMove(moves[0]);
  const m2 = normalizeMove(moves[1]);

  if (m1 === "e4") {
    if (m2 === "e5") return "Open";
    return "Semi-Open";
  }
  if (m1 === "d4") {
    if (m2 === "d5") return "Closed";
    return "Indian";
  }
  if (m1 === "c4" || m1 === "Nf3") return "Flank";

  return "Semi-Open";
}

/** Filter games by color (opponent's color) */
function filterByColor(games: StyleMarkerGame[], color: ColorFilter): StyleMarkerGame[] {
  if (color === "all") return games;
  // opponent_color is the color the opponent played
  // "white" filter means opponent played white, so we filter for opponent_color === "w"
  const targetColor = color === "white" ? "w" : "b";
  return games.filter((g) => g.opponent_color === targetColor);
}

/** Filter games by opening category */
function filterByCategory(games: StyleMarkerGame[], category: OpeningCategory | "all"): StyleMarkerGame[] {
  if (category === "all") return games;
  return games.filter((g) => {
    const moves = Array.isArray(g.moves_san) ? g.moves_san : [];
    const cat = g.opening_category ?? classifyGameCategory(moves);
    return cat === category;
  });
}

/** Get significant categories (>15% of games) */
function getSignificantCategories(games: StyleMarkerGame[]): OpeningCategory[] {
  const counts = new Map<OpeningCategory, number>();
  const total = games.length;
  if (total === 0) return [];

  for (const g of games) {
    const moves = Array.isArray(g.moves_san) ? g.moves_san : [];
    const cat = g.opening_category ?? classifyGameCategory(moves);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }

  const threshold = total * 0.15;
  const significant: OpeningCategory[] = [];
  for (const [cat, count] of counts.entries()) {
    if (count >= threshold) significant.push(cat);
  }

  return significant;
}

/** Compute extended metrics including long game stats */
function computeExtendedMetrics(games: StyleMarkerGame[], category: OpeningCategory): ContextMetrics & { counts: any } {
  const baseMetrics = computeMetrics(games);
  
  // Long game rate (games reaching ply 80 = move 40)
  let longGameCount = 0;
  let longGameWins = 0;
  let totalWins = 0;
  let totalGames = 0;

  for (const g of games) {
    const moves = Array.isArray(g.moves_san) ? g.moves_san : [];
    if (moves.length === 0) continue;
    totalGames += 1;
    
    const isLongGame = moves.length >= 80;
    if (isLongGame) longGameCount += 1;
    
    if (g.result === "win") {
      totalWins += 1;
      if (isLongGame) longGameWins += 1;
    }
  }

  const longGameRate = totalGames > 0 ? longGameCount / totalGames : 0;
  const overallWinRate = totalGames > 0 ? totalWins / totalGames : 0;
  const longGameWinRate = longGameCount > 0 ? longGameWins / longGameCount : null;

  return {
    category,
    color: "all",
    sample_size: games.length,
    queen_trade_rate: baseMetrics.queenTradeRate,
    aggression_avg: baseMetrics.aggressionAvg,
    avg_game_length: baseMetrics.avgGameLength,
    avg_castle_ply: baseMetrics.avgCastlePly,
    opposite_castle_rate: baseMetrics.oppositeCastleRate,
    long_game_rate: longGameRate,
    long_game_win_rate: longGameWinRate,
    counts: baseMetrics.counts,
  };
}

function countQueens(chess: Chess) {
  let q = 0;
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p) continue;
      if (p.type === "q") q += 1;
    }
  }
  return q;
}

function opponentMovePlies(params: { opponentColor: "w" | "b"; maxFullMoves: number }) {
  const maxPly = params.maxFullMoves * 2;
  const start = params.opponentColor === "w" ? 1 : 2;
  const out: number[] = [];
  for (let ply = start; ply <= maxPly; ply += 2) out.push(ply);
  return out;
}

function computeMetrics(games: StyleMarkerGame[]) {
  let queenTradeTraded = 0;
  let queenTradeTotal = 0;

  let castlePlySum = 0;
  let castleCount = 0;

  let aggressionSum = 0;
  let aggressionCount = 0;

  let gameLengthSum = 0;
  let gameLengthCount = 0;

  let oppositeCastleCount = 0;
  let oppositeCastleTotal = 0;

  for (const g of games) {
    const moves = Array.isArray(g.moves_san) ? g.moves_san : [];
    const oppColor = g.opponent_color === "w" || g.opponent_color === "b" ? g.opponent_color : null;
    if (moves.length === 0 || !oppColor) continue;

    const fullMoves = Math.ceil(moves.length / 2);

    // Queen trades by move 20 (ply 40): replay only the first 40 plies and check if both queens are gone.
    {
      const replay = new Chess();
      let ok = true;
      const maxPly = Math.min(40, moves.length);
      for (let i = 0; i < maxPly; i++) {
        const mv = normalizeMove(moves[i]);
        if (!mv) break;
        try {
          replay.move(mv, { sloppy: true } as any);
        } catch {
          ok = false;
          break;
        }
      }
      if (ok) {
        queenTradeTotal += 1;
        const queens = countQueens(replay);
        if (queens === 0) queenTradeTraded += 1;
      }
    }

    // Opponent castling ply: find first O-O / O-O-O by opponent.
    {
      const oppPlies = opponentMovePlies({ opponentColor: oppColor, maxFullMoves: 60 });
      let found: number | null = null;
      for (const ply of oppPlies) {
        const idx = ply - 1;
        const mv = normalizeMove(moves[idx]);
        if (!mv) break;
        if (mv === "O-O" || mv === "O-O-O") {
          found = ply;
          break;
        }
      }
      if (found != null) {
        castlePlySum += found;
        castleCount += 1;
      }
    }

    // Aggression index: opponent captures + checks by move 15.
    {
      const oppPlies = opponentMovePlies({ opponentColor: oppColor, maxFullMoves: 15 });
      let c = 0;
      for (const ply of oppPlies) {
        const idx = ply - 1;
        const mv = normalizeMove(moves[idx]);
        if (!mv) break;
        if (mv.includes("x")) c += 1;
        if (mv.endsWith("+") || mv.endsWith("#")) c += 1;
      }
      aggressionSum += c;
      aggressionCount += 1;
    }

    // Average game length (full moves), excluding very short games (< 10 full moves).
    {
      if (fullMoves >= 10) {
        gameLengthSum += fullMoves;
        gameLengthCount += 1;
      }
    }

    // Opposite-side castling rate (O-O vs O-O-O), excluding very short games (< 10 full moves).
    {
      if (fullMoves >= 10) {
        let w: "short" | "long" | null = null;
        let b: "short" | "long" | null = null;
        for (let i = 0; i < moves.length; i++) {
          const mv = normalizeMove(moves[i]);
          if (!mv) break;
          const side = i % 2 === 0 ? "w" : "b";
          if (mv === "O-O") {
            if (side === "w" && w == null) w = "short";
            if (side === "b" && b == null) b = "short";
          } else if (mv === "O-O-O") {
            if (side === "w" && w == null) w = "long";
            if (side === "b" && b == null) b = "long";
          }
          if (w != null && b != null) break;
        }

        oppositeCastleTotal += 1;
        if (w != null && b != null && w !== b) oppositeCastleCount += 1;
      }
    }
  }

  const queenTradeRate = queenTradeTotal > 0 ? queenTradeTraded / queenTradeTotal : 0;
  const avgCastlePly = castleCount > 0 ? castlePlySum / castleCount : null;
  const aggressionAvg = aggressionCount > 0 ? aggressionSum / aggressionCount : 0;
  const avgGameLength = gameLengthCount > 0 ? gameLengthSum / gameLengthCount : null;
  const oppositeCastleRate = oppositeCastleTotal > 0 ? oppositeCastleCount / oppositeCastleTotal : 0;

  return {
    queenTradeRate,
    avgCastlePly,
    aggressionAvg,
    avgGameLength,
    oppositeCastleRate,
    counts: {
      queen_trade_total: queenTradeTotal,
      queen_trade_traded: queenTradeTraded,
      castle_count: castleCount,
      aggression_count: aggressionCount,
      game_length_count: gameLengthCount,
      opposite_castle_total: oppositeCastleTotal,
      opposite_castle_count: oppositeCastleCount,
    },
  };
}

export async function calculateAndStoreMarkers(params: {
  supabase: any;
  profileId: string;
  platform: ChessPlatform;
  username: string;
  games: StyleMarkerGame[];
  sourceType: StyleMarkerSourceType;
  sessionKey?: string | null;
}) {
  const usernameKey = params.username.trim().toLowerCase();
  const games = Array.isArray(params.games) ? params.games : [];
  const sessionKey = typeof params.sessionKey === "string" && params.sessionKey.trim() ? params.sessionKey.trim() : null;

  const category = computeOpeningCategory(games);

  // Fetch all benchmarks for contextual comparisons
  const { data: allBenchData, error: benchError } = await params.supabase
    .from("scout_benchmarks")
    .select("category, avg_castle_move, queen_trade_m20_rate, aggression_m15_avg, avg_game_length, opposite_castle_rate, eval_volatility_avg, book_match_avg, long_game_rate");

  if (benchError) throw benchError;

  const benchmarks = new Map<string, BenchRow>();
  for (const row of (allBenchData ?? []) as BenchRow[]) {
    benchmarks.set(row.category, row);
  }

  const bench = benchmarks.get(category) ?? null;

  // Compute contextual metrics (overall, white, black, and significant categories)
  const whiteGames = filterByColor(games, "white");
  const blackGames = filterByColor(games, "black");
  const significantCategories = getSignificantCategories(games);

  const overallMetrics = computeExtendedMetrics(games, category);
  const whiteMetrics = { ...computeExtendedMetrics(whiteGames, category), color: "white" as ColorFilter };
  const blackMetrics = { ...computeExtendedMetrics(blackGames, category), color: "black" as ColorFilter };

  // Build contexts for significant category+color combinations
  const contexts: ContextualMarkerData["contexts"] = [];
  for (const cat of significantCategories) {
    const catBench = benchmarks.get(cat);
    if (!catBench) continue;

    for (const color of ["all", "white", "black"] as ColorFilter[]) {
      const filtered = filterByColor(filterByCategory(games, cat), color);
      if (filtered.length < 5) continue; // Skip if too few games

      const catMetrics = computeExtendedMetrics(filtered, cat);
      const benchAggression = catBench.aggression_m15_avg ?? 0;
      const diffRatio = benchAggression > 0 ? (catMetrics.aggression_avg - benchAggression) / benchAggression : 0;

      contexts.push({
        category: cat,
        color,
        opponent_value: catMetrics.aggression_avg,
        benchmark_value: benchAggression,
        diff_ratio: diffRatio,
        sample_size: filtered.length,
      });
    }
  }

  // Detect signature deviations (3x difference between colors)
  const alerts: ContextualMarkerData["alerts"] = [];
  if (whiteMetrics.sample_size >= 5 && blackMetrics.sample_size >= 5) {
    const whiteAggro = whiteMetrics.aggression_avg;
    const blackAggro = blackMetrics.aggression_avg;
    const minAggro = Math.min(whiteAggro, blackAggro);
    const maxAggro = Math.max(whiteAggro, blackAggro);
    if (minAggro > 0 && maxAggro / minAggro >= 3) {
      const moreAggressive = whiteAggro > blackAggro ? "White" : "Black";
      alerts.push({
        type: "aggression_asymmetry",
        message: `${moreAggressive} is 3x+ more aggressive`,
        white_value: whiteAggro,
        black_value: blackAggro,
      });
    }

    const whiteQueen = whiteMetrics.queen_trade_rate;
    const blackQueen = blackMetrics.queen_trade_rate;
    const minQueen = Math.min(whiteQueen, blackQueen);
    const maxQueen = Math.max(whiteQueen, blackQueen);
    if (minQueen > 0.05 && maxQueen / minQueen >= 3) {
      const tradesMore = whiteQueen > blackQueen ? "White" : "Black";
      alerts.push({
        type: "queen_trade_asymmetry",
        message: `${tradesMore} trades queens 3x+ more often`,
        white_value: whiteQueen,
        black_value: blackQueen,
      });
    }
  }

  // Build contextual marker data
  const contextualData: ContextualMarkerData = {
    summary: {
      overall: overallMetrics,
      white: whiteMetrics,
      black: blackMetrics,
    },
    contexts,
    alerts,
  };

  const metrics = computeMetrics(games);

  const markers: StyleMarkerRow[] = [];

  // Axis rows are always stored so the UI can render spectrum bars even when deviations are small.
  // These are not meant to be shown as individual marker "pills".
  const axisRows: StyleMarkerRow[] = [];

  // Helper to build contextual metrics_json for each axis
  const buildAxisMetricsJson = (axisKey: string, opponentRaw: number, benchmarkRaw: number | null, diffRatio: number, extra?: Record<string, any>) => {
    // Get color-specific values for this axis
    const getAxisValue = (m: ContextMetrics & { counts?: any }) => {
      switch (axisKey) {
        case "queen_trades": return m.queen_trade_rate;
        case "aggression": return m.aggression_avg;
        case "game_length": return m.avg_game_length;
        case "castling_timing": return m.avg_castle_ply;
        case "opposite_castling": return m.opposite_castle_rate;
        default: return 0;
      }
    };

    return {
      ...(sessionKey ? { session_key: sessionKey } : {}),
      category,
      diff_ratio: diffRatio,
      opponent_raw: opponentRaw,
      benchmark_raw: benchmarkRaw,
      // Contextual summary for UI toggles
      contextual: {
        summary: {
          overall: { value: getAxisValue(overallMetrics), sample_size: overallMetrics.sample_size },
          white: { value: getAxisValue(whiteMetrics), sample_size: whiteMetrics.sample_size },
          black: { value: getAxisValue(blackMetrics), sample_size: blackMetrics.sample_size },
        },
        alerts: alerts.filter((a) => a.type.includes(axisKey.replace("_", ""))),
        available_categories: significantCategories,
      },
      ...extra,
    };
  };

  if (bench) {
    // Queen trade axis (simplification)
    {
      const base = bench.queen_trade_m20_rate != null ? Number(bench.queen_trade_m20_rate) : null;
      const diffRatio = base != null ? (base > 0 ? (metrics.queenTradeRate - base) / base : metrics.queenTradeRate) : 0;
      axisRows.push({
        marker_key: "axis_queen_trades",
        label: "Simplification",
        strength: diffStrength(diffRatio) ?? "Light",
        tooltip: "Queen trade tendency vs global benchmark",
        metrics_json: buildAxisMetricsJson("queen_trades", metrics.queenTradeRate, base, diffRatio, {
          queen_trade_rate: metrics.queenTradeRate,
          benchmark: base,
        }),
      });
    }

    // Game length axis
    {
      const base = bench.avg_game_length != null ? Number(bench.avg_game_length) : null;
      const diffRatio = base != null && metrics.avgGameLength != null ? (base > 0 ? (metrics.avgGameLength - base) / base : metrics.avgGameLength) : 0;
      axisRows.push({
        marker_key: "axis_game_length",
        label: "Game Length",
        strength: diffStrength(diffRatio) ?? "Light",
        tooltip: "Average game length (full moves) vs global benchmark",
        metrics_json: buildAxisMetricsJson("game_length", metrics.avgGameLength ?? 0, base, diffRatio, {
          avg_game_length: metrics.avgGameLength,
          benchmark: base,
          min_full_moves: 10,
        }),
      });
    }

    // Opposite-side castling axis
    {
      const base = bench.opposite_castle_rate != null ? Number(bench.opposite_castle_rate) : null;
      const diffRatio = base != null ? (base > 0 ? (metrics.oppositeCastleRate - base) / base : metrics.oppositeCastleRate) : 0;
      axisRows.push({
        marker_key: "axis_opposite_castling",
        label: "Pawn Storms",
        strength: diffStrength(diffRatio) ?? "Light",
        tooltip: "Opposite-side castling tendency vs global benchmark",
        metrics_json: buildAxisMetricsJson("opposite_castling", metrics.oppositeCastleRate, base, diffRatio, {
          opposite_castle_rate: metrics.oppositeCastleRate,
          benchmark: base,
          min_full_moves: 10,
        }),
      });
    }

    // Castling axis (timing)
    {
      const base = bench.avg_castle_move != null ? Number(bench.avg_castle_move) * 2 : null;
      const diffRatio =
        base != null && metrics.avgCastlePly != null ? (base > 0 ? (metrics.avgCastlePly - base) / base : metrics.avgCastlePly) : 0;
      axisRows.push({
        marker_key: "axis_castling_timing",
        label: "Castling",
        strength: diffStrength(diffRatio) ?? "Light",
        tooltip: "Castling timing vs global benchmark",
        metrics_json: buildAxisMetricsJson("castling_timing", metrics.avgCastlePly ?? 0, base, diffRatio, {
          avg_castle_ply: metrics.avgCastlePly,
          benchmark_ply: base,
        }),
      });
    }

    // Aggression axis
    {
      const base = bench.aggression_m15_avg != null ? Number(bench.aggression_m15_avg) : null;
      const diffRatio = base != null ? (base > 0 ? (metrics.aggressionAvg - base) / base : metrics.aggressionAvg) : 0;
      axisRows.push({
        marker_key: "axis_aggression",
        label: "Aggression",
        strength: diffStrength(diffRatio) ?? "Light",
        tooltip: "Aggression (checks + captures by move 15) vs global benchmark",
        metrics_json: buildAxisMetricsJson("aggression", metrics.aggressionAvg, base, diffRatio, {
          aggression_m15_avg: metrics.aggressionAvg,
          benchmark: base,
        }),
      });
    }

    if (bench.queen_trade_m20_rate != null) {
      const base = Number(bench.queen_trade_m20_rate);
      const diffRatio = base > 0 ? (metrics.queenTradeRate - base) / base : metrics.queenTradeRate;
      const strength = diffStrength(diffRatio);
      if (strength) {
        if (metrics.queenTradeRate > base) {
          markers.push({
            marker_key: "simplification",
            label: "Endgame Seeker",
            strength,
            tooltip: "Seeks early queen trades to simplify",
            metrics_json: { ...(sessionKey ? { session_key: sessionKey } : {}), category, queen_trade_rate: metrics.queenTradeRate, benchmark: base, diff_ratio: diffRatio },
          });
        } else {
          markers.push({
            marker_key: "complication",
            label: "Complication Seeker",
            strength,
            tooltip: "Avoids early queen trades to keep tension",
            metrics_json: { ...(sessionKey ? { session_key: sessionKey } : {}), category, queen_trade_rate: metrics.queenTradeRate, benchmark: base, diff_ratio: diffRatio },
          });
        }
      }
    }

    if (bench.avg_castle_move != null && metrics.avgCastlePly != null) {
      const base = Number(bench.avg_castle_move) * 2;
      const diffRatio = base > 0 ? (metrics.avgCastlePly - base) / base : metrics.avgCastlePly;
      const strength = diffStrength(diffRatio);
      if (strength) {
        if (metrics.avgCastlePly < base) {
          markers.push({
            marker_key: "castle_first",
            label: "Castle-First",
            strength,
            tooltip: "Prioritizes early king safety",
            metrics_json: { ...(sessionKey ? { session_key: sessionKey } : {}), category, avg_castle_ply: metrics.avgCastlePly, benchmark_ply: base, diff_ratio: diffRatio },
          });
        } else {
          markers.push({
            marker_key: "flexible_king",
            label: "Flexible King",
            strength,
            tooltip: "Delays castling to develop pieces first",
            metrics_json: { ...(sessionKey ? { session_key: sessionKey } : {}), category, avg_castle_ply: metrics.avgCastlePly, benchmark_ply: base, diff_ratio: diffRatio },
          });
        }
      }
    }

    if (bench.aggression_m15_avg != null) {
      const base = Number(bench.aggression_m15_avg);
      const diffRatio = base > 0 ? (metrics.aggressionAvg - base) / base : metrics.aggressionAvg;
      const strength = diffStrength(diffRatio);
      if (strength) {
        if (metrics.aggressionAvg > base) {
          markers.push({
            marker_key: "attacker",
            label: "Attacker",
            strength,
            tooltip: "High frequency of early checks and captures",
            metrics_json: { ...(sessionKey ? { session_key: sessionKey } : {}), category, aggression_m15_avg: metrics.aggressionAvg, benchmark: base, diff_ratio: diffRatio },
          });
        } else {
          markers.push({
            marker_key: "positional",
            label: "Positional",
            strength,
            tooltip: "Prefers quiet, maneuvering builds",
            metrics_json: { ...(sessionKey ? { session_key: sessionKey } : {}), category, aggression_m15_avg: metrics.aggressionAvg, benchmark: base, diff_ratio: diffRatio },
          });
        }
      }
    }

    if (bench.avg_game_length != null && metrics.avgGameLength != null) {
      const base = Number(bench.avg_game_length);
      const diffRatio = base > 0 ? (metrics.avgGameLength - base) / base : metrics.avgGameLength;
      if (diffRatio > 0.15 || diffRatio < -0.15) {
        const strength = diffStrength(diffRatio) ?? "Light";
        if (metrics.avgGameLength > base) {
          markers.push({
            marker_key: "marathon_runner",
            label: "Marathon Runner",
            strength,
            tooltip: "Prefers long, grinding endgames",
            metrics_json: { ...(sessionKey ? { session_key: sessionKey } : {}), category, avg_game_length: metrics.avgGameLength, benchmark: base, diff_ratio: diffRatio, min_full_moves: 10 },
          });
        } else {
          markers.push({
            marker_key: "sprinter",
            label: "Sprinter",
            strength,
            tooltip: "Plays short, decisive games; wins early or resigns early",
            metrics_json: { ...(sessionKey ? { session_key: sessionKey } : {}), category, avg_game_length: metrics.avgGameLength, benchmark: base, diff_ratio: diffRatio, min_full_moves: 10 },
          });
        }
      }
    }

    if (bench.opposite_castle_rate != null) {
      const base = Number(bench.opposite_castle_rate);
      const diffRatio = base > 0 ? (metrics.oppositeCastleRate - base) / base : metrics.oppositeCastleRate;
      if (diffRatio > 0.2 || diffRatio < -0.2) {
        const strength = diffStrength(diffRatio) ?? "Light";
        if (metrics.oppositeCastleRate > base) {
          markers.push({
            marker_key: "chaos_creator",
            label: "Chaos Creator",
            strength,
            tooltip: "Creates sharp, opposite-side castling imbalances",
            metrics_json: {
              ...(sessionKey ? { session_key: sessionKey } : {}),
              category,
              opposite_castle_rate: metrics.oppositeCastleRate,
              benchmark: base,
              diff_ratio: diffRatio,
              min_full_moves: 10,
            },
          });
        } else {
          markers.push({
            marker_key: "symmetrical",
            label: "Symmetrical",
            strength,
            tooltip: "Avoids sharp opposite-castling positions",
            metrics_json: {
              ...(sessionKey ? { session_key: sessionKey } : {}),
              category,
              opposite_castle_rate: metrics.oppositeCastleRate,
              benchmark: base,
              diff_ratio: diffRatio,
              min_full_moves: 10,
            },
          });
        }
      }
    }
  }

  await params.supabase
    .from("opponent_style_markers")
    .delete()
    .eq("profile_id", params.profileId)
    .eq("platform", params.platform)
    .eq("username", usernameKey)
    .eq("source_type", params.sourceType);

  const rows = [...axisRows, ...markers].map((m) => ({
    profile_id: params.profileId,
    platform: params.platform,
    username: usernameKey,
    source_type: params.sourceType,
    marker_key: m.marker_key,
    label: m.label,
    strength: m.strength,
    tooltip: m.tooltip,
    metrics_json: m.metrics_json ?? null,
  }));

  const { error: insertError } = await params.supabase.from("opponent_style_markers").insert(rows);
  if (insertError) throw insertError;

  return {
    category,
    markers,
    metrics: {
      queen_trade_rate: pct(metrics.queenTradeRate),
      avg_castle_ply: metrics.avgCastlePly,
      aggression_m15_avg: metrics.aggressionAvg,
      avg_game_length: metrics.avgGameLength,
      opposite_castle_rate: pct(metrics.oppositeCastleRate),
      counts: metrics.counts,
    },
    benchmark: bench,
    contextual: contextualData,
  };
}
