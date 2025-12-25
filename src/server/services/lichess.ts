type LichessGameJson = {
  id: string;
  createdAt?: number;
  lastMoveAt?: number;
  pgn?: string;
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
