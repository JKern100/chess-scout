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
};

type OpeningCategory = "Open" | "Semi-Open" | "Closed" | "Indian" | "Flank";

type BenchRow = {
  category: string;
  avg_castle_move: number | null;
  queen_trade_m20_rate: number | null;
  aggression_m15_avg: number | null;
};

function normalizeMove(m: unknown) {
  return String(m ?? "").trim();
}

function diffStrength(diffRatio: number): StyleMarkerStrength | null {
  const abs = Math.abs(diffRatio);
  if (abs > 0.4) return "Strong";
  if (abs > 0.2) return "Medium";
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

  for (const g of games) {
    const moves = Array.isArray(g.moves_san) ? g.moves_san : [];
    const oppColor = g.opponent_color === "w" || g.opponent_color === "b" ? g.opponent_color : null;
    if (moves.length === 0 || !oppColor) continue;

    const chess = new Chess();
    try {
      for (const mv of moves) {
        if (!mv) break;
        chess.move(mv, { sloppy: true } as any);
      }
    } catch {
      continue;
    }

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
  }

  const queenTradeRate = queenTradeTotal > 0 ? queenTradeTraded / queenTradeTotal : 0;
  const avgCastlePly = castleCount > 0 ? castlePlySum / castleCount : null;
  const aggressionAvg = aggressionCount > 0 ? aggressionSum / aggressionCount : 0;

  return {
    queenTradeRate,
    avgCastlePly,
    aggressionAvg,
    counts: {
      queen_trade_total: queenTradeTotal,
      queen_trade_traded: queenTradeTraded,
      castle_count: castleCount,
      aggression_count: aggressionCount,
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
}) {
  const usernameKey = params.username.trim().toLowerCase();
  const games = Array.isArray(params.games) ? params.games : [];

  const category = computeOpeningCategory(games);

  const { data: benchData, error: benchError } = await params.supabase
    .from("scout_benchmarks")
    .select("category, avg_castle_move, queen_trade_m20_rate, aggression_m15_avg")
    .eq("category", category)
    .maybeSingle();

  if (benchError) throw benchError;

  const bench = (benchData ?? null) as BenchRow | null;

  const metrics = computeMetrics(games);

  const markers: StyleMarkerRow[] = [];

  if (bench) {
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
            metrics_json: { category, queen_trade_rate: metrics.queenTradeRate, benchmark: base, diff_ratio: diffRatio },
          });
        } else {
          markers.push({
            marker_key: "complication",
            label: "Complication Seeker",
            strength,
            tooltip: "Avoids early queen trades to keep tension",
            metrics_json: { category, queen_trade_rate: metrics.queenTradeRate, benchmark: base, diff_ratio: diffRatio },
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
            metrics_json: { category, avg_castle_ply: metrics.avgCastlePly, benchmark_ply: base, diff_ratio: diffRatio },
          });
        } else {
          markers.push({
            marker_key: "flexible_king",
            label: "Flexible King",
            strength,
            tooltip: "Delays castling to develop pieces first",
            metrics_json: { category, avg_castle_ply: metrics.avgCastlePly, benchmark_ply: base, diff_ratio: diffRatio },
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
            metrics_json: { category, aggression_m15_avg: metrics.aggressionAvg, benchmark: base, diff_ratio: diffRatio },
          });
        } else {
          markers.push({
            marker_key: "positional",
            label: "Positional",
            strength,
            tooltip: "Prefers quiet, maneuvering builds",
            metrics_json: { category, aggression_m15_avg: metrics.aggressionAvg, benchmark: base, diff_ratio: diffRatio },
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

  if (markers.length === 0) {
    markers.push({
      marker_key: "balanced",
      label: "Balanced",
      strength: "Light",
      tooltip: "No major style deviations detected for this sample",
      metrics_json: {
        category,
        queen_trade_rate: pct(metrics.queenTradeRate),
        avg_castle_ply: metrics.avgCastlePly,
        aggression_m15_avg: metrics.aggressionAvg,
        counts: metrics.counts,
        benchmark: bench,
      },
    });
  }

  const rows = markers.map((m) => ({
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
      counts: metrics.counts,
    },
    benchmark: bench,
  };
}
