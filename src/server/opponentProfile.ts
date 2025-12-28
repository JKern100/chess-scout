import { Chess } from "chess.js";

export type ChessPlatform = "lichess" | "chesscom";
export type LichessSpeed = "bullet" | "blitz" | "rapid" | "classical" | "correspondence";

export type OpponentProfileFilters = {
  speeds: LichessSpeed[];
  rated: "any" | "rated" | "casual";
  from: string | null;
  to: string | null;
};

export type OpeningSnapshot = {
  top: Array<{ move: string; count: number; pct: number }>;
  total: number;
  concentration_pct: number;
};

export type OpponentProfileV1 = {
  generated_at: string;
  games_analyzed: number;
  dataset: {
    date_min: string | null;
    date_max: string | null;
    time_controls: Record<LichessSpeed, number>;
    colors: { white: number; black: number };
  };
  openings: {
    as_white_first_move: OpeningSnapshot;
    as_black_vs_e4: OpeningSnapshot;
    as_black_vs_d4: OpeningSnapshot;
  };
  tendencies: {
    castling: {
      kingside: number;
      queenside: number;
      none: number;
      avg_castle_move: number | null;
    };
    early_queen_trade_by_20: {
      traded: number;
      not_traded: number;
      pct: number;
    };
  };
  results: {
    win: number;
    loss: number;
    draw: number;
    by_speed?: Partial<Record<LichessSpeed, { win: number; loss: number; draw: number; total: number }>>;
  };
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

function parseDateRangeIso(params: { from: string | null; to: string | null }): { fromIso: string | null; toIso: string | null } {
  const fromRaw = params.from?.trim() ? params.from.trim() : null;
  const toRaw = params.to?.trim() ? params.to.trim() : null;

  const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

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

function addCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function snapshotFromCounts(counts: Map<string, number>, topN = 6): OpeningSnapshot {
  const total = Array.from(counts.values()).reduce((s, n) => s + n, 0);
  const sorted = Array.from(counts.entries())
    .map(([move, count]) => ({ move, count }))
    .sort((a, b) => b.count - a.count);

  const top = sorted.slice(0, topN).map((x) => ({
    move: x.move,
    count: x.count,
    pct: total > 0 ? (x.count / total) * 100 : 0,
  }));

  const concentration_pct = top.length ? top[0].pct : 0;
  return { top, total, concentration_pct };
}

function hasQueens(chess: Chess) {
  const board = chess.board();
  let hasW = false;
  let hasB = false;
  for (const row of board) {
    for (const p of row) {
      if (!p) continue;
      if (p.type === "q" && p.color === "w") hasW = true;
      if (p.type === "q" && p.color === "b") hasB = true;
    }
  }
  return { hasW, hasB };
}

function moveNumberForPly(ply: number, mover: "w" | "b") {
  return mover === "w" ? Math.floor((ply + 1) / 2) : Math.floor(ply / 2);
}

export async function buildOpponentProfile(params: {
  supabase: any;
  profileId: string;
  platform: ChessPlatform;
  username: string;
  filters: OpponentProfileFilters;
  maxGamesCap?: number | null;
}): Promise<{ profile: OpponentProfileV1; filtersUsed: OpponentProfileFilters }>
{
  const { fromIso, toIso } = parseDateRangeIso({ from: params.filters.from, to: params.filters.to });

  const speedsFilter = (params.filters.speeds ?? []) as LichessSpeed[];
  const ratedFilter = (params.filters.rated ?? "any") as "any" | "rated" | "casual";

  const batchSize = 500;
  let offset = 0;
  let fetchedTotal = 0;

  const maxGamesCap = params.maxGamesCap == null ? null : Number(params.maxGamesCap);

  const rows: Array<{ pgn: string; played_at: string | null }> = [];

  for (;;) {
    if (maxGamesCap != null && fetchedTotal >= maxGamesCap) break;
    const remaining = maxGamesCap == null ? batchSize : Math.min(batchSize, maxGamesCap - fetchedTotal);
    if (remaining <= 0) break;

    let query = params.supabase
      .from("games")
      .select("pgn, played_at")
      .eq("profile_id", params.profileId)
      .eq("platform", params.platform)
      .eq("username", params.username)
      .order("played_at", { ascending: false });

    if (fromIso) query = query.gte("played_at", fromIso);
    if (toIso) query = query.lte("played_at", toIso);

    const { data, error } = await query.range(offset, offset + remaining - 1);
    if (error) throw error;
    const batch = (data ?? []) as Array<{ pgn: string; played_at: string | null }>;
    if (batch.length === 0) break;

    rows.push(...batch);
    fetchedTotal += batch.length;
    offset += batch.length;

    if (batch.length < remaining) break;
  }

  const nowIso = new Date().toISOString();

  const timeControls: Record<LichessSpeed, number> = {
    bullet: 0,
    blitz: 0,
    rapid: 0,
    classical: 0,
    correspondence: 0,
  };

  let asWhite = 0;
  let asBlack = 0;

  let win = 0;
  let loss = 0;
  let draw = 0;

  const bySpeed: Partial<Record<LichessSpeed, { win: number; loss: number; draw: number; total: number }>> = {};

  const whiteFirstMoveCounts = new Map<string, number>();
  const blackReplyE4Counts = new Map<string, number>();
  const blackReplyD4Counts = new Map<string, number>();

  let castlesK = 0;
  let castlesQ = 0;
  let castlesNone = 0;
  let castleMoveSum = 0;
  let castleMoveCount = 0;

  const queenTradePlyLimit = 40;
  let queenTradedBy20 = 0;
  let queenNotTradedBy20 = 0;

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

    const playedAt = row.played_at ? new Date(row.played_at).toISOString() : null;
    if (playedAt) {
      if (!dateMin || playedAt < dateMin) dateMin = playedAt;
      if (!dateMax || playedAt > dateMax) dateMax = playedAt;
    }

    const speed = inferSpeedFromPgn(pgn);
    if (speed) timeControls[speed] += 1;

    const result = inferResultFromPgn(pgn);
    if (result === "1/2-1/2") draw += 1;
    else if (result === "1-0") {
      if (oppColor === "w") win += 1;
      else loss += 1;
    } else if (result === "0-1") {
      if (oppColor === "b") win += 1;
      else loss += 1;
    }

    if (speed) {
      const bucket = bySpeed[speed] ?? { win: 0, loss: 0, draw: 0, total: 0 };
      bucket.total += 1;
      if (result === "1/2-1/2") bucket.draw += 1;
      else if (result === "1-0") {
        if (oppColor === "w") bucket.win += 1;
        else bucket.loss += 1;
      } else if (result === "0-1") {
        if (oppColor === "b") bucket.win += 1;
        else bucket.loss += 1;
      }
      bySpeed[speed] = bucket;
    }

    if (oppColor === "w") asWhite += 1;
    else asBlack += 1;

    const chess = new Chess();
    try {
      chess.loadPgn(pgn, { strict: false });
    } catch {
      continue;
    }

    const verbose = chess.history({ verbose: true }) as any[];
    if (verbose.length > 0) {
      const firstWhite = verbose[0];
      const firstWhiteSan = String(firstWhite?.san ?? "").trim();
      if (oppColor === "w" && firstWhiteSan) {
        addCount(whiteFirstMoveCounts, firstWhiteSan);
      }

      if (oppColor === "b" && verbose.length > 1) {
        const w1 = String(firstWhiteSan);
        const b1 = String(verbose[1]?.san ?? "").trim();
        if (b1) {
          if (w1 === "e4") addCount(blackReplyE4Counts, b1);
          if (w1 === "d4") addCount(blackReplyD4Counts, b1);
        }
      }
    }

    let castleType: "K" | "Q" | null = null;
    let castleMoveNum: number | null = null;

    const replay = new Chess();
    let queenTradeFound = false;

    for (let i = 0; i < verbose.length; i += 1) {
      const mv = verbose[i];
      const ply = i + 1;

      let played: any = null;
      try {
        played = replay.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      } catch {
        break;
      }
      if (!played) break;

      const mover = (mv?.color as "w" | "b" | undefined) ?? null;
      const san = String(mv?.san ?? "");

      if (castleType == null && mover === oppColor) {
        if (san === "O-O" || san === "0-0") {
          castleType = "K";
          castleMoveNum = moveNumberForPly(ply, mover);
        } else if (san === "O-O-O" || san === "0-0-0") {
          castleType = "Q";
          castleMoveNum = moveNumberForPly(ply, mover);
        }
      }

      if (!queenTradeFound && ply <= queenTradePlyLimit) {
        const { hasW, hasB } = hasQueens(replay);
        if (!hasW && !hasB) {
          queenTradeFound = true;
        }
      }
    }

    if (castleType === "K") castlesK += 1;
    else if (castleType === "Q") castlesQ += 1;
    else castlesNone += 1;

    if (castleMoveNum != null) {
      castleMoveSum += castleMoveNum;
      castleMoveCount += 1;
    }

    if (queenTradeFound) queenTradedBy20 += 1;
    else queenNotTradedBy20 += 1;
  }

  const gamesAnalyzed = win + loss + draw;

  const profile: OpponentProfileV1 = {
    generated_at: nowIso,
    games_analyzed: gamesAnalyzed,
    dataset: {
      date_min: dateMin,
      date_max: dateMax,
      time_controls: timeControls,
      colors: { white: asWhite, black: asBlack },
    },
    openings: {
      as_white_first_move: snapshotFromCounts(whiteFirstMoveCounts),
      as_black_vs_e4: snapshotFromCounts(blackReplyE4Counts),
      as_black_vs_d4: snapshotFromCounts(blackReplyD4Counts),
    },
    tendencies: {
      castling: {
        kingside: castlesK,
        queenside: castlesQ,
        none: castlesNone,
        avg_castle_move: castleMoveCount > 0 ? Math.round((castleMoveSum / castleMoveCount) * 10) / 10 : null,
      },
      early_queen_trade_by_20: {
        traded: queenTradedBy20,
        not_traded: queenNotTradedBy20,
        pct: gamesAnalyzed > 0 ? (queenTradedBy20 / gamesAnalyzed) * 100 : 0,
      },
    },
    results: {
      win,
      loss,
      draw,
      by_speed: Object.fromEntries(
        Object.entries(bySpeed).filter(([, v]) => (v?.total ?? 0) >= 8)
      ) as any,
    },
  };

  if (gamesAnalyzed === 0) {
    profile.message = params.platform === "chesscom" ? "No Chess.com games available yet." : "No games matched the selected filters.";
  }

  return { profile, filtersUsed: { speeds: speedsFilter, rated: ratedFilter, from: params.filters.from, to: params.filters.to } };
}
