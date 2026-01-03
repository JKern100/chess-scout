import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/lichess/status?usernames=user1,user2,user3
 *
 * Fetches online status and current ratings for a batch of Lichess users.
 * Uses Lichess API: GET https://lichess.org/api/users/status?ids={csv_usernames}
 *
 * Returns:
 * {
 *   users: [
 *     {
 *       id: string,
 *       name: string,
 *       online: boolean,
 *       playing: boolean,
 *       ratings: { bullet?: number, blitz?: number, rapid?: number, classical?: number }
 *     },
 *     ...
 *   ]
 * }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const usernamesParam = searchParams.get("usernames") ?? "";

  const usernames = usernamesParam
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter((u) => u.length > 0);

  if (usernames.length === 0) {
    return NextResponse.json({ users: [] });
  }

  // Lichess API allows up to 100 users per request
  const batchSize = 100;
  const allUsers: Array<{
    id: string;
    name: string;
    online: boolean;
    playing: boolean;
    ratings: Record<string, number>;
  }> = [];

  for (let i = 0; i < usernames.length; i += batchSize) {
    const batch = usernames.slice(i, i + batchSize);
    const ids = batch.join(",");

    try {
      // Fetch status (online/playing)
      const statusRes = await fetch(
        `https://lichess.org/api/users/status?ids=${encodeURIComponent(ids)}&withGameIds=false`,
        {
          headers: {
            Accept: "application/json",
          },
          next: { revalidate: 30 }, // Cache for 30 seconds
        }
      );

      if (!statusRes.ok) {
        console.error(`Lichess status API error: ${statusRes.status}`);
        continue;
      }

      const statusData = (await statusRes.json()) as Array<{
        id: string;
        name: string;
        online?: boolean;
        playing?: boolean;
      }>;

      // Fetch full user data for ratings (POST to /api/users)
      const usersRes = await fetch("https://lichess.org/api/users", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "text/plain",
        },
        body: batch.join(","),
        next: { revalidate: 60 }, // Cache for 60 seconds
      });

      let ratingsMap: Map<string, Record<string, number>> = new Map();

      if (usersRes.ok) {
        const usersData = (await usersRes.json()) as Array<{
          id: string;
          username: string;
          perfs?: Record<
            string,
            {
              games?: number;
              rating?: number;
              rd?: number;
              prog?: number;
              prov?: boolean;
            }
          >;
        }>;

        for (const user of usersData) {
          const ratings: Record<string, number> = {};
          if (user.perfs) {
            for (const [key, perf] of Object.entries(user.perfs)) {
              if (typeof perf.rating === "number") {
                ratings[key] = perf.rating;
              }
            }
          }
          ratingsMap.set(user.id.toLowerCase(), ratings);
        }
      }

      // Merge status and ratings
      for (const s of statusData) {
        const id = s.id.toLowerCase();
        allUsers.push({
          id: s.id,
          name: s.name,
          online: Boolean(s.online),
          playing: Boolean(s.playing),
          ratings: ratingsMap.get(id) ?? {},
        });
      }
    } catch (err) {
      console.error("Lichess status fetch error:", err);
    }
  }

  return NextResponse.json({ users: allUsers });
}
