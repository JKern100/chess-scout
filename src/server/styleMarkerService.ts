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
  // Engine analysis data (from Lichess computer analysis)
  white_acpl?: number | null;
  black_acpl?: number | null;
  white_blunders?: number | null;
  black_blunders?: number | null;
  evals?: Array<{ e: number | null; m: number | null }> | null;
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

/** Per-axis scores for a single category+color context */
type ContextScore = {
  value: number;
  benchmark: number;
  diff_ratio: number;
  sample_size: number;
};

/** Color-split value with sample size */
type ColorValue = {
  value: number;
  n: number;
};

/** Cluster data for a single axis (Pro-Scout format) */
type ClusterAxisData = {
  white: ColorValue;
  black: ColorValue;
  benchmark: number;
};

/** Full cluster data for all axes */
type ClusterData = {
  queen_trade: ClusterAxisData;
  aggression: ClusterAxisData;
  endgame_skill: ClusterAxisData;
  long_game_rate: ClusterAxisData;
};

/** Pro-Scout 6-Score Matrix format */
type ProScoutMatrix = {
  /** Summary values (overall, white, black) for each axis */
  summary: {
    queen_trade: { white: number; black: number; overall: number };
    aggression: { white: number; black: number; overall: number };
    endgame_skill: { white: number; black: number; overall: number };
    long_game_rate: { white: number; black: number; overall: number };
  };
  /** Per-cluster breakdown with white/black splits */
  clusters: Record<string, ClusterData>;
  /** Available categories (>15% of games) */
  available_categories: OpeningCategory[];
  /** Sample sizes */
  sample_sizes: {
    white: number;
    black: number;
    total: number;
  };
};

/** Full metrics for a category+color context */
type CategoryColorContext = {
  category: OpeningCategory;
  color: "white" | "black";
  sample_size: number;
  queen_trade: ContextScore;
  aggression: ContextScore;
  game_length: ContextScore;
  castling_timing: ContextScore;
  opposite_castling: ContextScore;
  endgame_skill: ContextScore;
  long_game_rate: ContextScore;
};

/** The Context Matrix: all categories × both colors */
type ContextMatrix = {
  /** List of categories with ≥5 games */
  available_categories: OpeningCategory[];
  /** Full breakdown by category and color */
  matrix: CategoryColorContext[];
  /** Overall summary (all games) */
  overall: {
    white: { sample_size: number };
    black: { sample_size: number };
    total: { sample_size: number };
  };
};

/** Signature deviation narrative */
export type SignatureNarrative = {
  axis: string;
  category: OpeningCategory | "overall";
  color: "white" | "black" | "overall";
  deviation_type: "high" | "low";
  ratio: number;
  narrative: string;
};

/** Engine-based metrics for a player */
type EngineMetrics = {
  /** Average Centipawn Loss (lower = more accurate) */
  acpl: number | null;
  /** Number of games with analysis data */
  analyzed_games: number;
  /** Total games in sample */
  total_games: number;
  /** Blunder rate (blunders per game) */
  blunder_rate: number | null;
  /** Crumble Point: avg eval when blunders occur (in centipawns, from opponent's perspective) */
  crumble_point: number | null;
  /** Defensive Tenacity: avg moves survived after eval drops below -300cp */
  defensive_tenacity: number | null;
  /** Complexity Sensitivity: correlation between eval volatility and ACPL */
  complexity_sensitivity: number | null;
  /** Engine Grade based on ACPL relative to rating benchmark */
  engine_grade: "S" | "A" | "B" | "C" | null;
};

/** Engine metrics for the Pro-Scout matrix */
type EngineMatrixEntry = {
  acpl: { white: number | null; black: number | null; overall: number | null };
  blunder_rate: { white: number | null; black: number | null; overall: number | null };
  crumble_point: { white: number | null; black: number | null; overall: number | null };
  defensive_tenacity: { white: number | null; black: number | null; overall: number | null };
  analyzed_games: { white: number; black: number; total: number };
  engine_grade: "S" | "A" | "B" | "C" | null;
};

type ContextualMarkerData = {
  summary: {
    overall: ContextMetrics;
    white: ContextMetrics;
    black: ContextMetrics;
  };
  /** Full Context Matrix for UI category+color selection */
  context_matrix: ContextMatrix;
  /** Pro-Scout 6-Score Matrix */
  pro_scout_matrix: ProScoutMatrix;
  /** Signature deviation narratives */
  narratives: SignatureNarrative[];
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

/** Compute engine-based metrics from games with analysis data */
function computeEngineMetrics(games: StyleMarkerGame[], colorFilter: "all" | "white" | "black" = "all"): EngineMetrics {
  const filtered = colorFilter === "all" ? games : filterByColor(games, colorFilter);
  
  let acplSum = 0;
  let acplCount = 0;
  let blunderSum = 0;
  let blunderCount = 0;
  const crumblePoints: number[] = [];
  const tenacityMoves: number[] = [];
  
  for (const g of filtered) {
    // Get ACPL for the opponent's color in this game
    const oppColor = g.opponent_color;
    const acpl = oppColor === "w" ? g.white_acpl : g.black_acpl;
    const blunders = oppColor === "w" ? g.white_blunders : g.black_blunders;
    
    if (acpl != null && acpl > 0) {
      acplSum += acpl;
      acplCount += 1;
    }
    
    if (blunders != null) {
      blunderSum += blunders;
      blunderCount += 1;
    }
    
    // Analyze per-move evals for crumble point and defensive tenacity
    if (g.evals && g.evals.length > 0) {
      const evals = g.evals;
      const isWhite = oppColor === "w";
      
      // Track eval from opponent's perspective (positive = good for opponent)
      let prevEval: number | null = null;
      let inLostPosition = false;
      let movesSurvived = 0;
      
      for (let i = 0; i < evals.length; i++) {
        const evalEntry = evals[i];
        let cpEval = evalEntry.e;
        
        // Handle mate scores
        if (evalEntry.m != null) {
          cpEval = evalEntry.m > 0 ? 10000 : -10000;
        }
        
        if (cpEval == null) continue;
        
        // Flip eval for Black's perspective
        const oppEval = isWhite ? cpEval : -cpEval;
        
        // Crumble Point: detect blunders (loss of >200cp)
        if (prevEval != null && i % 2 === (isWhite ? 0 : 1)) {
          // This is opponent's move
          const evalDrop = prevEval - oppEval;
          if (evalDrop > 200) {
            // Blunder detected - record the eval before the blunder
            crumblePoints.push(prevEval);
          }
        }
        
        // Defensive Tenacity: count moves after eval drops below -300
        if (oppEval < -300) {
          if (!inLostPosition) {
            inLostPosition = true;
            movesSurvived = 0;
          }
          movesSurvived += 1;
        }
        
        prevEval = oppEval;
      }
      
      if (inLostPosition && movesSurvived > 0) {
        tenacityMoves.push(movesSurvived);
      }
    }
  }
  
  const avgAcpl = acplCount > 0 ? Math.round(acplSum / acplCount) : null;
  const blunderRate = blunderCount > 0 ? blunderSum / blunderCount : null;
  const crumblePoint = crumblePoints.length > 0 
    ? Math.round(crumblePoints.reduce((a, b) => a + b, 0) / crumblePoints.length)
    : null;
  const defensiveTenacity = tenacityMoves.length > 0
    ? Math.round(tenacityMoves.reduce((a, b) => a + b, 0) / tenacityMoves.length)
    : null;
  
  // Engine Grade based on ACPL (rough benchmarks)
  // S: <30, A: 30-50, B: 50-80, C: >80
  let engineGrade: "S" | "A" | "B" | "C" | null = null;
  if (avgAcpl != null) {
    if (avgAcpl < 30) engineGrade = "S";
    else if (avgAcpl < 50) engineGrade = "A";
    else if (avgAcpl < 80) engineGrade = "B";
    else engineGrade = "C";
  }
  
  return {
    acpl: avgAcpl,
    analyzed_games: acplCount,
    total_games: filtered.length,
    blunder_rate: blunderRate,
    crumble_point: crumblePoint,
    defensive_tenacity: defensiveTenacity,
    complexity_sensitivity: null, // TODO: compute correlation
    engine_grade: engineGrade,
  };
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

/** Generate signature deviation narratives based on context matrix */
function generateNarratives(
  contextMatrix: CategoryColorContext[],
  proScoutMatrix: ProScoutMatrix,
  benchmarks: Map<string, BenchRow>
): SignatureNarrative[] {
  const narratives: SignatureNarrative[] = [];
  const DEVIATION_THRESHOLD = 1.5; // Trigger narrative if ratio > 1.5x or < 0.5x

  // Axis display names and templates
  const axisConfig: Record<string, { name: string; highTemplate: string; lowTemplate: string }> = {
    queen_trade: {
      name: "Queen Trades",
      highTemplate: "trades queens {ratio}x more than the {benchmark} average. They seek endgames early; avoid tension releases.",
      lowTemplate: "avoids queen trades ({ratio}x below {benchmark} average). They prefer complex middlegames with queens on the board.",
    },
    aggression: {
      name: "Aggression",
      highTemplate: "plays {ratio}x more aggressively than the {benchmark} baseline. Expect early attacks, sacrifices, and tactical complications.",
      lowTemplate: "plays {ratio}x more passively than typical. They prefer quiet, positional buildups over early aggression.",
    },
    endgame_skill: {
      name: "Endgame Skill",
      highTemplate: "wins {ratio}x more often in long games. They are dangerous in endgames; avoid simplification unless you have a clear advantage.",
      lowTemplate: "struggles in long games ({ratio}x below average win rate). Consider steering toward endgames if you have technique.",
    },
    long_game_rate: {
      name: "Long Games",
      highTemplate: "reaches move 40+ in {ratio}x more games than average. They are patient grinders; prepare for marathon battles.",
      lowTemplate: "finishes games quickly ({ratio}x fewer long games). They either win fast or resign early; don't let them dictate the pace.",
    },
  };

  // Check each category+color context for significant deviations
  for (const entry of contextMatrix) {
    if (entry.sample_size < 10) continue; // Need sufficient sample

    for (const axisKey of ["queen_trade", "aggression", "endgame_skill", "long_game_rate"] as const) {
      const axisData = entry[axisKey];
      if (!axisData || axisData.benchmark === 0) continue;

      const ratio = axisData.value / axisData.benchmark;
      const config = axisConfig[axisKey];
      if (!config) continue;

      if (ratio >= DEVIATION_THRESHOLD) {
        narratives.push({
          axis: axisKey,
          category: entry.category,
          color: entry.color,
          deviation_type: "high",
          ratio: Math.round(ratio * 100) / 100,
          narrative: `In ${entry.category} games as ${entry.color === "white" ? "White" : "Black"}, this player ${config.highTemplate
            .replace("{ratio}", ratio.toFixed(1))
            .replace("{benchmark}", entry.category)}`,
        });
      } else if (ratio <= 1 / DEVIATION_THRESHOLD) {
        const inverseRatio = 1 / ratio;
        narratives.push({
          axis: axisKey,
          category: entry.category,
          color: entry.color,
          deviation_type: "low",
          ratio: Math.round(inverseRatio * 100) / 100,
          narrative: `In ${entry.category} games as ${entry.color === "white" ? "White" : "Black"}, this player ${config.lowTemplate
            .replace("{ratio}", inverseRatio.toFixed(1))
            .replace("{benchmark}", entry.category)}`,
        });
      }
    }
  }

  // Also check overall color asymmetries
  const { summary } = proScoutMatrix;
  for (const axisKey of ["queen_trade", "aggression", "endgame_skill", "long_game_rate"] as const) {
    const axisSum = summary[axisKey];
    if (axisSum.white === 0 || axisSum.black === 0) continue;

    const colorRatio = axisSum.white / axisSum.black;
    const config = axisConfig[axisKey];
    if (!config) continue;

    if (colorRatio >= 2) {
      narratives.push({
        axis: axisKey,
        category: "overall",
        color: "white",
        deviation_type: "high",
        ratio: Math.round(colorRatio * 100) / 100,
        narrative: `This player's ${config.name.toLowerCase()} is ${colorRatio.toFixed(1)}x higher as White than as Black. Their style shifts dramatically based on color.`,
      });
    } else if (colorRatio <= 0.5) {
      const inverseRatio = 1 / colorRatio;
      narratives.push({
        axis: axisKey,
        category: "overall",
        color: "black",
        deviation_type: "high",
        ratio: Math.round(inverseRatio * 100) / 100,
        narrative: `This player's ${config.name.toLowerCase()} is ${inverseRatio.toFixed(1)}x higher as Black than as White. Their style shifts dramatically based on color.`,
      });
    }
  }

  // Sort by ratio (most significant first) and limit to top 5
  narratives.sort((a, b) => b.ratio - a.ratio);
  return narratives.slice(0, 5);
}

/** Generate engine-powered narratives based on ACPL, crumble point, etc. */
function generateEngineNarratives(engineMatrix: EngineMatrixEntry): SignatureNarrative[] {
  const narratives: SignatureNarrative[] = [];
  
  // Only generate if we have sufficient analyzed games
  if (engineMatrix.analyzed_games.total < 10) return narratives;
  
  const { acpl, blunder_rate, crumble_point, defensive_tenacity, engine_grade } = engineMatrix;
  
  // "Technical Perfectionist" Alert: Very low ACPL
  if (acpl.overall != null && acpl.overall < 25) {
    narratives.push({
      axis: "acpl",
      category: "overall",
      color: "overall",
      deviation_type: "low",
      ratio: Math.round((50 / acpl.overall) * 100) / 100,
      narrative: `Technical Master: This player averages only ${acpl.overall} centipawn loss per game. They play with near-engine accuracy. Strategy: You must create complications early; do not let them grind you down in a clean position.`,
    });
  }
  
  // "Front-Runner" Alert: High accuracy when ahead, poor when behind
  // We detect this via crumble point - if they blunder when already slightly behind
  if (crumble_point.overall != null && crumble_point.overall > -100 && crumble_point.overall < 50) {
    narratives.push({
      axis: "crumble_point",
      category: "overall",
      color: "overall",
      deviation_type: "high",
      ratio: 2.0,
      narrative: `Low Tenacity: This player tends to blunder when the position is roughly equal (avg eval ${crumble_point.overall > 0 ? "+" : ""}${crumble_point.overall}cp before blunders). They are a "Front-Runner" - clinical when winning but lose composure under pressure.`,
    });
  } else if (crumble_point.overall != null && crumble_point.overall < -200) {
    narratives.push({
      axis: "crumble_point",
      category: "overall",
      color: "overall",
      deviation_type: "low",
      ratio: 1.5,
      narrative: `Rock Solid: This player only blunders when already in a bad position (avg eval ${crumble_point.overall}cp before blunders). They are mentally tough and rarely crack under pressure.`,
    });
  }
  
  // "Never Resign" Alert: High defensive tenacity
  if (defensive_tenacity.overall != null && defensive_tenacity.overall > 15) {
    narratives.push({
      axis: "defensive_tenacity",
      category: "overall",
      color: "overall",
      deviation_type: "high",
      ratio: defensive_tenacity.overall / 10,
      narrative: `Never-Resign Player: They survive an average of ${defensive_tenacity.overall} moves after falling into a lost position (-3.0 or worse). They will fight to the bitter end and find defensive resources. Don't relax until checkmate.`,
    });
  }
  
  // High blunder rate alert
  if (blunder_rate.overall != null && blunder_rate.overall > 2.5) {
    narratives.push({
      axis: "blunder_rate",
      category: "overall",
      color: "overall",
      deviation_type: "high",
      ratio: blunder_rate.overall / 1.5,
      narrative: `Tactical Vulnerability: This player averages ${blunder_rate.overall.toFixed(1)} blunders per game. Keep the position sharp and tactical; they are prone to oversight under pressure.`,
    });
  }
  
  // Color asymmetry in ACPL
  if (acpl.white != null && acpl.black != null && acpl.white > 0 && acpl.black > 0) {
    const acplRatio = acpl.white / acpl.black;
    if (acplRatio >= 1.5) {
      narratives.push({
        axis: "acpl_asymmetry",
        category: "overall",
        color: "black",
        deviation_type: "high",
        ratio: acplRatio,
        narrative: `Color Weakness: Their accuracy as White (${acpl.white} ACPL) is ${acplRatio.toFixed(1)}x worse than as Black (${acpl.black} ACPL). They may be uncomfortable with White's initiative.`,
      });
    } else if (acplRatio <= 0.67) {
      const inverseRatio = 1 / acplRatio;
      narratives.push({
        axis: "acpl_asymmetry",
        category: "overall",
        color: "white",
        deviation_type: "high",
        ratio: inverseRatio,
        narrative: `Color Weakness: Their accuracy as Black (${acpl.black} ACPL) is ${inverseRatio.toFixed(1)}x worse than as White (${acpl.white} ACPL). They may struggle with defensive positions.`,
      });
    }
  }
  
  return narratives;
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

  // Compute contextual metrics (overall, white, black)
  const whiteGames = filterByColor(games, "white");
  const blackGames = filterByColor(games, "black");

  const overallMetrics = computeExtendedMetrics(games, category);
  const whiteMetrics = { ...computeExtendedMetrics(whiteGames, category), color: "white" as ColorFilter };
  const blackMetrics = { ...computeExtendedMetrics(blackGames, category), color: "black" as ColorFilter };

  // Build full Context Matrix: ALL categories × both colors (not just dominant category)
  const allCategories: OpeningCategory[] = ["Open", "Semi-Open", "Closed", "Indian", "Flank"];
  const availableCategories: OpeningCategory[] = [];
  const contextMatrix: CategoryColorContext[] = [];

  // Helper to compute diff_ratio
  const calcDiffRatio = (value: number | null, benchmark: number | null): number => {
    if (value == null || benchmark == null || benchmark === 0) return 0;
    return (value - benchmark) / benchmark;
  };

  for (const cat of allCategories) {
    const catBench = benchmarks.get(cat);
    if (!catBench) continue;

    for (const color of ["white", "black"] as const) {
      const filtered = filterByColor(filterByCategory(games, cat), color);
      if (filtered.length < 5) continue; // Skip if too few games

      // Track this category as available
      if (!availableCategories.includes(cat)) {
        availableCategories.push(cat);
      }

      const catMetrics = computeExtendedMetrics(filtered, cat);

      // Build ContextScore for each axis
      const queenBench = catBench.queen_trade_m20_rate != null ? Number(catBench.queen_trade_m20_rate) : 0;
      const aggroBench = catBench.aggression_m15_avg != null ? Number(catBench.aggression_m15_avg) : 0;
      const lengthBench = catBench.avg_game_length != null ? Number(catBench.avg_game_length) : 0;
      const castleBench = catBench.avg_castle_move != null ? Number(catBench.avg_castle_move) * 2 : 0; // Convert to ply
      const oppCastleBench = catBench.opposite_castle_rate != null ? Number(catBench.opposite_castle_rate) : 0;

      // Compute endgame skill: long game win rate vs overall win rate
      const longGameBench = catBench.long_game_rate != null ? Number(catBench.long_game_rate) : 0.3;
      const endgameSkill = catMetrics.long_game_win_rate ?? 0;
      // Endgame skill benchmark: assume baseline is ~0.5 (50% win rate in long games)
      const endgameSkillBench = 0.5;

      contextMatrix.push({
        category: cat,
        color,
        sample_size: filtered.length,
        queen_trade: {
          value: catMetrics.queen_trade_rate,
          benchmark: queenBench,
          diff_ratio: calcDiffRatio(catMetrics.queen_trade_rate, queenBench),
          sample_size: filtered.length,
        },
        aggression: {
          value: catMetrics.aggression_avg,
          benchmark: aggroBench,
          diff_ratio: calcDiffRatio(catMetrics.aggression_avg, aggroBench),
          sample_size: filtered.length,
        },
        game_length: {
          value: catMetrics.avg_game_length ?? 0,
          benchmark: lengthBench,
          diff_ratio: calcDiffRatio(catMetrics.avg_game_length, lengthBench),
          sample_size: filtered.length,
        },
        castling_timing: {
          value: catMetrics.avg_castle_ply ?? 0,
          benchmark: castleBench,
          diff_ratio: calcDiffRatio(catMetrics.avg_castle_ply, castleBench),
          sample_size: filtered.length,
        },
        opposite_castling: {
          value: catMetrics.opposite_castle_rate,
          benchmark: oppCastleBench,
          diff_ratio: calcDiffRatio(catMetrics.opposite_castle_rate, oppCastleBench),
          sample_size: filtered.length,
        },
        endgame_skill: {
          value: endgameSkill,
          benchmark: endgameSkillBench,
          diff_ratio: calcDiffRatio(endgameSkill, endgameSkillBench),
          sample_size: filtered.length,
        },
        long_game_rate: {
          value: catMetrics.long_game_rate,
          benchmark: longGameBench,
          diff_ratio: calcDiffRatio(catMetrics.long_game_rate, longGameBench),
          sample_size: filtered.length,
        },
      });
    }
  }

  // Build the full Context Matrix
  const fullContextMatrix: ContextMatrix = {
    available_categories: availableCategories,
    matrix: contextMatrix,
    overall: {
      white: { sample_size: whiteGames.length },
      black: { sample_size: blackGames.length },
      total: { sample_size: games.length },
    },
  };

  // Compute engine-based metrics (ACPL, Crumble Point, Defensive Tenacity)
  const engineMetricsOverall = computeEngineMetrics(games, "all");
  const engineMetricsWhite = computeEngineMetrics(games, "white");
  const engineMetricsBlack = computeEngineMetrics(games, "black");

  const engineMatrix: EngineMatrixEntry = {
    acpl: {
      white: engineMetricsWhite.acpl,
      black: engineMetricsBlack.acpl,
      overall: engineMetricsOverall.acpl,
    },
    blunder_rate: {
      white: engineMetricsWhite.blunder_rate,
      black: engineMetricsBlack.blunder_rate,
      overall: engineMetricsOverall.blunder_rate,
    },
    crumble_point: {
      white: engineMetricsWhite.crumble_point,
      black: engineMetricsBlack.crumble_point,
      overall: engineMetricsOverall.crumble_point,
    },
    defensive_tenacity: {
      white: engineMetricsWhite.defensive_tenacity,
      black: engineMetricsBlack.defensive_tenacity,
      overall: engineMetricsOverall.defensive_tenacity,
    },
    analyzed_games: {
      white: engineMetricsWhite.analyzed_games,
      black: engineMetricsBlack.analyzed_games,
      total: engineMetricsOverall.analyzed_games,
    },
    engine_grade: engineMetricsOverall.engine_grade,
  };

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

  // Build Pro-Scout 6-Score Matrix (clusters format)
  const proScoutClusters: Record<string, ClusterData> = {};
  for (const cat of availableCategories) {
    const whiteEntry = contextMatrix.find((e) => e.category === cat && e.color === "white");
    const blackEntry = contextMatrix.find((e) => e.category === cat && e.color === "black");
    const catBench = benchmarks.get(cat);
    if (!catBench) continue;

    const queenBench = catBench.queen_trade_m20_rate != null ? Number(catBench.queen_trade_m20_rate) : 0;
    const aggroBench = catBench.aggression_m15_avg != null ? Number(catBench.aggression_m15_avg) : 0;
    const longGameBench = catBench.long_game_rate != null ? Number(catBench.long_game_rate) : 0.3;
    const endgameSkillBench = 0.5;

    proScoutClusters[cat] = {
      queen_trade: {
        white: { value: whiteEntry?.queen_trade.value ?? 0, n: whiteEntry?.sample_size ?? 0 },
        black: { value: blackEntry?.queen_trade.value ?? 0, n: blackEntry?.sample_size ?? 0 },
        benchmark: queenBench,
      },
      aggression: {
        white: { value: whiteEntry?.aggression.value ?? 0, n: whiteEntry?.sample_size ?? 0 },
        black: { value: blackEntry?.aggression.value ?? 0, n: blackEntry?.sample_size ?? 0 },
        benchmark: aggroBench,
      },
      endgame_skill: {
        white: { value: whiteEntry?.endgame_skill.value ?? 0, n: whiteEntry?.sample_size ?? 0 },
        black: { value: blackEntry?.endgame_skill.value ?? 0, n: blackEntry?.sample_size ?? 0 },
        benchmark: endgameSkillBench,
      },
      long_game_rate: {
        white: { value: whiteEntry?.long_game_rate.value ?? 0, n: whiteEntry?.sample_size ?? 0 },
        black: { value: blackEntry?.long_game_rate.value ?? 0, n: blackEntry?.sample_size ?? 0 },
        benchmark: longGameBench,
      },
    };
  }

  const proScoutMatrix: ProScoutMatrix = {
    summary: {
      queen_trade: {
        white: whiteMetrics.queen_trade_rate,
        black: blackMetrics.queen_trade_rate,
        overall: overallMetrics.queen_trade_rate,
      },
      aggression: {
        white: whiteMetrics.aggression_avg,
        black: blackMetrics.aggression_avg,
        overall: overallMetrics.aggression_avg,
      },
      endgame_skill: {
        white: whiteMetrics.long_game_win_rate ?? 0,
        black: blackMetrics.long_game_win_rate ?? 0,
        overall: overallMetrics.long_game_win_rate ?? 0,
      },
      long_game_rate: {
        white: whiteMetrics.long_game_rate,
        black: blackMetrics.long_game_rate,
        overall: overallMetrics.long_game_rate,
      },
    },
    clusters: proScoutClusters,
    available_categories: availableCategories,
    sample_sizes: {
      white: whiteGames.length,
      black: blackGames.length,
      total: games.length,
    },
  };

  // Generate signature deviation narratives (style-based + engine-based)
  const styleNarratives = generateNarratives(contextMatrix, proScoutMatrix, benchmarks);
  const engineNarratives = generateEngineNarratives(engineMatrix);
  
  // Merge and sort all narratives by ratio, limit to top 8
  const allNarratives = [...styleNarratives, ...engineNarratives];
  allNarratives.sort((a, b) => b.ratio - a.ratio);
  const narratives: SignatureNarrative[] = allNarratives.slice(0, 8);

  // Build contextual marker data with full Context Matrix
  const contextualData: ContextualMarkerData = {
    summary: {
      overall: overallMetrics,
      white: whiteMetrics,
      black: blackMetrics,
    },
    context_matrix: fullContextMatrix,
    pro_scout_matrix: proScoutMatrix,
    narratives,
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
        available_categories: availableCategories,
        context_matrix: fullContextMatrix,
        pro_scout_matrix: proScoutMatrix,
        narratives,
        engine_metrics: engineMatrix,
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
