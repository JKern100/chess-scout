import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildOpponentProfile, type ChessPlatform, type LichessSpeed } from "@/server/opponentProfile";

type Params = {
  platform: string;
  username: string;
};

export async function POST(request: Request, context: { params: Promise<Params> }) {
  const resolvedParams = await context.params;
  const platform = resolvedParams.platform as ChessPlatform;
  const username = String(resolvedParams.username ?? "").trim();

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  if (!platform || !["lichess", "chesscom"].includes(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const speedsRaw = Array.isArray(body?.speeds) ? (body.speeds as any[]) : [];
  const speeds = speedsRaw
    .map((s) => String(s))
    .filter((s) => ["bullet", "blitz", "rapid", "classical", "correspondence"].includes(s)) as LichessSpeed[];

  const ratedRaw = String(body?.rated ?? "any");
  const rated = ratedRaw === "rated" ? "rated" : ratedRaw === "casual" ? "casual" : "any";

  const from = typeof body?.from === "string" ? String(body.from) : null;
  const to = typeof body?.to === "string" ? String(body.to) : null;

  const { profile, filtersUsed } = await buildOpponentProfile({
    supabase,
    profileId: user.id,
    platform,
    username,
    filters: { speeds, rated, from, to },
  });

  const { data: saved, error } = await supabase
    .from("opponent_profiles")
    .upsert(
      {
        profile_id: user.id,
        platform,
        username,
        filters_json: filtersUsed,
        stats_json: profile,
        games_analyzed: profile.games_analyzed,
        generated_at: profile.generated_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,platform,username" }
    )
    .select("id, profile_id, platform, username, ratings, fetched_at, filters_json, stats_json, games_analyzed, generated_at, created_at, updated_at")
    .single();

  if (error) {
    const msg = String(error.message || "");
    const missingColumn =
      msg.includes("filters_json") || msg.includes("stats_json") || msg.includes("games_analyzed") || msg.includes("generated_at");
    if (missingColumn) {
      return NextResponse.json(
        {
          error: "Opponent profile schema is missing v1 columns. Run scripts/supabase_opponent_profiles.sql in Supabase SQL editor.",
          needs_migration: true,
          details: error.message,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ opponent_profile: saved });
}
