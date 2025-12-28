import { Chess } from "chess.js";
import { createHash } from "node:crypto";
import type { OpponentProfileGameNorm } from "@/server/opponentProfileV2";

export type ChessPlatform = "lichess" | "chesscom";
export type LichessSpeed = "bullet" | "blitz" | "rapid" | "classical" | "correspondence";

export type OpponentProfileFilters = {
  speeds: LichessSpeed[];
  rated: "any" | "rated" | "casual";
  from: string | null;
  to: string | null;
};

type GameNorm = {
  id: string;
  played_at: string | null;
  speed: LichessSpeed | null;
  rated: boolean | null;
  opponent_color: "w" | "b";
  moves_san: string[];
};

export type V3Concentration = {
  top_line_pct: number;
  top_3_pct: number;
  label: "Highly predictable" | "Moderately varied" | "Very broad";
};

export type V3EntryPoint = {
  decisive_move_san: string | null;
  decisive_move_annotated: string | null;
  avg_move_number: number | null;
  decisive_move_pct: number | null;
  threshold: number;
};

export type V3DeviationHabit = {
  early_deviation_rate: number | null;
  label: "Frequently deviates early" | "Sometimes deviates" | "Stays booked" | "Insufficient sample";
  measured_over_games: number;
  prefix_ply: number;
  diverge_before_ply: number;
};

export type V3Context = {
  concentration: V3Concentration;
  entry_point: V3EntryPoint;
  deviation_habit: V3DeviationHabit;
};

export type V3StructureProfile = {
  castling_side_label: "Kingside-heavy" | "Queenside-heavy" | "Often no castling" | "Mixed";
  early_queen_trades_label: "Frequent" | "Occasional" | "Rare";
  opposite_castling_label: "Frequent" | "Occasional" | "Rare";
  castling: { kingside: number; queenside: number; none: number };
  queen_trade_by_20_pct: number;
  opposite_castling_pct: number;
};

export type OpponentProfileV3 = {
  profile_version: 3;
  generated_at: string;
  filters_used: OpponentProfileFilters;
  games_analyzed: number;
  date_range_start: string | null;
  date_range_end: string | null;
  source_game_ids_hash: string;
  contexts: {
    as_white: V3Context;
    as_black_vs_e4: V3Context;
    as_black_vs_d4: V3Context;
  };
  structure_profile: V3StructureProfile;
  prep_summary: string;
  message?: string;
};

export type OpponentProfileV3Addon = {
  contexts: {
    as_white: V3Context;
    as_black_vs_e4: V3Context;
    as_black_vs_d4: V3Context;
  };
  structure_profile: V3StructureProfile;
  prep_summary: string;
  message?: string;
};

function pct(n: number, d: number) {
  if (!d) return 0;
  return (n / d) * 100;
}

function buildPrepSummaryAddon(addon: OpponentProfileV3Addon): string {
  const profile: OpponentProfileV3 = {
    profile_version: 3,
    generated_at: new Date().toISOString(),
    filters_used: { speeds: [], rated: "any", from: null, to: null },
    games_analyzed: 0,
    date_range_start: null,
    date_range_end: null,
    source_game_ids_hash: "",
    contexts: addon.contexts,
    structure_profile: addon.structure_profile,
    prep_summary: "",
    message: addon.message,
  };
  return buildPrepSummary(profile);
}

export function buildOpponentProfileV3Addon(params: {
  platform: ChessPlatform;
  normalized: OpponentProfileGameNorm[];
}): OpponentProfileV3Addon {
  const normalized = params.normalized as unknown as GameNorm[];

  const asWhite = normalized.filter((g) => g.opponent_color === "w");
  const asBlackVsE4 = normalized.filter((g) => g.opponent_color === "b" && String(g.moves_san[0] ?? "") === "e4");
  const asBlackVsD4 = normalized.filter((g) => g.opponent_color === "b" && String(g.moves_san[0] ?? "") === "d4");

  const linePly = 6;
  const entryThresholdPct = 60;
  const entryMaxPly = 10;

  const contexts = {
    as_white: buildContext({
      games: asWhite,
      linePly,
      entryThresholdPct,
      entryMaxPly,
      entryStartPly: 1,
      deviationPrefixPly: 6,
      deviationDivergeBeforePly: 10,
    }),
    as_black_vs_e4: buildContext({
      games: asBlackVsE4,
      linePly,
      entryThresholdPct,
      entryMaxPly,
      entryStartPly: 2,
      deviationPrefixPly: 6,
      deviationDivergeBeforePly: 10,
    }),
    as_black_vs_d4: buildContext({
      games: asBlackVsD4,
      linePly,
      entryThresholdPct,
      entryMaxPly,
      entryStartPly: 2,
      deviationPrefixPly: 6,
      deviationDivergeBeforePly: 10,
    }),
  };

  const addon: OpponentProfileV3Addon = {
    contexts,
    structure_profile: computeStructureProfile(normalized),
    prep_summary: "",
  };

  addon.prep_summary = buildPrepSummaryAddon(addon);

  if (normalized.length === 0) {
    addon.message = params.platform === "chesscom" ? "No Chess.com games available yet." : "No games matched the selected filters.";
  }

  return addon;
}

function parseDateRangeIso(params: { from: string | null; to: string | null }) {
  const fromIso = params.from ? new Date(params.from).toISOString() : null;
  const toIso = params.to ? new Date(params.to).toISOString() : null;
  return { fromIso, toIso };
}

function getPgnTagValue(pgn: string, tag: string): string | null {
  const re = new RegExp(`\\[${tag}\\s+\"([^\"]+)\"\\]`, "i");
  const m = pgn.match(re);
  return m?.[1] ? String(m[1]) : null;
}

function inferSpeedFromPgn(pgn: string): LichessSpeed | null {
  const s = getPgnTagValue(pgn, "Speed") ?? getPgnTagValue(pgn, "TimeControl") ?? "";
  const speed = String(s).toLowerCase();
  if (["bullet", "blitz", "rapid", "classical", "correspondence"].includes(speed)) return speed as LichessSpeed;
  return null;
}

function inferRatedFromPgn(pgn: string): boolean | null {
  const rated = getPgnTagValue(pgn, "Rated");
  if (!rated) return null;
  const v = String(rated).toLowerCase();
  if (v === "true" || v === "yes" || v === "1") return true;
  if (v === "false" || v === "no" || v === "0") return false;
  return null;
}

function inferOpponentColorFromPgn(pgn: string, opponentUsername: string): "w" | "b" | null {
  const white = getPgnTagValue(pgn, "White");
  const black = getPgnTagValue(pgn, "Black");
  const opp = opponentUsername.toLowerCase();
  if (white && white.toLowerCase() === opp) return "w";
  if (black && black.toLowerCase() === opp) return "b";
  return null;
}

function computeHash(ids: string[]) {
  const h = createHash("sha256");
  h.update(JSON.stringify(ids));
  return h.digest("hex");
}

function annotateMove(ply: number, san: string) {
  const moveNum = Math.ceil(ply / 2);
  const dots = ply % 2 === 1 ? "." : "...";
  return `${moveNum}${dots}${san}`;
}

function buildLineKey(moves: string[], ply: number) {
  return moves.slice(0, ply).join(" ");
}

function labelConcentration(topLinePct: number, top3Pct: number): V3Concentration["label"] {
  if (topLinePct >= 40 || top3Pct >= 75) return "Highly predictable";
  if (topLinePct >= 25 || top3Pct >= 55) return "Moderately varied";
  return "Very broad";
}

function computeConcentration(games: GameNorm[], linePly: number): { topLinePct: number; top3Pct: number } {
  const eligible = games.filter((g) => g.moves_san.length >= linePly);
  if (eligible.length === 0) return { topLinePct: 0, top3Pct: 0 };

  const counts = new Map<string, number>();
  for (const g of eligible) {
    const key = buildLineKey(g.moves_san, linePly);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const top = sorted[0]?.[1] ?? 0;
  const top3 = (sorted[0]?.[1] ?? 0) + (sorted[1]?.[1] ?? 0) + (sorted[2]?.[1] ?? 0);

  return {
    topLinePct: pct(top, eligible.length),
    top3Pct: pct(top3, eligible.length),
  };
}

function computeEntryPoint(params: {
  games: GameNorm[];
  thresholdPct: number;
  maxPly: number;
  startPly: number;
}): { decisivePly: number | null; decisiveSan: string | null; avgMoveNumber: number | null; decisivePct: number | null } {
  const threshold = params.thresholdPct;

  for (let ply = params.startPly; ply <= params.maxPly; ply += 1) {
    const nextCounts = new Map<string, number>();
    let total = 0;

    for (const g of params.games) {
      if (g.moves_san.length < ply) continue;
      const mv = g.moves_san[ply - 1];
      if (!mv) continue;
      total += 1;
      nextCounts.set(mv, (nextCounts.get(mv) ?? 0) + 1);
    }

    if (total === 0) continue;

    let bestMove: string | null = null;
    let bestCount = 0;
    for (const [mv, c] of nextCounts.entries()) {
      if (c > bestCount) {
        bestCount = c;
        bestMove = mv;
      }
    }

    const bestPct = pct(bestCount, total);
    if (bestMove && bestPct >= threshold) {
      const moveNum = Math.ceil(ply / 2);
      return { decisivePly: ply, decisiveSan: bestMove, avgMoveNumber: moveNum, decisivePct: bestPct };
    }
  }

  return { decisivePly: null, decisiveSan: null, avgMoveNumber: null, decisivePct: null };
}

function computeDeviationHabit(params: {
  games: GameNorm[];
  prefixPly: number;
  divergeBeforePly: number;
}): { rate: number | null; measuredOver: number; label: V3DeviationHabit["label"] } {
  const eligible = params.games.filter((g) => g.moves_san.length >= params.prefixPly);
  if (eligible.length === 0) {
    return { rate: null, measuredOver: 0, label: "Insufficient sample" };
  }

  const prefixCounts = new Map<string, number>();
  for (const g of eligible) {
    const key = buildLineKey(g.moves_san, params.prefixPly);
    prefixCounts.set(key, (prefixCounts.get(key) ?? 0) + 1);
  }

  const topPrefix = Array.from(prefixCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (!topPrefix) {
    return { rate: null, measuredOver: 0, label: "Insufficient sample" };
  }

  const matching = eligible.filter((g) => buildLineKey(g.moves_san, params.prefixPly) === topPrefix);
  if (matching.length === 0) {
    return { rate: null, measuredOver: 0, label: "Insufficient sample" };
  }

  const contEligible = matching.filter((g) => g.moves_san.length >= params.prefixPly + 1);
  if (contEligible.length === 0) {
    return { rate: null, measuredOver: 0, label: "Insufficient sample" };
  }

  const mainCounts = new Map<string, number>();
  for (const g of contEligible) {
    const key = buildLineKey(g.moves_san, Math.min(params.divergeBeforePly, g.moves_san.length));
    mainCounts.set(key, (mainCounts.get(key) ?? 0) + 1);
  }

  const mainLineKey = Array.from(mainCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mainMoves = mainLineKey ? mainLineKey.split(" ") : null;
  if (!mainMoves || mainMoves.length < params.prefixPly) {
    return { rate: null, measuredOver: 0, label: "Insufficient sample" };
  }

  let diverged = 0;
  let measured = 0;

  for (const g of contEligible) {
    const maxPly = Math.min(params.divergeBeforePly, g.moves_san.length, mainMoves.length);
    if (maxPly <= params.prefixPly) continue;
    measured += 1;

    let isDiverged = false;
    for (let ply = params.prefixPly + 1; ply <= maxPly; ply += 1) {
      const idx = ply - 1;
      if ((g.moves_san[idx] ?? null) !== (mainMoves[idx] ?? null)) {
        isDiverged = true;
        break;
      }
    }

    if (isDiverged) diverged += 1;
  }

  if (measured === 0) {
    return { rate: null, measuredOver: 0, label: "Insufficient sample" };
  }

  const rate = diverged / measured;
  let label: V3DeviationHabit["label"] = "Stays booked";
  if (rate >= 0.35) label = "Frequently deviates early";
  else if (rate >= 0.2) label = "Sometimes deviates";

  return { rate, measuredOver: measured, label };
}

function computeStructureProfile(games: GameNorm[]): V3StructureProfile {
  let oppK = 0;
  let oppQ = 0;
  let oppNone = 0;

  let queenTradeYes = 0;
  let queenTradeNo = 0;

  let oppCastledGames = 0;
  let oppositeCastleGames = 0;

  for (const g of games) {
    const replay = new Chess();

    let whiteCastle: "K" | "Q" | null = null;
    let blackCastle: "K" | "Q" | null = null;

    let opponentCastle: "K" | "Q" | null = null;
    let queensTraded = false;

    for (let i = 0; i < g.moves_san.length; i += 1) {
      const ply = i + 1;
      const mover = ply % 2 === 1 ? "w" : "b";
      const san = String(g.moves_san[i] ?? "");

      let played: any = null;
      try {
        played = replay.move(san as any);
      } catch {
        break;
      }
      if (!played) break;

      if (san === "O-O" || san === "0-0") {
        if (mover === "w") whiteCastle = "K";
        else blackCastle = "K";

        if (mover === g.opponent_color && opponentCastle == null) opponentCastle = "K";
      }
      if (san === "O-O-O" || san === "0-0-0") {
        if (mover === "w") whiteCastle = "Q";
        else blackCastle = "Q";

        if (mover === g.opponent_color && opponentCastle == null) opponentCastle = "Q";
      }

      if (!queensTraded && ply <= 40) {
        const board = replay.board();
        let wq = 0;
        let bq = 0;
        for (const row of board) {
          for (const p of row) {
            if (!p) continue;
            if (p.type === "q" && p.color === "w") wq += 1;
            if (p.type === "q" && p.color === "b") bq += 1;
          }
        }
        if (wq === 0 && bq === 0) queensTraded = true;
      }
    }

    if (opponentCastle === "K") oppK += 1;
    else if (opponentCastle === "Q") oppQ += 1;
    else oppNone += 1;

    if (queensTraded) queenTradeYes += 1;
    else queenTradeNo += 1;

    if (whiteCastle && blackCastle) {
      oppCastledGames += 1;
      if (whiteCastle !== blackCastle) oppositeCastleGames += 1;
    }
  }

  const total = games.length;
  const queenPct = total > 0 ? queenTradeYes / total : 0;
  const oppositePct = oppCastledGames > 0 ? oppositeCastleGames / oppCastledGames : 0;

  let castlingLabel: V3StructureProfile["castling_side_label"] = "Mixed";
  const max = Math.max(oppK, oppQ, oppNone);
  if (max === oppK && oppK >= oppQ + oppNone) castlingLabel = "Kingside-heavy";
  else if (max === oppQ && oppQ >= oppK + oppNone) castlingLabel = "Queenside-heavy";
  else if (max === oppNone && oppNone >= oppK + oppQ) castlingLabel = "Often no castling";

  const queenLabel: V3StructureProfile["early_queen_trades_label"] = queenPct >= 0.5 ? "Frequent" : queenPct >= 0.25 ? "Occasional" : "Rare";
  const oppLabel: V3StructureProfile["opposite_castling_label"] = oppositePct >= 0.5 ? "Frequent" : oppositePct >= 0.25 ? "Occasional" : "Rare";

  return {
    castling_side_label: castlingLabel,
    early_queen_trades_label: queenLabel,
    opposite_castling_label: oppLabel,
    castling: { kingside: oppK, queenside: oppQ, none: oppNone },
    queen_trade_by_20_pct: Math.round(queenPct * 1000) / 10,
    opposite_castling_pct: Math.round(oppositePct * 1000) / 10,
  };
}

function buildContext(params: {
  games: GameNorm[];
  linePly: number;
  entryThresholdPct: number;
  entryMaxPly: number;
  entryStartPly: number;
  deviationPrefixPly: number;
  deviationDivergeBeforePly: number;
}): V3Context {
  const conc = computeConcentration(params.games, params.linePly);
  const concentration: V3Concentration = {
    top_line_pct: Math.round(conc.topLinePct * 10) / 10,
    top_3_pct: Math.round(conc.top3Pct * 10) / 10,
    label: labelConcentration(conc.topLinePct, conc.top3Pct),
  };

  const entry = computeEntryPoint({
    games: params.games,
    thresholdPct: params.entryThresholdPct,
    maxPly: params.entryMaxPly,
    startPly: params.entryStartPly,
  });

  const entry_point: V3EntryPoint = {
    decisive_move_san: entry.decisiveSan,
    decisive_move_annotated: entry.decisivePly && entry.decisiveSan ? annotateMove(entry.decisivePly, entry.decisiveSan) : null,
    avg_move_number: entry.avgMoveNumber,
    decisive_move_pct: entry.decisivePct == null ? null : Math.round(entry.decisivePct * 10) / 10,
    threshold: params.entryThresholdPct / 100,
  };

  const dev = computeDeviationHabit({
    games: params.games,
    prefixPly: params.deviationPrefixPly,
    divergeBeforePly: params.deviationDivergeBeforePly,
  });

  const deviation_habit: V3DeviationHabit = {
    early_deviation_rate: dev.rate == null ? null : Math.round(dev.rate * 1000) / 1000,
    label: dev.label,
    measured_over_games: dev.measuredOver,
    prefix_ply: params.deviationPrefixPly,
    diverge_before_ply: params.deviationDivergeBeforePly,
  };

  return { concentration, entry_point, deviation_habit };
}

function pickPrimaryContext(profile: OpponentProfileV3): { key: keyof OpponentProfileV3["contexts"]; label: string } {
  const order: Array<[keyof OpponentProfileV3["contexts"], string]> = [
    ["as_black_vs_e4", "as Black vs 1.e4"],
    ["as_black_vs_d4", "as Black vs 1.d4"],
    ["as_white", "as White"],
  ];

  for (const [k, label] of order) {
    const ctx = profile.contexts[k];
    const hasEntry = Boolean(ctx.entry_point.decisive_move_annotated);
    const hasConc = ctx.concentration.top_line_pct > 0;
    if (hasEntry || hasConc) return { key: k, label };
  }

  return { key: "as_black_vs_e4", label: "as Black vs 1.e4" };
}

function buildPrepSummary(profile: OpponentProfileV3): string {
  const primary = pickPrimaryContext(profile);
  const ctx = profile.contexts[primary.key];

  const concLabel = ctx.concentration.label;
  const entry = ctx.entry_point;
  const entryText = entry.decisive_move_annotated && entry.avg_move_number != null ? `committing to ${entry.decisive_move_annotated} by move ${entry.avg_move_number}` : "not showing a single early commitment point";

  const queen = profile.structure_profile.early_queen_trades_label.toLowerCase();

  const devLabel = ctx.deviation_habit.label;
  const devText =
    devLabel === "Frequently deviates early"
      ? "often deviates from their own main line before move 10"
      : devLabel === "Sometimes deviates"
        ? "sometimes deviates from their own main line before move 10"
        : devLabel === "Stays booked"
          ? "usually stays on their main line through move 10"
          : "has insufficient sample to measure deviations";

  return `This opponent is ${concLabel.toLowerCase()} ${primary.label}, ${entryText}. They ${queen} trade queens early and ${devText}, suggesting prep should emphasize the most common structures rather than deep theory.`;
}

export async function buildOpponentProfileV3(params: {
  supabase: any;
  profileId: string;
  platform: ChessPlatform;
  username: string;
  filters: OpponentProfileFilters;
  maxGamesCap?: number | null;
}): Promise<{ profile: OpponentProfileV3; filtersUsed: OpponentProfileFilters }> {
  const { fromIso, toIso } = parseDateRangeIso({ from: params.filters.from, to: params.filters.to });

  const speedsFilter = (params.filters.speeds ?? []) as LichessSpeed[];
  const ratedFilter = (params.filters.rated ?? "any") as "any" | "rated" | "casual";

  const batchSize = 500;
  let offset = 0;
  let fetchedTotal = 0;

  const maxGamesCap = params.maxGamesCap == null ? null : Number(params.maxGamesCap);

  const rows: Array<{ id: string; played_at: string | null; pgn: string; platform_game_id: string | null }> = [];

  for (;;) {
    if (maxGamesCap != null && fetchedTotal >= maxGamesCap) break;
    const remaining = maxGamesCap == null ? batchSize : Math.min(batchSize, maxGamesCap - fetchedTotal);
    if (remaining <= 0) break;

    let query = params.supabase
      .from("games")
      .select("id, pgn, played_at, platform_game_id")
      .eq("profile_id", params.profileId)
      .eq("platform", params.platform)
      .eq("username", params.username)
      .order("played_at", { ascending: false });

    if (fromIso) query = query.gte("played_at", fromIso);
    if (toIso) query = query.lte("played_at", toIso);

    const { data, error } = await query.range(offset, offset + remaining - 1);
    if (error) throw error;
    const batch = (data ?? []) as Array<{ id: string; played_at: string | null; pgn: string; platform_game_id: string | null }>;
    if (batch.length === 0) break;

    rows.push(...batch);
    fetchedTotal += batch.length;
    offset += batch.length;

    if (batch.length < remaining) break;
  }

  const normalized: GameNorm[] = [];
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  for (const row of rows) {
    const pgn = String((row as any)?.pgn ?? "");
    if (!pgn) continue;

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

    const chess = new Chess();
    try {
      chess.loadPgn(pgn, { strict: false });
    } catch {
      continue;
    }

    const moves = (chess.history() ?? []).map((m) => String(m));

    const playedAtIso = row.played_at ? new Date(row.played_at).toISOString() : null;
    if (playedAtIso) {
      if (!dateMin || playedAtIso < dateMin) dateMin = playedAtIso;
      if (!dateMax || playedAtIso > dateMax) dateMax = playedAtIso;
    }

    normalized.push({
      id: String((row as any)?.id ?? (row as any)?.platform_game_id ?? ""),
      played_at: playedAtIso,
      speed: inferSpeedFromPgn(pgn),
      rated: inferRatedFromPgn(pgn),
      opponent_color: oppColor,
      moves_san: moves,
    });
  }

  const nowIso = new Date().toISOString();
  const idsHash = computeHash(normalized.map((g) => g.id).sort());

  const asWhite = normalized.filter((g) => g.opponent_color === "w");
  const asBlackVsE4 = normalized.filter((g) => g.opponent_color === "b" && String(g.moves_san[0] ?? "") === "e4");
  const asBlackVsD4 = normalized.filter((g) => g.opponent_color === "b" && String(g.moves_san[0] ?? "") === "d4");

  const linePly = 6;
  const entryThresholdPct = 60;
  const entryMaxPly = 10;

  const contexts = {
    as_white: buildContext({
      games: asWhite,
      linePly,
      entryThresholdPct,
      entryMaxPly,
      entryStartPly: 1,
      deviationPrefixPly: 6,
      deviationDivergeBeforePly: 10,
    }),
    as_black_vs_e4: buildContext({
      games: asBlackVsE4,
      linePly,
      entryThresholdPct,
      entryMaxPly,
      entryStartPly: 2,
      deviationPrefixPly: 6,
      deviationDivergeBeforePly: 10,
    }),
    as_black_vs_d4: buildContext({
      games: asBlackVsD4,
      linePly,
      entryThresholdPct,
      entryMaxPly,
      entryStartPly: 2,
      deviationPrefixPly: 6,
      deviationDivergeBeforePly: 10,
    }),
  };

  const profile: OpponentProfileV3 = {
    profile_version: 3,
    generated_at: nowIso,
    filters_used: { speeds: speedsFilter, rated: ratedFilter, from: params.filters.from, to: params.filters.to },
    games_analyzed: normalized.length,
    date_range_start: dateMin,
    date_range_end: dateMax,
    source_game_ids_hash: idsHash,
    contexts,
    structure_profile: computeStructureProfile(normalized),
    prep_summary: "",
  };

  profile.prep_summary = buildPrepSummary(profile);

  if (profile.games_analyzed === 0) {
    profile.message = params.platform === "chesscom" ? "No Chess.com games available yet." : "No games matched the selected filters.";
  }

  return { profile, filtersUsed: profile.filters_used };
}
