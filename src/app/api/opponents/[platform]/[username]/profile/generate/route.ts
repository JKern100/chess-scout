import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildOpponentProfile, type ChessPlatform, type LichessSpeed } from "@/server/opponentProfile";
import { buildOpponentProfileV2 } from "@/server/opponentProfileV2";
import { buildOpponentProfileV3Addon } from "@/server/opponentProfileV3";
import { calculateAndStoreMarkers } from "@/server/styleMarkerService";
import { generateNarrativeWithRetry, type SubjectType } from "@/server/geminiNarrativeService";

async function fetchLichessRatings(username: string): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(username)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const perfs = data?.perfs;
    if (!perfs || typeof perfs !== "object") return null;
    const ratings: Record<string, number> = {};
    for (const [key, perf] of Object.entries(perfs)) {
      const p = perf as { rating?: number };
      if (typeof p?.rating === "number") {
        ratings[key] = p.rating;
      }
    }
    return Object.keys(ratings).length > 0 ? ratings : null;
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = {
  platform: string;
  username: string;
};

export async function POST(request: Request, context: { params: Promise<Params> }) {
  console.log("[PROFILE GENERATE] START - ", new Date().toISOString());
  const resolvedParams = await context.params;
  const platform = resolvedParams.platform as ChessPlatform;
  const username = String(resolvedParams.username ?? "").trim();
  const usernameKey = username.toLowerCase();
  console.log("[PROFILE GENERATE] Processing:", { platform, username });

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
    const enableAiNarrative = Boolean(body?.enable_ai_narrative ?? true); // Default to true
    const subjectType: SubjectType = body?.subject_type === "self" ? "self" : "opponent";

    const from = typeof body?.from === "string" ? String(body.from) : null;
    const to = typeof body?.to === "string" ? String(body.to) : null;

    // Fixed cap of 5000 games for all date ranges (consistent with Session route)
    const maxGamesCap = 5000;

    const [{ profile: profileV2, normalized, filtersUsed }, statsV1Result, currentRatings] = await Promise.all([
      buildOpponentProfileV2({
        supabase,
        profileId: user.id,
        platform,
        username,
        filters: { speeds, rated, from, to },
        includeNormalized: true,
        maxGamesCap,
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
      platform === "lichess" ? fetchLichessRatings(username) : Promise.resolve(null),
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

    const selectFields =
      "id, profile_id, platform, username, ratings, fetched_at, filters_json, profile_version, profile_json, stats_json, games_analyzed, generated_at, date_range_start, date_range_end, source_game_ids_hash, ai_quick_summary, ai_comprehensive_report, ai_narrative_generated_at, ai_subject_type, ai_model_used, created_at, updated_at";

    const { data: saved, error } = await supabase
      .from("opponent_profiles")
      .upsert(
        {
          profile_id: user.id,
          platform,
          username,
          ratings: currentRatings,
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
      .select(selectFields)
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

    // Generate AI narrative if enabled and we have games
    let aiNarrative: { quick_summary: string; comprehensive_report: string } | null = null;
    let aiDebug: any = null;
    let responseProfile: any = saved;
    let aiError: string | null = null;
    
    console.log("[ProfileGenerate] enableAiNarrative:", enableAiNarrative);
    console.log("[ProfileGenerate] saved row ai_quick_summary exists:", !!saved?.ai_quick_summary);
    console.log("[ProfileGenerate] saved row ai_narrative_generated_at:", saved?.ai_narrative_generated_at);
    
    // Always try to generate AI narrative
    if (enableAiNarrative) {
      console.log("[ProfileGenerate] Starting AI narrative generation...");
      try {
        // Fetch stored style markers for the narrative
        const { data: markers } = await supabase
          .from("opponent_style_markers")
          .select("marker_key, label, strength, tooltip, metrics_json")
          .eq("profile_id", user.id)
          .eq("platform", platform)
          .ilike("username", usernameKey)
          .eq("source_type", "PROFILE");

        console.log("[ProfileGenerate] Fetched", markers?.length ?? 0, "style markers");
        console.log("[ProfileGenerate] Calling generateNarrativeWithRetry...");

        const narrative = await generateNarrativeWithRetry({
          profileJson: profile,
          styleMarkers: markers ?? [],
          subjectType,
          username,
          platform,
        });

        console.log("[ProfileGenerate] Narrative generated, quick_summary length:", narrative.quick_summary.length);
        console.log("[ProfileGenerate] Narrative generated_at:", narrative.generated_at);

        aiNarrative = {
          quick_summary: narrative.quick_summary,
          comprehensive_report: narrative.comprehensive_report,
        };

        aiDebug = (narrative as any)?.debug ?? null;

        // Store narrative in database - use case-insensitive username match
        console.log("[ProfileGenerate] Updating database with new narrative...");
        const { error: updateError, count: updateCount } = await supabase
          .from("opponent_profiles")
          .update({
            ai_quick_summary: narrative.quick_summary,
            ai_comprehensive_report: narrative.comprehensive_report,
            ai_narrative_generated_at: narrative.generated_at,
            ai_subject_type: narrative.subject_type,
            ai_model_used: narrative.model_used,
          })
          .eq("profile_id", user.id)
          .eq("platform", platform)
          .ilike("username", usernameKey);

        console.log("[ProfileGenerate] Update result - error:", updateError?.message ?? "none", "count:", updateCount);

        if (updateError) {
          console.error("[ProfileGenerate] Failed to store AI narrative:", updateError.message);
        }

        // Re-fetch updated row so frontend immediately receives ai_* fields (no refresh needed)
        const { data: updatedProfile } = await supabase
          .from("opponent_profiles")
          .select(selectFields)
          .eq("profile_id", user.id)
          .eq("platform", platform)
          .ilike("username", usernameKey)
          .maybeSingle();

        console.log("[ProfileGenerate] Re-fetched profile, ai_narrative_generated_at:", updatedProfile?.ai_narrative_generated_at);

        if (updatedProfile) responseProfile = updatedProfile;

        console.log("[ProfileGenerate] AI narrative generated successfully for", username, "with subject_type:", subjectType);
      } catch (narrativeError) {
        aiError = narrativeError instanceof Error ? narrativeError.message : String(narrativeError);
        console.error("[ProfileGenerate] AI narrative generation failed:", aiError);
      }
    } else {
      console.log("[ProfileGenerate] AI narrative generation SKIPPED (enableAiNarrative is false)");
    }
    
    console.log("[ProfileGenerate] Final responseProfile ai_narrative_generated_at:", responseProfile?.ai_narrative_generated_at);
    
    return NextResponse.json({ 
      opponent_profile: responseProfile, 
      debug_counts: debugCounts,
      ai_narrative: aiNarrative,
      ai_debug: aiDebug,
      ai_error: aiError,
    });
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
