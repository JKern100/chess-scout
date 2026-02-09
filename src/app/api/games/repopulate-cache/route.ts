import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Returns game PGNs for a given opponent so the client can
 * repopulate its IndexedDB cache (opening traces + ECO data).
 *
 * This is called automatically when the client detects that
 * IndexedDB is empty (e.g. after a schema upgrade).
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform") || "lichess";
  const username = (searchParams.get("username") || "").trim().toLowerCase();

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  // Fetch all games for this opponent (just id, played_at, pgn)
  const { data, error } = await supabase
    .from("games")
    .select("platform_game_id, played_at, pgn")
    .eq("profile_id", user.id)
    .eq("platform", platform)
    .eq("username", username)
    .order("played_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const games = (data ?? []).map((g: any) => ({
    id: String(g.platform_game_id ?? ""),
    played_at: g.played_at ?? null,
    pgn: String(g.pgn ?? ""),
  })).filter((g: { id: string; pgn: string }) => g.id && g.pgn);

  return NextResponse.json({ games, count: games.length });
}
