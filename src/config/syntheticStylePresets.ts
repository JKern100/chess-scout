/**
 * Style Presets for Synthetic Opponents
 * 
 * Defines the 3 V1 style presets (Aggressive, Positional, Defensive)
 * with scoring weights for filtering and ranking games from Lichess Explorer.
 */

export type SyntheticStylePreset = "aggressive" | "positional" | "defensive";

export type RatingTier = "all" | "1600" | "1800" | "masters";

export type StyleMetricWeights = {
  /** Higher aggression index (captures + checks early) = more aggressive */
  aggression_index: number;
  /** Higher sacrifice count = more aggressive/sacrificial */
  sacrifice_count: number;
  /** Higher complexity preference (eval volatility) = more tactical */
  complexity_preference: number;
  /** Higher queen trade avoidance = more positional/defensive */
  queen_trade_avoidance: number;
  /** Higher opposite castling rate = more aggressive */
  opposite_castling_rate: number;
  /** Higher quiet move ratio = more positional */
  quiet_move_ratio: number;
  /** Higher space expansion = more positional */
  space_expansion: number;
  /** Higher draw rate = more defensive */
  draw_rate: number;
  /** Longer avg game length = more endgame oriented / defensive */
  avg_game_length: number;
  /** Lower blunder rate = more solid */
  blunder_rate_inverse: number;
};

export type StylePresetConfig = {
  id: SyntheticStylePreset;
  label: string;
  description: string;
  shortDescription: string;
  icon: string;
  color: string;
  /** Weights for scoring games (positive = prefer higher values, negative = prefer lower) */
  weights: StyleMetricWeights;
  /** Minimum style score threshold (0-1) for a game to be included */
  minScoreThreshold: number;
  /** Preparation tips for playing against this style */
  preparationTip: string;
};

export const SYNTHETIC_STYLE_PRESETS: Record<SyntheticStylePreset, StylePresetConfig> = {
  aggressive: {
    id: "aggressive",
    label: "Aggressive",
    description: "Launches direct attacks, high piece activity, willing to sacrifice material for initiative",
    shortDescription: "Attack-focused play",
    icon: "🔥",
    color: "#EF4444",
    weights: {
      aggression_index: 1.0,
      sacrifice_count: 0.8,
      complexity_preference: 0.6,
      queen_trade_avoidance: -0.4,
      opposite_castling_rate: 0.7,
      quiet_move_ratio: -0.5,
      space_expansion: 0.3,
      draw_rate: -0.6,
      avg_game_length: -0.3,
      blunder_rate_inverse: 0.2,
    },
    minScoreThreshold: 0.4,
    preparationTip: "Prioritize king safety; be ready to defend accurately. Avoid giving them open lines.",
  },
  positional: {
    id: "positional",
    label: "Positional",
    description: "Prefers quiet maneuvering, builds advantages slowly, controls key squares and space",
    shortDescription: "Strategic play",
    icon: "♟️",
    color: "#6B7280",
    weights: {
      aggression_index: -0.4,
      sacrifice_count: -0.3,
      complexity_preference: -0.5,
      queen_trade_avoidance: 0.3,
      opposite_castling_rate: -0.2,
      quiet_move_ratio: 1.0,
      space_expansion: 0.8,
      draw_rate: 0.2,
      avg_game_length: 0.5,
      blunder_rate_inverse: 0.4,
    },
    minScoreThreshold: 0.4,
    preparationTip: "Create imbalances early; don't let them control the game's tempo. Look for tactical breaks.",
  },
  defensive: {
    id: "defensive",
    label: "Defensive",
    description: "Prioritizes solidity, neutralizes threats, hard to beat, comfortable in worse positions",
    shortDescription: "Solid, resilient play",
    icon: "🛡️",
    color: "#3B82F6",
    weights: {
      aggression_index: -0.5,
      sacrifice_count: -0.6,
      complexity_preference: -0.4,
      queen_trade_avoidance: 0.7,
      opposite_castling_rate: -0.3,
      quiet_move_ratio: 0.5,
      space_expansion: 0.2,
      draw_rate: 0.8,
      avg_game_length: 0.6,
      blunder_rate_inverse: 1.0,
    },
    minScoreThreshold: 0.4,
    preparationTip: "Prepare for long games; they won't crack under pressure. Build up slowly and convert advantages.",
  },
};

export const RATING_TIERS: Record<RatingTier, { label: string; description: string; lichessRatings: string[] }> = {
  all: {
    label: "All Ratings",
    description: "Games from all rating levels",
    lichessRatings: ["1600", "1800", "2000", "2200", "2500"],
  },
  "1600": {
    label: "1600+",
    description: "Club player level",
    lichessRatings: ["1600", "1800", "2000", "2200", "2500"],
  },
  "1800": {
    label: "1800+",
    description: "Strong club player level",
    lichessRatings: ["1800", "2000", "2200", "2500"],
  },
  masters: {
    label: "Masters",
    description: "Titled players and 2200+",
    lichessRatings: ["2200", "2500"],
  },
};

/**
 * Get the Lichess Explorer ratings parameter for a given tier
 */
export function getRatingsForTier(tier: RatingTier): string {
  return RATING_TIERS[tier].lichessRatings.join(",");
}

/**
 * Score a game's style metrics against a preset
 * Returns a score between 0 and 1
 */
export function scoreGameForPreset(
  metrics: Partial<Record<keyof StyleMetricWeights, number>>,
  preset: SyntheticStylePreset
): number {
  const config = SYNTHETIC_STYLE_PRESETS[preset];
  const weights = config.weights;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const metricKey = key as keyof StyleMetricWeights;
    const value = metrics[metricKey];
    
    if (value === undefined || value === null) continue;

    // Normalize value to 0-1 range (assuming most metrics are already percentages or normalized)
    const normalizedValue = Math.max(0, Math.min(1, value));
    
    // Apply weight (positive weight means higher value is better for this style)
    const absWeight = Math.abs(weight);
    const contribution = weight > 0 ? normalizedValue : 1 - normalizedValue;
    
    weightedSum += contribution * absWeight;
    totalWeight += absWeight;
  }

  if (totalWeight === 0) return 0.5;
  return weightedSum / totalWeight;
}

/**
 * Calculate style metrics from a game's move list
 * Simplified version for quick scoring during import
 */
export function calculateQuickStyleMetrics(
  movesSan: string[],
  playerColor: "w" | "b"
): Partial<Record<keyof StyleMetricWeights, number>> {
  const totalMoves = movesSan.length;
  if (totalMoves < 10) return {};

  let captures = 0;
  let checks = 0;
  let quietMoves = 0;
  let castled = false;
  let castleType: "K" | "Q" | null = null;

  for (let i = 0; i < Math.min(30, totalMoves); i++) {
    const move = movesSan[i] || "";
    const isPlayerMove = (i % 2 === 0 && playerColor === "w") || (i % 2 === 1 && playerColor === "b");
    
    if (!isPlayerMove) continue;

    if (move.includes("x")) captures++;
    if (move.includes("+") || move.includes("#")) checks++;
    if (!move.includes("x") && !move.includes("+") && !move.includes("#")) quietMoves++;
    
    if (move === "O-O" || move === "0-0") {
      castled = true;
      castleType = "K";
    } else if (move === "O-O-O" || move === "0-0-0") {
      castled = true;
      castleType = "Q";
    }
  }

  const playerMoveCount = Math.ceil(Math.min(30, totalMoves) / 2);
  if (playerMoveCount === 0) return {};

  const aggressionIndex = (captures + checks) / playerMoveCount;
  const quietMoveRatio = quietMoves / playerMoveCount;

  return {
    aggression_index: Math.min(1, aggressionIndex / 0.5), // Normalize: 0.5 captures+checks per move = max
    quiet_move_ratio: quietMoveRatio,
    avg_game_length: Math.min(1, totalMoves / 100), // Normalize: 100 moves = max
  };
}

export type SyntheticOpponentSummary = {
  id: string;
  name: string;
  stylePreset: SyntheticStylePreset;
  openingName: string;
  openingEco: string | null;
  ratingTier: RatingTier;
  gamesCount: number;
  syncStatus: "pending" | "syncing" | "complete" | "error";
  createdAt: string;
};
