type LichessGameJson = {
  id: string;
  createdAt?: number;
  lastMoveAt?: number;
  pgn?: string;
  analysis?: Array<{
    eval?: number;
    mate?: number;
    best?: string;
    variation?: string;
    judgment?: { name: string; comment: string };
  }>;
  players?: {
    white?: { analysis?: { acpl?: number; inaccuracy?: number; mistake?: number; blunder?: number } };
    black?: { analysis?: { acpl?: number; inaccuracy?: number; mistake?: number; blunder?: number } };
  };
};

type LichessUserPerfJson = {
  rating?: number;
  games?: number;
  prov?: boolean;
};

type LichessUserCountJson = {
  all?: number;
};

type LichessUserProfileJson = {
  id?: string;
  username?: string;
  perfs?: Record<string, LichessUserPerfJson | undefined>;
  count?: LichessUserCountJson;
};

export type LichessGameAnalysis = {
  acpl: number | null;
  inaccuracies: number | null;
  mistakes: number | null;
  blunders: number | null;
};

export type LichessEvalEntry = {
  eval: number | null;
  mate: number | null;
  judgment?: { name: string; comment: string };
};

export type LichessFetchResult = {
  games: Array<{
    platformGameId: string;
    playedAt: string | null;
    pgn: string;
    whiteAnalysis: LichessGameAnalysis | null;
    blackAnalysis: LichessGameAnalysis | null;
    evals: LichessEvalEntry[] | null;
  }>;
  oldestGameAtMs: number | null;
  newestGameAtMs: number | null;
};

export async function fetchLichessGamesBatch(params: {
  username: string;
  max: number;
  sinceMs?: number;
  untilMs?: number;
  includeEvals?: boolean;
}): Promise<LichessFetchResult> {
  const { username, max, sinceMs, untilMs, includeEvals = true } = params;

  const url = new URL(`https://lichess.org/api/games/user/${encodeURIComponent(username)}`);
  url.searchParams.set("max", String(max));
  url.searchParams.set("pgnInJson", "true");
  if (includeEvals) {
    url.searchParams.set("evals", "true");
  }

  if (sinceMs !== undefined) {
    url.searchParams.set("since", String(sinceMs));
  }

  if (untilMs !== undefined) {
    url.searchParams.set("until", String(untilMs));
  }

  const res = await fetch(url.toString(), {
    headers: {
      accept: "application/x-ndjson",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lichess API error (${res.status}): ${text || res.statusText}`);
  }

  const body = await res.text();
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let oldest: number | null = null;
  let newest: number | null = null;

  const games: LichessFetchResult["games"] = [];

  for (const line of lines) {
    let parsed: LichessGameJson;
    try {
      parsed = JSON.parse(line) as LichessGameJson;
    } catch {
      continue;
    }

    if (!parsed?.id || !parsed?.pgn) continue;

    const ts = parsed.lastMoveAt ?? parsed.createdAt ?? null;
    if (typeof ts === "number") {
      oldest = oldest === null ? ts : Math.min(oldest, ts);
      newest = newest === null ? ts : Math.max(newest, ts);
    }

    // Extract analysis data if available
    const whiteAnalysis: LichessGameAnalysis | null = parsed.players?.white?.analysis
      ? {
          acpl: parsed.players.white.analysis.acpl ?? null,
          inaccuracies: parsed.players.white.analysis.inaccuracy ?? null,
          mistakes: parsed.players.white.analysis.mistake ?? null,
          blunders: parsed.players.white.analysis.blunder ?? null,
        }
      : null;

    const blackAnalysis: LichessGameAnalysis | null = parsed.players?.black?.analysis
      ? {
          acpl: parsed.players.black.analysis.acpl ?? null,
          inaccuracies: parsed.players.black.analysis.inaccuracy ?? null,
          mistakes: parsed.players.black.analysis.mistake ?? null,
          blunders: parsed.players.black.analysis.blunder ?? null,
        }
      : null;

    // Extract per-move evals if available
    const evals: LichessEvalEntry[] | null = parsed.analysis
      ? parsed.analysis.map((a) => ({
          eval: a.eval ?? null,
          mate: a.mate ?? null,
          judgment: a.judgment,
        }))
      : null;

    games.push({
      platformGameId: parsed.id,
      playedAt: typeof ts === "number" ? new Date(ts).toISOString() : null,
      pgn: parsed.pgn,
      whiteAnalysis,
      blackAnalysis,
      evals,
    });
  }

  return {
    games,
    oldestGameAtMs: oldest,
    newestGameAtMs: newest,
  };
}

export async function countLichessGamesSince(params: {
  username: string;
  sinceMs: number;
  untilMs?: number;
  cap?: number;
}): Promise<number> {
  const { username, sinceMs, untilMs, cap = 20000 } = params;

  let total = 0;
  let cursor = untilMs;
  const batchMax = 500;

  for (;;) {
    if (total >= cap) break;

    const batch = await fetchLichessGamesBatch({
      username,
      max: batchMax,
      sinceMs,
      untilMs: cursor,
      includeEvals: false,
    });

    if (batch.games.length === 0) break;
    total += batch.games.length;

    if (batch.oldestGameAtMs == null) break;
    const nextCursor = batch.oldestGameAtMs - 1;
    if (!Number.isFinite(nextCursor) || nextCursor <= 0) break;
    if (nextCursor < sinceMs) break;
    cursor = nextCursor;
  }

  return total;
}

export type LichessRatingsSnapshot = Record<
  string,
  {
    rating: number | null;
    games: number | null;
    prov: boolean | null;
  }
>;

export async function fetchLichessUserRatingsSnapshot(params: {
  username: string;
}): Promise<LichessRatingsSnapshot> {
  const { username } = params;

  const url = new URL(`https://lichess.org/api/user/${encodeURIComponent(username)}`);

  const res = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lichess API error (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json().catch(() => null)) as LichessUserProfileJson | null;
  const perfs = json?.perfs ?? {};

  const out: LichessRatingsSnapshot = {};
  for (const [key, perf] of Object.entries(perfs)) {
    if (!perf) continue;
    out[key] = {
      rating: typeof perf.rating === "number" ? perf.rating : null,
      games: typeof perf.games === "number" ? perf.games : null,
      prov: typeof perf.prov === "boolean" ? perf.prov : null,
    };
  }

  return out;
}

export type LichessGameHeader = {
  id: string;
  createdAt: number | null;
  lastMoveAt: number | null;
  speed: string | null;
  rated: boolean;
  variant: string | null;
  status: string | null;
  white: {
    username: string | null;
    rating: number | null;
  };
  black: {
    username: string | null;
    rating: number | null;
  };
};

export type LichessGameHeadersResult = {
  games: LichessGameHeader[];
  oldestGameAtMs: number | null;
  newestGameAtMs: number | null;
};

export async function fetchLichessGameHeadersSince(params: {
  username: string;
  sinceMs: number;
  max?: number;
}): Promise<LichessGameHeadersResult> {
  const { username, sinceMs, max = 200 } = params;

  const url = new URL(`https://lichess.org/api/games/user/${encodeURIComponent(username)}`);
  url.searchParams.set("since", String(sinceMs));
  url.searchParams.set("max", String(max));
  url.searchParams.set("moves", "false");
  url.searchParams.set("pgnInJson", "true");
  url.searchParams.set("clocks", "false");
  url.searchParams.set("evals", "false");
  url.searchParams.set("opening", "false");

  // Retry logic with exponential backoff for rate limiting (429)
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s
      const delayMs = Math.pow(2, attempt) * 1000;
      console.log(`[lichess] Retrying ${username} after ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    const res = await fetch(url.toString(), {
      headers: {
        accept: "application/x-ndjson",
      },
      cache: "no-store",
    });

    if (res.status === 429) {
      console.warn(`[lichess] Rate limited (429) for ${username}, will retry...`);
      lastError = new Error(`Lichess rate limited (429)`);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Lichess API error (${res.status}): ${text || res.statusText}`);
    }
    
    // Success - parse response
    const body = await res.text();
    const lines = body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    let oldest: number | null = null;
    let newest: number | null = null;

    const games: LichessGameHeader[] = [];

    for (const line of lines) {
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (!parsed?.id) continue;

      const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : null;
      const lastMoveAt = typeof parsed.lastMoveAt === "number" ? parsed.lastMoveAt : null;
      const ts = lastMoveAt ?? createdAt;

      if (typeof ts === "number") {
        oldest = oldest === null ? ts : Math.min(oldest, ts);
        newest = newest === null ? ts : Math.max(newest, ts);
      }

      games.push({
        id: parsed.id,
        createdAt,
        lastMoveAt,
        speed: typeof parsed.speed === "string" ? parsed.speed : null,
        rated: Boolean(parsed.rated),
        variant: typeof parsed.variant === "string" ? parsed.variant : null,
        status: typeof parsed.status === "string" ? parsed.status : null,
        white: {
          username: parsed.players?.white?.user?.name ?? parsed.players?.white?.user?.id ?? null,
          rating: typeof parsed.players?.white?.rating === "number" ? parsed.players.white.rating : null,
        },
        black: {
          username: parsed.players?.black?.user?.name ?? parsed.players?.black?.user?.id ?? null,
          rating: typeof parsed.players?.black?.rating === "number" ? parsed.players.black.rating : null,
        },
      });
    }

    return {
      games,
      oldestGameAtMs: oldest,
      newestGameAtMs: newest,
    };
  }
  
  // All retries exhausted
  throw lastError ?? new Error(`Lichess API failed after ${MAX_RETRIES} retries`);
}

export async function fetchLichessUserTotalGames(params: { username: string }): Promise<number | null> {
  const { username } = params;

  const url = new URL(`https://lichess.org/api/user/${encodeURIComponent(username)}`);

  const res = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lichess API error (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json().catch(() => null)) as LichessUserProfileJson | null;
  const v = (json as any)?.count?.all;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}
