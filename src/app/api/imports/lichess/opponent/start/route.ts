import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countLichessGamesSince, fetchLichessUserRatingsSnapshot } from "@/server/services/lichess";

const DEFAULT_OPPONENT_TTL_DAYS = 14;
const SCOUT_BASE_YEARS = 3;
const FALLBACK_MOST_RECENT_LIMIT = 100;

type ChessPlatform = "lichess" | "chesscom";

const REQUIRED_IMPORTS_COLUMNS = [
  "ready",
  "stage",
  "archived_count",
  "scout_base_since",
  "scout_base_count",
  "scout_base_fallback",
  "scout_base_fallback_limit",
];

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

  // Quick check with a small cap and timeout to avoid blocking the response.
  // The client-side importer does the actual heavy lifting.
  const QUICK_COUNT_CAP = 100; // Just check if there are ANY games in the last 3 years
  const QUICK_COUNT_TIMEOUT_MS = 5000; // 5 second timeout to avoid 504s
  
  let scoutBaseCount: number | null = null;
  let scoutBaseFallback = false;
  try {
    const countPromise = countLichessGamesSince({ username, sinceMs: scoutBaseSinceMs, cap: QUICK_COUNT_CAP });
    const timeoutPromise = new Promise<number>((_, reject) => 
      setTimeout(() => reject(new Error("Count timeout")), QUICK_COUNT_TIMEOUT_MS)
    );
    scoutBaseCount = await Promise.race([countPromise, timeoutPromise]);
    scoutBaseFallback = (scoutBaseCount ?? 0) === 0;
  } catch {
    // Timeout or error - let the import proceed without count info.
    // The client-side worker will handle discovery.
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
    const msgLower = msg.toLowerCase();
    const missingColumn =
      msgLower.includes("column") &&
      (msgLower.includes("does not exist") || msgLower.includes("could not find") || msgLower.includes("not found")) &&
      REQUIRED_IMPORTS_COLUMNS.some((c) => msgLower.includes(String(c).toLowerCase()));
    if (missingColumn) {
      return NextResponse.json(
        {
          error:
            "Imports table schema is out of date. Run supabase/migrations/20260109_fix_imports_table.sql (or scripts/supabase_imports_scout_base.sql + scripts/supabase_imports_tiered_loading.sql) in Supabase SQL editor.",
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
