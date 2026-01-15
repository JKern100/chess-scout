import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type LichessPerf = {
  games: number;
  rating: number;
  rd: number;
  prog: number;
  prov?: boolean;
};

type LichessUser = {
  id: string;
  username: string;
  title?: string;
  patron?: boolean;
  createdAt: number;
  seenAt?: number;
  playTime?: { total: number; tv: number };
  profile?: {
    country?: string;
    location?: string;
    bio?: string;
    firstName?: string;
    lastName?: string;
    fideRating?: number;
    uscfRating?: number;
    ecfRating?: number;
    links?: string;
  };
  perfs?: Record<string, LichessPerf>;
  count?: {
    all: number;
    rated: number;
    ai: number;
    draw: number;
    drawH: number;
    loss: number;
    lossH: number;
    win: number;
    winH: number;
    bookmark: number;
    playing: number;
    import: number;
    me: number;
  };
};

type RatingHistoryEntry = [number, number, number, number]; // [year, month (0-indexed), day, rating]
type RatingHistoryPerf = {
  name: string;
  points: RatingHistoryEntry[];
};

function computeRatingDeltas(
  history: RatingHistoryPerf[],
  speedKeys: readonly string[]
): Record<string, { delta7d: number | null; delta30d: number | null; games7d: number; games30d: number }> {
  const now = new Date();
  const ms7d = 7 * 24 * 60 * 60 * 1000;
  const ms30d = 30 * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();

  const result: Record<string, { delta7d: number | null; delta30d: number | null; games7d: number; games30d: number }> = {};

  for (const perf of history) {
    const perfName = perf.name.toLowerCase();
    if (!speedKeys.includes(perfName)) continue;

    const points = perf.points;
    if (!points || points.length === 0) {
      result[perfName] = { delta7d: null, delta30d: null, games7d: 0, games30d: 0 };
      continue;
    }

    // Points are sorted oldest to newest
    const currentRating = points[points.length - 1][3];
    let rating7dAgo: number | null = null;
    let rating30dAgo: number | null = null;
    let games7d = 0;
    let games30d = 0;

    // Find ratings at 7d and 30d ago by scanning backwards
    for (let i = points.length - 1; i >= 0; i--) {
      const [year, month, day, rating] = points[i];
      const pointDate = new Date(year, month, day);
      const ageMs = nowMs - pointDate.getTime();

      if (ageMs <= ms7d) {
        games7d++;
      }
      if (ageMs <= ms30d) {
        games30d++;
      }

      // Find the first point that's >= 7 days old
      if (rating7dAgo === null && ageMs >= ms7d) {
        rating7dAgo = rating;
      }
      // Find the first point that's >= 30 days old
      if (rating30dAgo === null && ageMs >= ms30d) {
        rating30dAgo = rating;
      }

      // If we've found both, we can stop
      if (rating7dAgo !== null && rating30dAgo !== null && ageMs > ms30d) {
        break;
      }
    }

    // If no point >= 7d ago exists, use oldest point if it's within 7d
    if (rating7dAgo === null && points.length > 0) {
      const [year, month, day, rating] = points[0];
      const pointDate = new Date(year, month, day);
      const ageMs = nowMs - pointDate.getTime();
      if (ageMs < ms7d) {
        rating7dAgo = rating;
      }
    }

    // Same for 30d
    if (rating30dAgo === null && points.length > 0) {
      const [year, month, day, rating] = points[0];
      const pointDate = new Date(year, month, day);
      const ageMs = nowMs - pointDate.getTime();
      if (ageMs < ms30d) {
        rating30dAgo = rating;
      }
    }

    result[perfName] = {
      delta7d: rating7dAgo !== null ? currentRating - rating7dAgo : null,
      delta30d: rating30dAgo !== null ? currentRating - rating30dAgo : null,
      games7d,
      games30d,
    };
  }

  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    
    if (!username || typeof username !== "string") {
      return NextResponse.json({ error: "Username is required" }, { status: 400 });
    }

    const res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(username)}`, {
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 300 }, // Cache for 5 minutes
    });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json({ error: "Failed to fetch user data" }, { status: res.status });
    }

    const data: LichessUser = await res.json();

    // Find primary speed (highest game count)
    const perfs = data.perfs ?? {};
    const speedKeys = ["bullet", "blitz", "rapid", "classical", "correspondence"] as const;
    let primarySpeed: string | null = null;
    let maxGames = 0;
    
    for (const speed of speedKeys) {
      const perf = perfs[speed];
      if (perf && perf.games > maxGames) {
        maxGames = perf.games;
        primarySpeed = speed;
      }
    }

    const primaryPerf = primarySpeed ? perfs[primarySpeed] : null;

    // Calculate W/D/L from count
    const count = data.count;
    const totalGames = count?.all ?? 0;
    const wins = count?.win ?? 0;
    const draws = count?.draw ?? 0;
    const losses = count?.loss ?? 0;

    // Fetch rating history for deltas (7d/30d changes and game counts)
    let ratingHistory: Record<string, { delta7d: number | null; delta30d: number | null; games7d: number; games30d: number }> = {};
    try {
      const historyRes = await fetch(
        `https://lichess.org/api/user/${encodeURIComponent(username)}/rating-history`,
        {
          headers: { Accept: "application/json" },
          next: { revalidate: 300 },
        }
      );
      if (historyRes.ok) {
        const historyData: RatingHistoryPerf[] = await historyRes.json();
        ratingHistory = computeRatingDeltas(historyData, speedKeys);
      }
    } catch {
      // Rating history fetch failed, continue without it
    }

    // Format response
    const response = {
      id: data.id,
      username: data.username,
      title: data.title ?? null,
      patron: data.patron ?? false,
      country: data.profile?.country ?? null,
      createdAt: data.createdAt,
      seenAt: data.seenAt ?? null,
      totalGames,
      wins,
      draws,
      losses,
      primarySpeed,
      primaryRating: primaryPerf?.rating ?? null,
      primaryRd: primaryPerf?.rd ?? null,
      primaryGames: primaryPerf?.games ?? null,
      perfs: Object.fromEntries(
        Object.entries(perfs)
          .filter(([key]) => speedKeys.includes(key as any))
          .map(([key, val]) => [key, { rating: val.rating, games: val.games, rd: val.rd }])
      ),
      ratingHistory,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Lichess user API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
