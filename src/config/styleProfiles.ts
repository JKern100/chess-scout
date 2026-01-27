/**
 * Style Profiles Configuration
 * 
 * Defines 10 distinct chess play styles with detection logic, thresholds, and UI notes.
 * Based on research report for expanded style marker system.
 * 
 * Tiers:
 * - Basic: PGN-derived metrics, fast (~1-5s/game), auto-computed
 * - Advanced: Requires Stockfish eval, slower (~30-60s/game), opt-in
 */

export type StyleTier = "basic" | "advanced";

export type StyleArchetype =
  | "positional"
  | "tactical"
  | "aggressive"
  | "defensive"
  | "counterattacking"
  | "sacrificial"
  | "materialistic"
  | "endgame_oriented"
  | "prophylactic"
  | "universal";

export type MetricSource = "pgn" | "eval" | "hybrid";

export interface StyleMetricDefinition {
  key: string;
  label: string;
  description: string;
  source: MetricSource;
  tier: StyleTier;
  /** Higher value means more of this trait (for threshold comparison) */
  higherIsBetter: boolean;
  /** Thresholds for classification (percentile-based or absolute) */
  thresholds: {
    strong: number;
    medium: number;
    light: number;
  };
  /** How to compute this metric */
  computation: string;
}

export interface StyleProfile {
  archetype: StyleArchetype;
  label: string;
  description: string;
  tier: StyleTier;
  /** Primary metrics that define this style */
  primaryMetrics: string[];
  /** Secondary/supporting metrics */
  secondaryMetrics: string[];
  /** Inverse styles (if high in this, likely low in inverse) */
  inverseStyles: StyleArchetype[];
  /** UI presentation notes */
  uiNotes: {
    icon: string;
    color: string;
    shortDescription: string;
    preparationTip: string;
  };
}

/**
 * All metrics used for style detection
 */
export const STYLE_METRICS: Record<string, StyleMetricDefinition> = {
  // ============ EXISTING METRICS (already computed) ============
  queen_trade_rate: {
    key: "queen_trade_rate",
    label: "Queen Trade Rate",
    description: "Percentage of games where queens are traded by move 20",
    source: "pgn",
    tier: "basic",
    higherIsBetter: true, // for endgame style
    thresholds: { strong: 0.6, medium: 0.4, light: 0.25 },
    computation: "Count games where both queens off board by ply 40 / total games",
  },
  aggression_m15: {
    key: "aggression_m15",
    label: "Early Aggression",
    description: "Average captures + checks by opponent in first 15 moves",
    source: "pgn",
    tier: "basic",
    higherIsBetter: true,
    thresholds: { strong: 4.0, medium: 2.5, light: 1.5 },
    computation: "Sum of captures (x) and checks (+/#) in opponent's first 15 moves",
  },
  castling_timing: {
    key: "castling_timing",
    label: "Castling Timing",
    description: "Average ply when opponent castles",
    source: "pgn",
    tier: "basic",
    higherIsBetter: false, // lower = earlier = safer
    thresholds: { strong: 8, medium: 12, light: 16 },
    computation: "Average ply of first O-O or O-O-O by opponent",
  },
  opposite_castling_rate: {
    key: "opposite_castling_rate",
    label: "Opposite Castling",
    description: "Rate of games with opposite-side castling",
    source: "pgn",
    tier: "basic",
    higherIsBetter: true, // for aggressive style
    thresholds: { strong: 0.3, medium: 0.15, light: 0.08 },
    computation: "Games where players castle to opposite sides / total castled games",
  },
  avg_game_length: {
    key: "avg_game_length",
    label: "Game Length",
    description: "Average number of full moves per game",
    source: "pgn",
    tier: "basic",
    higherIsBetter: true, // for endgame style
    thresholds: { strong: 50, medium: 40, light: 30 },
    computation: "Average (moves.length / 2) for games with >= 10 moves",
  },
  long_game_rate: {
    key: "long_game_rate",
    label: "Long Game Rate",
    description: "Percentage of games reaching move 40+",
    source: "pgn",
    tier: "basic",
    higherIsBetter: true,
    thresholds: { strong: 0.5, medium: 0.35, light: 0.2 },
    computation: "Games with >= 80 ply / total games",
  },
  long_game_win_rate: {
    key: "long_game_win_rate",
    label: "Endgame Win Rate",
    description: "Win rate in games that reach move 40+",
    source: "pgn",
    tier: "basic",
    higherIsBetter: true,
    thresholds: { strong: 0.65, medium: 0.55, light: 0.45 },
    computation: "Wins in long games / total long games",
  },

  // ============ EXISTING ENGINE METRICS ============
  acpl: {
    key: "acpl",
    label: "Average Centipawn Loss",
    description: "Average centipawn loss per move (lower = more accurate)",
    source: "eval",
    tier: "basic", // Available from Lichess analysis
    higherIsBetter: false,
    thresholds: { strong: 25, medium: 40, light: 60 },
    computation: "Sum of centipawn losses / total moves with eval data",
  },
  blunder_rate: {
    key: "blunder_rate",
    label: "Blunder Rate",
    description: "Average blunders per game",
    source: "eval",
    tier: "basic",
    higherIsBetter: false,
    thresholds: { strong: 0.5, medium: 1.5, light: 2.5 },
    computation: "Total blunders / games with analysis",
  },
  crumble_point: {
    key: "crumble_point",
    label: "Crumble Point",
    description: "Average eval (from opponent's view) when blunders occur",
    source: "eval",
    tier: "basic",
    higherIsBetter: false, // More negative = only blunders when already losing
    thresholds: { strong: -200, medium: -50, light: 100 },
    computation: "Average eval before blunder moves",
  },
  defensive_tenacity: {
    key: "defensive_tenacity",
    label: "Defensive Tenacity",
    description: "Average moves survived after falling into lost position (-3.0+)",
    source: "eval",
    tier: "basic",
    higherIsBetter: true,
    thresholds: { strong: 15, medium: 10, light: 5 },
    computation: "Average moves played after eval drops below -300cp",
  },

  // ============ NEW BASIC METRICS (to implement) ============
  quiet_move_ratio: {
    key: "quiet_move_ratio",
    label: "Quiet Move Ratio",
    description: "Percentage of non-forcing moves in first 20 moves",
    source: "pgn",
    tier: "basic",
    higherIsBetter: true, // for positional style
    thresholds: { strong: 0.75, medium: 0.6, light: 0.5 },
    computation: "Moves without x, +, # in first 20 opponent moves / 20",
  },
  sacrifice_count: {
    key: "sacrifice_count",
    label: "Sacrifice Frequency",
    description: "Average intentional material sacrifices per game",
    source: "hybrid",
    tier: "basic",
    higherIsBetter: true, // for sacrificial style
    thresholds: { strong: 0.5, medium: 0.25, light: 0.1 },
    computation: "Moves where opponent gives up material without immediate recapture",
  },
  piece_trade_by_30: {
    key: "piece_trade_by_30",
    label: "Early Simplification",
    description: "Average pieces remaining by move 30",
    source: "pgn",
    tier: "basic",
    higherIsBetter: false, // lower = more trades = defensive/endgame style
    thresholds: { strong: 8, medium: 10, light: 12 },
    computation: "Count pieces on board at ply 60",
  },
  comeback_rate: {
    key: "comeback_rate",
    label: "Comeback Rate",
    description: "Rate of wins/draws from positions eval < -1.5",
    source: "eval",
    tier: "basic",
    higherIsBetter: true, // for counterattacking/defensive
    thresholds: { strong: 0.4, medium: 0.25, light: 0.15 },
    computation: "Games where eval was < -150cp but result was win/draw / games where eval was < -150cp",
  },
  early_disadvantage_tolerance: {
    key: "early_disadvantage_tolerance",
    label: "Disadvantage Tolerance",
    description: "Average eval at move 15 in games eventually won/drawn",
    source: "eval",
    tier: "basic",
    higherIsBetter: false, // More negative = comfortable playing from behind
    thresholds: { strong: -50, medium: -20, light: 0 },
    computation: "Average eval at ply 30 in games with result >= 0.5",
  },
  gambit_frequency: {
    key: "gambit_frequency",
    label: "Gambit Frequency",
    description: "Rate of games with pawn sacrifice in first 10 moves",
    source: "pgn",
    tier: "basic",
    higherIsBetter: true,
    thresholds: { strong: 0.25, medium: 0.15, light: 0.08 },
    computation: "Games with material deficit by ply 20 / total games",
  },
  draw_rate: {
    key: "draw_rate",
    label: "Draw Rate",
    description: "Percentage of games ending in draws",
    source: "pgn",
    tier: "basic",
    higherIsBetter: true, // for defensive style
    thresholds: { strong: 0.35, medium: 0.25, light: 0.15 },
    computation: "Draw results / total games",
  },
  short_game_rate: {
    key: "short_game_rate",
    label: "Short Game Rate",
    description: "Percentage of decisive games ending before move 25",
    source: "pgn",
    tier: "basic",
    higherIsBetter: true, // for aggressive style
    thresholds: { strong: 0.4, medium: 0.25, light: 0.15 },
    computation: "Decisive games < 50 ply / total decisive games",
  },

  // ============ NEW ADVANCED METRICS (engine-heavy) ============
  eval_volatility: {
    key: "eval_volatility",
    label: "Eval Volatility",
    description: "Standard deviation of eval changes per move",
    source: "eval",
    tier: "advanced",
    higherIsBetter: true, // for tactical style
    thresholds: { strong: 80, medium: 50, light: 30 },
    computation: "Stdev of (eval[i] - eval[i-1]) across all moves with eval",
  },
  eval_swing_count: {
    key: "eval_swing_count",
    label: "Eval Swings",
    description: "Average number of ±2 pawn swings per game",
    source: "eval",
    tier: "advanced",
    higherIsBetter: true, // for tactical style
    thresholds: { strong: 3, medium: 2, light: 1 },
    computation: "Count of moves where |eval[i] - eval[i-1]| > 200cp",
  },
  prophylactic_move_rate: {
    key: "prophylactic_move_rate",
    label: "Prophylactic Moves",
    description: "Rate of moves that prevent opponent's top engine line",
    source: "eval",
    tier: "advanced",
    higherIsBetter: true,
    thresholds: { strong: 0.15, medium: 0.1, light: 0.05 },
    computation: "Moves that block opponent's PV / total moves (requires multi-PV analysis)",
  },
  counter_threat_ratio: {
    key: "counter_threat_ratio",
    label: "Counter-Threat Ratio",
    description: "Rate of responding to threats with counter-threats",
    source: "eval",
    tier: "advanced",
    higherIsBetter: true, // for counterattacking
    thresholds: { strong: 0.4, medium: 0.25, light: 0.15 },
    computation: "Moves creating threats when under threat / total threatened positions",
  },
  style_diversity_index: {
    key: "style_diversity_index",
    label: "Style Diversity",
    description: "Entropy of style markers across games (higher = more versatile)",
    source: "hybrid",
    tier: "basic",
    higherIsBetter: true, // for universal style
    thresholds: { strong: 0.8, medium: 0.6, light: 0.4 },
    computation: "Shannon entropy of per-game style classifications",
  },
  opening_variety: {
    key: "opening_variety",
    label: "Opening Variety",
    description: "Number of distinct opening categories played",
    source: "pgn",
    tier: "basic",
    higherIsBetter: true, // for universal style
    thresholds: { strong: 4, medium: 3, light: 2 },
    computation: "Count of distinct opening categories with >= 10% of games",
  },
};

/**
 * Style archetype definitions with detection logic
 */
export const STYLE_PROFILES: Record<StyleArchetype, StyleProfile> = {
  positional: {
    archetype: "positional",
    label: "Positional",
    description: "Prefers quiet maneuvering, avoids tactical complications, builds advantages slowly",
    tier: "basic",
    primaryMetrics: ["quiet_move_ratio", "aggression_m15"],
    secondaryMetrics: ["eval_volatility", "long_game_rate"],
    inverseStyles: ["tactical", "aggressive"],
    uiNotes: {
      icon: "♟️",
      color: "#6B7280", // gray
      shortDescription: "Quiet builder",
      preparationTip: "Create imbalances early; don't let them control the game's tempo",
    },
  },
  tactical: {
    archetype: "tactical",
    label: "Tactical",
    description: "Thrives in complex positions with many threats and calculation",
    tier: "basic",
    primaryMetrics: ["eval_volatility", "eval_swing_count", "aggression_m15"],
    secondaryMetrics: ["sacrifice_count", "short_game_rate"],
    inverseStyles: ["positional", "defensive"],
    uiNotes: {
      icon: "⚔️",
      color: "#EF4444", // red
      shortDescription: "Calculation monster",
      preparationTip: "Simplify when possible; avoid sharp tactical melees",
    },
  },
  aggressive: {
    archetype: "aggressive",
    label: "Aggressive",
    description: "Launches direct attacks, willing to sacrifice for initiative",
    tier: "basic",
    primaryMetrics: ["aggression_m15", "opposite_castling_rate", "sacrifice_count"],
    secondaryMetrics: ["castling_timing", "short_game_rate"],
    inverseStyles: ["defensive", "materialistic"],
    uiNotes: {
      icon: "🔥",
      color: "#F97316", // orange
      shortDescription: "Relentless attacker",
      preparationTip: "Prioritize king safety; be ready to defend accurately",
    },
  },
  defensive: {
    archetype: "defensive",
    label: "Defensive",
    description: "Prioritizes solidity, neutralizes threats, hard to beat",
    tier: "basic",
    primaryMetrics: ["defensive_tenacity", "comeback_rate", "draw_rate"],
    secondaryMetrics: ["piece_trade_by_30", "crumble_point"],
    inverseStyles: ["aggressive", "tactical"],
    uiNotes: {
      icon: "🛡️",
      color: "#3B82F6", // blue
      shortDescription: "Fortress builder",
      preparationTip: "Prepare for long games; they won't crack under pressure",
    },
  },
  counterattacking: {
    archetype: "counterattacking",
    label: "Counterattacking",
    description: "Accepts slight disadvantage to strike back when opponent overextends",
    tier: "basic",
    primaryMetrics: ["early_disadvantage_tolerance", "comeback_rate", "counter_threat_ratio"],
    secondaryMetrics: ["defensive_tenacity"],
    inverseStyles: ["aggressive"],
    uiNotes: {
      icon: "🎯",
      color: "#8B5CF6", // purple
      shortDescription: "Counter-puncher",
      preparationTip: "Don't overextend; they're waiting for you to overreach",
    },
  },
  sacrificial: {
    archetype: "sacrificial",
    label: "Sacrificial",
    description: "Frequently gives up material for activity, initiative, or attack",
    tier: "basic",
    primaryMetrics: ["sacrifice_count", "gambit_frequency"],
    secondaryMetrics: ["aggression_m15", "eval_volatility"],
    inverseStyles: ["materialistic"],
    uiNotes: {
      icon: "💥",
      color: "#EC4899", // pink
      shortDescription: "Material gambler",
      preparationTip: "Accept their gambits if you can defend; they rely on initiative",
    },
  },
  materialistic: {
    archetype: "materialistic",
    label: "Materialistic",
    description: "Prioritizes material gain, rarely sacrifices, converts advantages methodically",
    tier: "basic",
    primaryMetrics: ["sacrifice_count", "gambit_frequency"], // inverse - low values
    secondaryMetrics: ["long_game_rate", "acpl"],
    inverseStyles: ["sacrificial", "aggressive"],
    uiNotes: {
      icon: "💰",
      color: "#10B981", // emerald
      shortDescription: "Material hoarder",
      preparationTip: "Avoid leaving material en prise; they will grab everything",
    },
  },
  endgame_oriented: {
    archetype: "endgame_oriented",
    label: "Endgame-Oriented",
    description: "Steers toward simplified positions where technique prevails",
    tier: "basic",
    primaryMetrics: ["queen_trade_rate", "long_game_rate", "long_game_win_rate"],
    secondaryMetrics: ["piece_trade_by_30", "avg_game_length"],
    inverseStyles: ["aggressive", "tactical"],
    uiNotes: {
      icon: "♔",
      color: "#14B8A6", // teal
      shortDescription: "Technical grinder",
      preparationTip: "Keep pieces on; avoid equal endgames unless you have technique",
    },
  },
  prophylactic: {
    archetype: "prophylactic",
    label: "Prophylactic",
    description: "Anticipates and prevents opponent's plans before they develop",
    tier: "advanced",
    primaryMetrics: ["prophylactic_move_rate", "quiet_move_ratio"],
    secondaryMetrics: ["defensive_tenacity", "crumble_point"],
    inverseStyles: ["aggressive", "tactical"],
    uiNotes: {
      icon: "🔮",
      color: "#6366F1", // indigo
      shortDescription: "Plan preventer",
      preparationTip: "Vary your plans; they anticipate the obvious",
    },
  },
  universal: {
    archetype: "universal",
    label: "Universal",
    description: "Adapts style to the position; no single exploitable weakness",
    tier: "basic",
    primaryMetrics: ["style_diversity_index", "opening_variety"],
    secondaryMetrics: [], // All metrics should be near median
    inverseStyles: [], // No inverse - this is balance
    uiNotes: {
      icon: "🌐",
      color: "#78716C", // stone
      shortDescription: "Chameleon",
      preparationTip: "No obvious weakness to exploit; prepare broadly",
    },
  },
};

/**
 * Get metrics required for a specific tier
 */
export function getMetricsByTier(tier: StyleTier): StyleMetricDefinition[] {
  return Object.values(STYLE_METRICS).filter((m) => m.tier === tier);
}

/**
 * Get all styles that can be detected at a given tier
 */
export function getStylesByTier(tier: StyleTier): StyleProfile[] {
  return Object.values(STYLE_PROFILES).filter((s) => s.tier === tier);
}

/**
 * Detection thresholds for classifying a player into a style
 */
export const STYLE_DETECTION_CONFIG = {
  /** Minimum games required for reliable style detection */
  minGamesForDetection: 20,
  /** Minimum games for advanced style detection */
  minGamesForAdvanced: 50,
  /** How many standard deviations from mean to be "notable" */
  notableDeviationThreshold: 1.5,
  /** Maximum number of primary styles to assign */
  maxPrimaryStyles: 2,
  /** Maximum number of secondary styles to assign */
  maxSecondaryStyles: 3,
};

export type StyleClassification = {
  archetype: StyleArchetype;
  confidence: number; // 0-1
  isPrimary: boolean;
  supportingMetrics: Array<{
    metric: string;
    value: number;
    benchmark: number;
    deviation: number;
  }>;
};

export type StyleAnalysisResult = {
  tier: StyleTier;
  sampleSize: number;
  primaryStyles: StyleClassification[];
  secondaryStyles: StyleClassification[];
  allMetrics: Record<string, { value: number; benchmark: number; percentile: number }>;
  narratives: string[];
};
