import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchExpandedExplorerGames, extractPgnMetadata } from "@/lib/lichess/explorerGames";
import { 
  SYNTHETIC_STYLE_PRESETS, 
  getRatingsForTier, 
  scoreGameForPreset,
  calculateQuickStyleMetrics,
  type SyntheticStylePreset,
  type RatingTier,
} from "@/config/syntheticStylePresets";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const supabase = await createSupabaseServerClient();
  const { id } = await context.params;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get the synthetic opponent
  const { data: opponent, error: fetchError } = await supabase
    .from("synthetic_opponents")
    .select("*")
    .eq("id", id)
    .eq("profile_id", user.id)
    .single();

  if (fetchError || !opponent) {
    return NextResponse.json({ error: "Synthetic opponent not found" }, { status: 404 });
  }

  // Check if already syncing
  if (opponent.sync_status === "syncing") {
    return NextResponse.json({ error: "Sync already in progress" }, { status: 409 });
  }

  // Update status to syncing
  await supabase
    .from("synthetic_opponents")
    .update({ 
      sync_status: "syncing", 
      sync_started_at: new Date().toISOString(),
      sync_error: null,
    })
    .eq("id", id);

  try {
    const stylePreset = opponent.style_preset as SyntheticStylePreset;
    const ratingTier = opponent.rating_tier as RatingTier;
    const openingFen = opponent.opening_fen as string;

    // Check cache first
    const { data: cached } = await supabase
      .from("synthetic_opponent_cache")
      .select("games_json, games_count")
      .eq("opening_fen", openingFen)
      .eq("style_preset", stylePreset)
      .eq("rating_tier", ratingTier)
      .gt("expires_at", new Date().toISOString())
      .single();

    let games: any[] = [];
    let fromCache = false;

    if (cached && cached.games_count > 0) {
      // Use cached games
      games = cached.games_json as any[];
      fromCache = true;

      // Increment hit count
      await supabase.rpc("increment_cache_hit", { cache_fen: openingFen, cache_style: stylePreset, cache_rating: ratingTier });
    } else {
      // Fetch fresh games from Lichess Explorer
      const ratings = getRatingsForTier(ratingTier);
      
      const fetchedGames = await fetchExpandedExplorerGames({
        fen: openingFen,
        ratings,
        speeds: "blitz,rapid,classical",
        targetGames: 200,
      });

      games = fetchedGames;

      // Cache the results (if we got games)
      if (games.length > 0) {
        await supabase
          .from("synthetic_opponent_cache")
          .upsert({
            opening_fen: openingFen,
            style_preset: stylePreset,
            rating_tier: ratingTier,
            games_json: games,
            games_count: games.length,
            fetched_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          }, { onConflict: "opening_fen,style_preset,rating_tier" });
      }
    }

    // Clear existing games for this opponent
    await supabase
      .from("synthetic_opponent_games")
      .delete()
      .eq("synthetic_opponent_id", id);

    // Score and store games
    const presetConfig = SYNTHETIC_STYLE_PRESETS[stylePreset];
    const scoredGames: any[] = [];

    for (const game of games) {
      // Determine which color we're analyzing (use player with more matching style)
      // For simplicity, analyze the winner or white if draw
      const analyzeColor = game.winner === "black" ? "b" : "w";
      
      // Calculate style metrics
      const metrics = calculateQuickStyleMetrics(game.movesSan || [], analyzeColor);
      const styleScore = scoreGameForPreset(metrics, stylePreset);

      // Only include games that meet the minimum threshold
      if (styleScore >= presetConfig.minScoreThreshold) {
        const metadata = game.pgn ? extractPgnMetadata(game.pgn) : {
          whitePlayer: null,
          blackPlayer: null,
          whiteElo: null,
          blackElo: null,
          result: "*" as const,
          playedAt: null,
          eco: null,
          opening: null,
        };
        
        scoredGames.push({
          synthetic_opponent_id: id,
          lichess_game_id: game.id,
          pgn: game.pgn || "",
          white_player: game.white?.name || metadata.whitePlayer,
          black_player: game.black?.name || metadata.blackPlayer,
          white_elo: game.white?.rating || metadata.whiteElo,
          black_elo: game.black?.rating || metadata.blackElo,
          result: metadata.result || (game.winner === "white" ? "1-0" : game.winner === "black" ? "0-1" : "1/2-1/2"),
          played_at: game.playedAt || metadata.playedAt,
          moves_san: game.movesSan || [],
          style_score: styleScore,
          style_metrics_json: metrics,
        });
      }
    }

    // Sort by style score and take top games
    scoredGames.sort((a, b) => b.style_score - a.style_score);
    const topGames = scoredGames.slice(0, 500);

    // Insert scored games
    if (topGames.length > 0) {
      const { error: insertError } = await supabase
        .from("synthetic_opponent_games")
        .insert(topGames);

      if (insertError) {
        console.error("Error inserting games:", insertError);
      }
    }

    // Calculate aggregate style markers from top games
    const styleMarkers = calculateAggregateStyleMarkers(topGames, stylePreset);

    // Update synthetic opponent status
    await supabase
      .from("synthetic_opponents")
      .update({
        sync_status: "complete",
        sync_completed_at: new Date().toISOString(),
        games_fetched: games.length,
        games_scored: topGames.length,
        style_markers_json: styleMarkers,
      })
      .eq("id", id);

    return NextResponse.json({
      ok: true,
      gamesFetched: games.length,
      gamesScored: topGames.length,
      fromCache,
      styleMarkers,
    });

  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : "Sync failed";
    
    await supabase
      .from("synthetic_opponents")
      .update({
        sync_status: "error",
        sync_error: errorMessage,
      })
      .eq("id", id);

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * Calculate aggregate style markers from scored games
 */
function calculateAggregateStyleMarkers(
  games: Array<{ style_metrics_json: any; style_score: number }>,
  stylePreset: SyntheticStylePreset
) {
  if (games.length === 0) {
    return {
      aggression_index: 50,
      queen_trade_avoidance: 50,
      material_greed: 50,
      complexity_preference: 50,
      space_expansion: 50,
      blunder_rate: 5,
      time_pressure_weakness: 50,
    };
  }

  // Weight metrics by style score
  let totalWeight = 0;
  let aggressionSum = 0;
  let quietMoveSum = 0;
  let gameLengthSum = 0;

  for (const game of games) {
    const weight = game.style_score;
    const metrics = game.style_metrics_json || {};
    
    totalWeight += weight;
    aggressionSum += (metrics.aggression_index || 0.5) * weight;
    quietMoveSum += (metrics.quiet_move_ratio || 0.5) * weight;
    gameLengthSum += (metrics.avg_game_length || 0.5) * weight;
  }

  const avgAggression = totalWeight > 0 ? aggressionSum / totalWeight : 0.5;
  const avgQuiet = totalWeight > 0 ? quietMoveSum / totalWeight : 0.5;
  const avgLength = totalWeight > 0 ? gameLengthSum / totalWeight : 0.5;

  // Map to the style marker format (0-100 scale)
  const presetConfig = SYNTHETIC_STYLE_PRESETS[stylePreset];
  
  // Base markers on the preset's character
  const baseMarkers = {
    aggressive: {
      aggression_index: 75,
      queen_trade_avoidance: 30,
      material_greed: 40,
      complexity_preference: 70,
      space_expansion: 60,
      blunder_rate: 8,
      time_pressure_weakness: 50,
    },
    positional: {
      aggression_index: 35,
      queen_trade_avoidance: 60,
      material_greed: 55,
      complexity_preference: 35,
      space_expansion: 75,
      blunder_rate: 4,
      time_pressure_weakness: 40,
    },
    defensive: {
      aggression_index: 25,
      queen_trade_avoidance: 80,
      material_greed: 60,
      complexity_preference: 30,
      space_expansion: 50,
      blunder_rate: 3,
      time_pressure_weakness: 35,
    },
  };

  const base = baseMarkers[stylePreset];

  // Adjust based on actual game metrics
  return {
    aggression_index: Math.round(base.aggression_index * (0.7 + 0.6 * avgAggression)),
    queen_trade_avoidance: base.queen_trade_avoidance,
    material_greed: base.material_greed,
    complexity_preference: Math.round(base.complexity_preference * (0.7 + 0.6 * (1 - avgQuiet))),
    space_expansion: base.space_expansion,
    blunder_rate: base.blunder_rate,
    time_pressure_weakness: base.time_pressure_weakness,
  };
}
