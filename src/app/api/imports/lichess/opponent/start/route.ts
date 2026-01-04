import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countLichessGamesSince, fetchLichessUserRatingsSnapshot } from "@/server/services/lichess";

const DEFAULT_OPPONENT_TTL_DAYS = 14;
const SCOUT_BASE_YEARS = 3;
const FALLBACK_MOST_RECENT_LIMIT = 100;

type ChessPlatform = "lichess" | "chesscom";

export async function POST(request: Request) {
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

  const platform = (body?.platform as ChessPlatform | undefined) ?? "lichess";
  const username = String(body?.username ?? "").trim();

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  if (platform !== "lichess") {
    return NextResponse.json(
      { error: "Opponent imports currently support Lichess only" },
      { status: 400 }
    );
  }

  const expiresAt = new Date(Date.now() + DEFAULT_OPPONENT_TTL_DAYS * 24 * 60 * 60 * 1000);

  const scoutBaseSinceMs = new Date().setFullYear(new Date().getFullYear() - SCOUT_BASE_YEARS);
  const scoutBaseSinceIso = new Date(scoutBaseSinceMs).toISOString();

  let scoutBaseCount: number | null = null;
  let scoutBaseFallback = false;
  try {
    scoutBaseCount = await countLichessGamesSince({ username, sinceMs: scoutBaseSinceMs, cap: 50000 });
    scoutBaseFallback = (scoutBaseCount ?? 0) === 0;
  } catch {
    // best-effort. If this fails, we still allow import to run.
    scoutBaseCount = null;
    scoutBaseFallback = false;
  }

  const usernameKey = username.toLowerCase();
  const { count } = await supabase
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", user.id)
    .eq("platform", platform)
    .ilike("username", usernameKey);

  const { data: importRow, error } = await supabase
    .from("imports")
    .upsert(
      {
        profile_id: user.id,
        target_type: "opponent",
        platform,
        username,
        status: "running",
        imported_count: count ?? 0,
        scout_base_since: scoutBaseSinceIso,
        scout_base_count: scoutBaseCount,
        scout_base_fallback: scoutBaseFallback,
        scout_base_fallback_limit: FALLBACK_MOST_RECENT_LIMIT,
        last_error: null,
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "profile_id,target_type,platform,username" }
    )
    .select(
      "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, last_success_at, expires_at, last_error, updated_at, scout_base_since, scout_base_count, scout_base_fallback, scout_base_fallback_limit"
    )
    .single();

  if (error) {
    const msg = String(error.message || "");
    const missingColumn =
      msg.includes("scout_base_since") ||
      msg.includes("scout_base_count") ||
      msg.includes("scout_base_fallback") ||
      msg.includes("scout_base_fallback_limit");
    if (missingColumn) {
      return NextResponse.json(
        {
          error: "Imports table is missing Scout Base columns. Run scripts/supabase_imports_scout_base.sql in Supabase SQL editor.",
          needs_migration: true,
          details: error.message,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const ratings = await fetchLichessUserRatingsSnapshot({ username });
    await supabase.from("opponent_profiles").upsert(
      {
        profile_id: user.id,
        platform,
        username,
        ratings,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,platform,username" }
    );
  } catch {
    // best-effort
  }

  return NextResponse.json({ import: importRow });
}
