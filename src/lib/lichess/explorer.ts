export type LichessExplorerMove = {
  san: string;
  uci: string;
  white: number;
  draws: number;
  black: number;
  total: number;
};

export type ExplorerSource = "lichess" | "masters";

type LichessExplorerJson = {
  moves?: Array<{
    san?: string;
    uci?: string;
    white?: number;
    draws?: number;
    black?: number;
  }>;
};

export async function fetchLichessStats(
  fen: string,
  variant: string = "standard",
  source: ExplorerSource = "lichess"
): Promise<LichessExplorerMove[]> {
  const baseUrl = source === "masters"
    ? "https://explorer.lichess.ovh/masters"
    : "https://explorer.lichess.ovh/lichess";
  
  const url = new URL(baseUrl);
  url.searchParams.set("fen", fen);
  
  if (source === "lichess") {
    url.searchParams.set("variant", variant);
    url.searchParams.set("speeds", "blitz,rapid,classical");
    url.searchParams.set("ratings", "1600,1800,2000,2200,2500");
  }

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lichess Explorer error (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json().catch(() => null)) as LichessExplorerJson | null;
  const moves = Array.isArray(json?.moves) ? json.moves : [];

  const normalized: LichessExplorerMove[] = moves
    .map((m) => {
      const white = Number(m?.white ?? 0);
      const draws = Number(m?.draws ?? 0);
      const black = Number(m?.black ?? 0);
      const san = typeof m?.san === "string" ? m.san : "";
      const total = white + draws + black;

      const uci = typeof m?.uci === "string" ? m.uci : "";

      return {
        san,
        uci,
        white: Number.isFinite(white) ? white : 0,
        draws: Number.isFinite(draws) ? draws : 0,
        black: Number.isFinite(black) ? black : 0,
        total: Number.isFinite(total) ? total : 0,
      };
    })
    .filter((m) => Boolean(m.san) && m.total > 0)
    .sort((a, b) => b.total - a.total);

  return normalized;
}
