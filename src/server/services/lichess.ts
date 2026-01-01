type LichessGameJson = {
  id: string;
  createdAt?: number;
  lastMoveAt?: number;
  pgn?: string;
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

export type LichessFetchResult = {
  games: Array<{
    platformGameId: string;
    playedAt: string | null;
    pgn: string;
  }>;
  oldestGameAtMs: number | null;
  newestGameAtMs: number | null;
};

export async function fetchLichessGamesBatch(params: {
  username: string;
  max: number;
  untilMs?: number;
}): Promise<LichessFetchResult> {
  const { username, max, untilMs } = params;

  const url = new URL(`https://lichess.org/api/games/user/${encodeURIComponent(username)}`);
  url.searchParams.set("max", String(max));
  url.searchParams.set("pgnInJson", "true");

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

    games.push({
      platformGameId: parsed.id,
      playedAt: typeof ts === "number" ? new Date(ts).toISOString() : null,
      pgn: parsed.pgn,
    });
  }

  return {
    games,
    oldestGameAtMs: oldest,
    newestGameAtMs: newest,
  };
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
