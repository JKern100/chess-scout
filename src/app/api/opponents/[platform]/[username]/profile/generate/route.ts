import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildOpponentProfile, type ChessPlatform, type LichessSpeed } from "@/server/opponentProfile";
import { buildOpponentProfileV2 } from "@/server/opponentProfileV2";
import { buildOpponentProfileV3Addon } from "@/server/opponentProfileV3";
import { calculateAndStoreMarkers } from "@/server/styleMarkerService";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = {
  platform: string;
  username: string;
};

export async function POST(request: Request, context: { params: Promise<Params> }) {
  const resolvedParams = await context.params;
  const platform = resolvedParams.platform as ChessPlatform;
  const username = String(resolvedParams.username ?? "").trim();
  const usernameKey = username.toLowerCase();

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

  try {
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

    const enableStyleMarkers = Boolean(body?.enable_style_markers);

    const from = typeof body?.from === "string" ? String(body.from) : null;
    const to = typeof body?.to === "string" ? String(body.to) : null;

    const isVercel = Boolean(process.env.VERCEL);
    let maxGamesCap: number | null = null;
    let spanDays: number | null = null;
    if (isVercel) {
      try {
        const fromMs = from ? new Date(from).getTime() : null;
        const toMs = to ? new Date(to).getTime() : Date.now();
        if (fromMs && Number.isFinite(fromMs) && Number.isFinite(toMs)) {
          spanDays = Math.abs(toMs - fromMs) / (1000 * 60 * 60 * 24);
          // Vercel serverless needs aggressive caps for large ranges.
          if (spanDays >= 365) maxGamesCap = 1500;
          else if (spanDays >= 180) maxGamesCap = 2500;
          else if (spanDays >= 90) maxGamesCap = 4000;
        }
      } catch {
        maxGamesCap = null;
      }
    }

    const preferEvents = Boolean(isVercel && spanDays != null && spanDays >= 90);

    const [{ profile: profileV2, normalized, filtersUsed }, statsV1Result] = await Promise.all([
      buildOpponentProfileV2({
        supabase,
        profileId: user.id,
        platform,
        username,
        filters: { speeds, rated, from, to },
        includeNormalized: true,
        maxGamesCap,
        preferEvents,
      }),
      (async () => {
        try {
          return await buildOpponentProfile({
            supabase,
            profileId: user.id,
            platform,
            username,
            filters: { speeds, rated, from, to },
            maxGamesCap,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const canSkip =
            msg.includes("relation") ||
            msg.includes("games") ||
            msg.includes("does not exist") ||
            msg.includes("column") ||
            msg.includes("pgn");
          if (!canSkip) throw e;
          return { profile: null, filtersUsed: { speeds, rated, from, to } } as any;
        }
      })(),
    ]);

    const statsV1 = (statsV1Result as any)?.profile ?? null;

    const v3 = buildOpponentProfileV3Addon({ platform, normalized: normalized ?? [] });
    const profile: any = { ...profileV2, profile_version: 2, v3 };

    if (enableStyleMarkers && Array.isArray(normalized) && normalized.length > 0) {
      try {
        await calculateAndStoreMarkers({
          supabase,
          profileId: user.id,
          platform,
          username,
          games: normalized,
          sourceType: "PROFILE",
        });
      } catch (e) {
        console.error("Style markers (PROFILE) failed", {
          platform,
          username,
          error: e instanceof Error ? e.message : e,
        });
      }
    }

    let debugCounts: any = null;

    if (Number(profile?.games_analyzed ?? 0) === 0) {
      const debug: any = { platform, username, speeds, rated, from, to };

    try {
      const { count, error } = await supabase
        .from("opponent_move_events")
        .select("platform_game_id", { count: "exact", head: true })
        .eq("profile_id", user.id)
        .eq("platform", platform)
        .ilike("username", usernameKey)
        .eq("ply", 1);
      debug.events_ply1_count = error ? null : typeof count === "number" ? count : 0;
    } catch {
      debug.events_ply1_count = null;
    }

    try {
      const { count, error } = await supabase
        .from("games")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", user.id)
        .eq("platform", platform)
        .ilike("username", usernameKey);
      debug.games_table_count = error ? null : typeof count === "number" ? count : 0;
    } catch {
      debug.games_table_count = null;
    }

      profile.debug_counts = debug;
      debugCounts = debug;
    }

    const { data: saved, error } = await supabase
      .from("opponent_profiles")
      .upsert(
        {
          profile_id: user.id,
          platform,
          username,
          filters_json: filtersUsed,
          profile_version: 3,
          profile_json: profile,
          stats_json: statsV1,
          games_analyzed: profile.games_analyzed,
          generated_at: profile.generated_at,
          date_range_start: profile.date_range_start,
          date_range_end: profile.date_range_end,
          source_game_ids_hash: profile.source_game_ids_hash,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "profile_id,platform,username" }
      )
      .select(
        "id, profile_id, platform, username, ratings, fetched_at, filters_json, profile_version, profile_json, stats_json, games_analyzed, generated_at, date_range_start, date_range_end, source_game_ids_hash, created_at, updated_at"
      )
      .single();

    if (error) {
      const msg = String(error.message || "");
      const missingColumn =
        msg.includes("filters_json") ||
        msg.includes("profile_version") ||
        msg.includes("profile_json") ||
        msg.includes("games_analyzed") ||
        msg.includes("generated_at") ||
        msg.includes("date_range_start") ||
        msg.includes("date_range_end") ||
        msg.includes("source_game_ids_hash");
      if (missingColumn) {
        return NextResponse.json(
          {
            error: "Opponent profile schema is missing v2 columns. Run scripts/supabase_opponent_profiles.sql in Supabase SQL editor.",
            needs_migration: true,
            details: error.message,
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ opponent_profile: saved, debug_counts: debugCounts });
  } catch (e) {
    console.error("Opponent profile generation failed", {
      platform,
      username,
      error: e instanceof Error ? e.message : e,
      stack: e instanceof Error ? e.stack : undefined,
    });

    const msg = e instanceof Error ? e.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
