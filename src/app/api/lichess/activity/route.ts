import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/lichess/activity?username=user1
 *
 * Fetches the number of games played in the last 7 days for a Lichess user.
 * Uses Lichess API: GET https://lichess.org/api/games/user/{username}?since={7d_timestamp}&max=150
 *
 * Returns:
 * {
 *   username: string,
 *   gamesLast7Days: number,
 *   activityLevel: "inactive" | "active" | "very_active"
 * }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const username = (searchParams.get("username") ?? "").trim().toLowerCase();

  if (!username) {
    return NextResponse.json(
      { error: "username parameter is required" },
      { status: 400 }
    );
  }

  try {
    // Calculate 7 days ago in milliseconds
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Fetch games with minimal payload (no clocks, no opening)
    const res = await fetch(
      `https://lichess.org/api/games/user/${encodeURIComponent(username)}?since=${sevenDaysAgo}&max=150&clocks=false&opening=false&moves=false&tags=false&evals=false`,
      {
        headers: {
          Accept: "application/x-ndjson",
        },
        next: { revalidate: 300 }, // Cache for 5 minutes
      }
    );

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({
          username,
          gamesLast7Days: 0,
          activityLevel: "inactive" as const,
        });
      }
      console.error(`Lichess activity API error: ${res.status}`);
      return NextResponse.json({
        username,
        gamesLast7Days: 0,
        activityLevel: "inactive" as const,
      });
    }

    // Count lines in NDJSON response (each line = 1 game)
    const text = await res.text();
    const lines = text.trim().split("\n").filter((line) => line.length > 0);
    const gamesLast7Days = lines.length;

    // Determine activity level
    let activityLevel: "inactive" | "active" | "very_active";
    if (gamesLast7Days === 0) {
      activityLevel = "inactive";
    } else if (gamesLast7Days < 20) {
      activityLevel = "active";
    } else {
      activityLevel = "very_active";
    }

    return NextResponse.json({
      username,
      gamesLast7Days,
      activityLevel,
    });
  } catch (err) {
    console.error("Lichess activity fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch activity" },
      { status: 500 }
    );
  }
}
