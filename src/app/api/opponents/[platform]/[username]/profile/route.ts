import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ChessPlatform = "lichess" | "chesscom";

type Params = {
  platform: string;
  username: string;
};

export async function GET(_request: Request, context: { params: Promise<Params> }) {
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

  const fullSelect =
    "id, profile_id, platform, username, ratings, fetched_at, filters_json, profile_version, profile_json, stats_json, games_analyzed, generated_at, date_range_start, date_range_end, source_game_ids_hash, created_at, updated_at, ai_quick_summary, ai_comprehensive_report, ai_narrative_generated_at, ai_subject_type";
  const baseSelect = "id, profile_id, platform, username, ratings, fetched_at, created_at, updated_at";

  const { data, error } = await supabase
    .from("opponent_profiles")
    .select(fullSelect)
    .eq("profile_id", user.id)
    .eq("platform", platform)
    .eq("username", username)
    .maybeSingle();

  if (error) {
    const msg = String(error.message || "");
    const missingColumn =
      msg.includes("filters_json") ||
      msg.includes("profile_version") ||
      msg.includes("profile_json") ||
      msg.includes("stats_json") ||
      msg.includes("games_analyzed") ||
      msg.includes("generated_at") ||
      msg.includes("date_range_start") ||
      msg.includes("date_range_end") ||
      msg.includes("source_game_ids_hash");
    if (!missingColumn) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: fallbackData, error: fallbackError } = await supabase
      .from("opponent_profiles")
      .select(baseSelect)
      .eq("profile_id", user.id)
      .eq("platform", platform)
      .eq("username", username)
      .maybeSingle();

    if (fallbackError) {
      return NextResponse.json({ error: fallbackError.message }, { status: 500 });
    }

    const { data: markerData } = await supabase
      .from("opponent_style_markers")
      .select("marker_key, label, strength, tooltip, metrics_json")
      .eq("profile_id", user.id)
      .eq("platform", platform)
      .eq("username", usernameKey)
      .eq("source_type", "PROFILE")
      .order("created_at", { ascending: false });

    return NextResponse.json({ opponent_profile: fallbackData ?? null, needs_migration: true, style_markers: markerData ?? [] });
  }

  const { data: markerData } = await supabase
    .from("opponent_style_markers")
    .select("marker_key, label, strength, tooltip, metrics_json")
    .eq("profile_id", user.id)
    .eq("platform", platform)
    .eq("username", usernameKey)
    .eq("source_type", "PROFILE")
    .order("created_at", { ascending: false });

  return NextResponse.json({ opponent_profile: data ?? null, style_markers: markerData ?? [] });
}
