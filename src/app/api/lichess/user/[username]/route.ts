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
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Lichess user API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
