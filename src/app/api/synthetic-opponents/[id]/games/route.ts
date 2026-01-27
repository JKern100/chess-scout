import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/synthetic-opponents/[id]/games
 * 
 * Fetches games for a synthetic opponent, optionally filtered by position (FEN).
 * Used by the Scout Brain for move selection during simulation.
 */
export async function GET(request: Request, context: RouteContext) {
  const supabase = await createSupabaseServerClient();
  const { id } = await context.params;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify the synthetic opponent belongs to this user
  const { data: opponent, error: fetchError } = await supabase
    .from("synthetic_opponents")
    .select("id, name, style_preset, opening_fen, style_markers_json")
    .eq("id", id)
    .eq("profile_id", user.id)
    .single();

  if (fetchError || !opponent) {
    return NextResponse.json({ error: "Synthetic opponent not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10));

  // Fetch the top-scored games for this synthetic opponent
  const { data: games, error: gamesError } = await supabase
    .from("synthetic_opponent_games")
    .select("lichess_game_id, pgn, moves_san, white_player, black_player, white_elo, black_elo, result, style_score")
    .eq("synthetic_opponent_id", id)
    .order("style_score", { ascending: false })
    .limit(limit);

  if (gamesError) {
    return NextResponse.json({ error: gamesError.message }, { status: 500 });
  }

  return NextResponse.json({
    opponent: {
      id: opponent.id,
      name: opponent.name,
      stylePreset: opponent.style_preset,
      openingFen: opponent.opening_fen,
      styleMarkers: opponent.style_markers_json,
    },
    games: (games || []).map((g: any) => ({
      id: g.lichess_game_id,
      pgn: g.pgn,
      movesSan: g.moves_san,
      whitePlayer: g.white_player,
      blackPlayer: g.black_player,
      whiteElo: g.white_elo,
      blackElo: g.black_elo,
      result: g.result,
      styleScore: g.style_score,
    })),
    gamesCount: games?.length || 0,
  });
}
