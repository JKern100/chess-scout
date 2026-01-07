import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * GET /api/imports/debug?username=bazeenga2
 * 
 * Debug endpoint to check import and indexing status
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const username = searchParams.get("username")?.toLowerCase();

    if (!username) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    // Get import record
    const { data: imports } = await supabase
      .from("imports")
      .select("*")
      .eq("profile_id", user.id)
      .eq("platform", "lichess")
      .ilike("username", username)
      .order("created_at", { ascending: false })
      .limit(1);

    const imp = imports?.[0];

    // Count games in database
    const { count: gamesCount } = await supabase
      .from("games")
      .select("*", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .eq("platform", "lichess")
      .ilike("username", username);

    // Count indexed events
    const { count: eventsCount } = await supabase
      .from("opponent_move_events")
      .select("*", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .eq("platform", "lichess")
      .ilike("username", username);

    // Get sample of indexed events
    const { data: sampleEvents } = await supabase
      .from("opponent_move_events")
      .select("platform_game_id, played_at, fen_before")
      .eq("profile_id", user.id)
      .eq("platform", "lichess")
      .ilike("username", username)
      .limit(5);

    return NextResponse.json({
      import: imp,
      gamesCount,
      eventsCount,
      sampleEvents,
      diagnosis: {
        importStatus: imp?.status,
        importedCount: imp?.imported_count,
        archivedCount: imp?.archived_count,
        ready: imp?.ready,
        stage: imp?.stage,
        needsIndexing: (imp?.imported_count || 0) > (imp?.archived_count || 0),
        gamesInDb: gamesCount,
        eventsInDb: eventsCount,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal Server Error";
    console.error("[debug] Error:", msg, err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
