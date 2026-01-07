import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildOpponentMoveEventsFromGame, upsertOpponentMoveEvents } from "@/server/openingTree";

/**
 * POST /api/imports/reindex
 * 
 * Manually trigger indexing of games into opponent_move_events table.
 * This is useful when games were imported but move events weren't indexed.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const platform = String(body?.platform ?? "lichess");
    const username = String(body?.username ?? "").trim().toLowerCase();
    const batchSize = Math.min(Math.max(Number(body?.batch_size ?? 500), 1), 1000);

    if (!username) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    // Get total games count
    const { count: totalGames, error: countErr } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .eq("platform", platform)
      .ilike("username", username);

    if (countErr) throw countErr;

    const total = typeof totalGames === "number" ? totalGames : 0;

    const nowIso = new Date().toISOString();

    const { data: imp, error: impErr } = await supabase
      .from("imports")
      .select("id, imported_count, archived_count")
      .eq("profile_id", user.id)
      .eq("target_type", "opponent")
      .eq("platform", platform)
      .ilike("username", username)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (impErr) throw impErr;

    if (!imp?.id) {
      const { data: created, error: createErr } = await supabase
        .from("imports")
        .upsert(
          {
            profile_id: user.id,
            target_type: "opponent",
            platform,
            username,
            status: "running",
            stage: "archiving",
            ready: true,
            imported_count: total,
            archived_count: 0,
            last_success_at: nowIso,
            last_error: null,
          },
          { onConflict: "profile_id,target_type,platform,username" }
        )
        .select("id, imported_count, archived_count")
        .single();

      if (createErr) throw createErr;
      (imp as any).id = created?.id;
      (imp as any).imported_count = created?.imported_count;
      (imp as any).archived_count = created?.archived_count;
    }

    const importId = String((imp as any)?.id ?? "");
    const indexedBefore = typeof (imp as any)?.archived_count === "number" ? Number((imp as any).archived_count) : 0;

    // Keep imported_count in sync with what's actually in the DB.
    await supabase
      .from("imports")
      .update({ imported_count: total, last_success_at: nowIso, last_error: null })
      .eq("id", importId);

    if (total <= 0) {
      await supabase
        .from("imports")
        .update({ status: "complete", stage: "complete", archived_count: 0, last_success_at: nowIso, last_error: null })
        .eq("id", importId);

      return NextResponse.json({
        message: "No games to index",
        import_id: importId,
        total_games: 0,
        indexed_games: 0,
        batch_games: 0,
        events_created: 0,
        events_inserted: 0,
        done: true,
      });
    }

    if (indexedBefore >= total) {
      await supabase
        .from("imports")
        .update({ status: "complete", stage: "complete", archived_count: total, last_success_at: nowIso, last_error: null })
        .eq("id", importId);

      return NextResponse.json({
        message: "Already indexed",
        import_id: importId,
        total_games: total,
        indexed_games: indexedBefore,
        batch_games: 0,
        events_created: 0,
        events_inserted: 0,
        done: true,
      });
    }

    const start = Math.max(0, indexedBefore);
    const end = start + batchSize - 1;

    // Fetch the next batch of games to index (most recent first)
    const { data: games, error: gamesErr } = await supabase
      .from("games")
      .select("platform_game_id, played_at, pgn")
      .eq("profile_id", user.id)
      .eq("platform", platform)
      .ilike("username", username)
      .order("played_at", { ascending: false })
      .range(start, end);

    if (gamesErr) throw gamesErr;

    const rows = Array.isArray(games) ? games : [];

    if (rows.length === 0) {
      await supabase
        .from("imports")
        .update({ status: "complete", stage: "complete", archived_count: indexedBefore, last_success_at: nowIso, last_error: null })
        .eq("id", importId);

      return NextResponse.json({
        message: "No more games to index",
        import_id: importId,
        total_games: total,
        indexed_games: indexedBefore,
        batch_games: 0,
        events_created: 0,
        events_inserted: 0,
        done: true,
      });
    }

    // Build move events
    const events = rows.flatMap((g: any) => {
      const platformGameId = String(g?.platform_game_id ?? "");
      return buildOpponentMoveEventsFromGame({
        profileId: user.id,
        platform: platform as "lichess" | "chesscom",
        username,
        platformGameId,
        playedAt: (g?.played_at as string | null) ?? null,
        pgn: String(g?.pgn ?? ""),
      });
    });

    // Upsert events
    const { inserted } = await upsertOpponentMoveEvents({ supabase, rows: events });

    const indexedAfter = indexedBefore + rows.length;
    const done = indexedAfter >= total;

    await supabase
      .from("imports")
      .update({
        status: done ? "complete" : "running",
        stage: done ? "complete" : "archiving",
        ready: true,
        imported_count: total,
        archived_count: indexedAfter,
        last_success_at: nowIso,
        last_error: null,
      })
      .eq("id", importId);

    return NextResponse.json({
      message: done ? "Indexing complete" : "Indexing batch complete",
      import_id: importId,
      total_games: total,
      indexed_games: indexedAfter,
      batch_games: rows.length,
      events_created: events.length,
      events_inserted: inserted,
      done,
    });
  } catch (err) {
    const anyErr = err as any;
    const msg = err instanceof Error ? err.message : typeof anyErr?.message === "string" ? anyErr.message : "Internal Server Error";
    console.error("[reindex] Error:", msg, err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
