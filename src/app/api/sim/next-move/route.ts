import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getNextMoveOptions,
  getOrBuildOpponentModel,
  normalizeFen,
  selectMove,
  type MoveSelectionStrategy,
} from "@/server/opponentModel";

type Mode = MoveSelectionStrategy;

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

  const platform = String(body?.platform ?? "lichess");
  const username = String(body?.username ?? "").trim();
  const fen = String(body?.fen ?? "").trim();
  const mode = (String(body?.mode ?? "proportional") as Mode) ?? "proportional";
  const maxGames = Math.min(Math.max(Number(body?.max_games ?? 500), 1), 2000);
  const maxDepth = Math.min(Math.max(Number(body?.max_depth ?? 16), 1), 40);
  const prefetch = Boolean(body?.prefetch);

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  if (!fen) {
    return NextResponse.json({ error: "fen is required" }, { status: 400 });
  }

  const startFenKey = normalizeFen(fen);

  let model: Awaited<ReturnType<typeof getOrBuildOpponentModel>>["model"];
  let cache: Awaited<ReturnType<typeof getOrBuildOpponentModel>>["cache"];
  try {
    const res = await getOrBuildOpponentModel({
      supabase,
      profileId: user.id,
      platform,
      username,
      maxGames,
    });
    model = res.model;
    cache = res.cache;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load opponent games";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (prefetch) {
    return NextResponse.json({
      cache,
      position: startFenKey,
      mode,
      available_count: 0,
      available_total_count: 0,
      available_against_count: 0,
      available_against_total_count: 0,
      depth_remaining: 0,
      move: null,
      moves: [],
      moves_against: [],
      prefetched: true,
    });
  }

  const options = getNextMoveOptions({ model, fen, maxDepth });
  const picked = selectMove({ moves: options.opponent.moves, strategy: mode });

  return NextResponse.json({
    cache,
    position: startFenKey,
    mode,
    available_count: options.opponent.moves.length,
    available_total_count: options.opponent.totalCount,
    available_against_count: options.againstOpponent.moves.length,
    available_against_total_count: options.againstOpponent.totalCount,
    depth_remaining: options.depthRemaining,
    move: picked
      ? {
          uci: picked.uci,
          san: picked.san ?? null,
          played_count: picked.count,
          win: picked.win,
          loss: picked.loss,
          draw: picked.draw,
        }
      : null,
    moves: options.opponent.moves.slice(0, 30)
      .map((m) => ({
        uci: m.uci,
        san: m.san ?? null,
        played_count: m.count,
        win: m.win,
        loss: m.loss,
        draw: m.draw,
      })),
    moves_against: options.againstOpponent.moves.slice(0, 30)
      .map((m) => ({
        uci: m.uci,
        san: m.san ?? null,
        played_count: m.count,
        win: m.win,
        loss: m.loss,
        draw: m.draw,
      })),
  });
}
