import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchLichessGamesBatch } from "@/server/services/lichess";
import { fetchLichessUserRatingsSnapshot } from "@/server/services/lichess";
import { buildOpponentMoveEventsFromGame, upsertOpponentMoveEvents } from "@/server/openingTree";

const STAGE1_BATCH_MAX = 200;
const STAGE2_BATCH_MAX = 500;
const READY_THRESHOLD_GAMES = 1000;
const STAGE1_INDEX_MAX = 50;
const STAGE1_MAX_PLIES = 16;

const continueLocks = new Map<string, number>();
const CONTINUE_LOCK_TTL_MS = 60_000;

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

  const importId = body?.import_id as string | undefined;
  if (!importId) {
    return NextResponse.json({ error: "import_id is required" }, { status: 400 });
  }

  const { data: imp, error: impError } = await supabase
    .from("imports")
    .select(
      "id, profile_id, target_type, platform, username, status, imported_count, cursor_until, newest_game_at, ready, stage, archived_count"
    )
    .eq("id", importId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (impError) {
    return NextResponse.json({ error: impError.message }, { status: 500 });
  }

  if (!imp) {
    return NextResponse.json({ error: "Import not found" }, { status: 404 });
  }

  const importedCountGate = typeof imp.imported_count === "number" ? imp.imported_count : 0;
  const indexedCountGate = typeof (imp as any)?.archived_count === "number" ? (imp as any).archived_count : 0;
  const canCatchUpIndexing = imp.target_type === "opponent" && indexedCountGate < importedCountGate;

  if (imp.status !== "running" && !canCatchUpIndexing) {
    return NextResponse.json({ import: imp, message: "Not running" });
  }

  if (imp.platform !== "lichess") {
    return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }

  const lockKey = `${user.id}:${imp.username}`;
  const heldAt = continueLocks.get(lockKey);
  if (heldAt && Date.now() - heldAt < CONTINUE_LOCK_TTL_MS) {
    return NextResponse.json({ error: "Lichess import already in progress" }, { status: 429 });
  }
  continueLocks.set(lockKey, Date.now());

  try {
    const t0 = Date.now();
    const untilMs = imp.cursor_until ? new Date(imp.cursor_until).getTime() : undefined;

    const stage = typeof (imp as any)?.stage === "string" ? String((imp as any).stage) : "indexing";
    const ready = Boolean((imp as any)?.ready);
    const importedCountBefore = importedCountGate;
    const indexedCountBefore = indexedCountGate;

    const batchMax = ready || stage === "archiving" ? STAGE2_BATCH_MAX : STAGE1_BATCH_MAX;

    const tFetch0 = Date.now();
    const batch = await fetchLichessGamesBatch({
      username: imp.username,
      max: batchMax,
      untilMs,
    });
    const tFetch1 = Date.now();

    console.log(
      JSON.stringify({
        tag: "import_continue",
        phase: "fetch",
        importId: imp.id,
        username: imp.username,
        untilMs: untilMs ?? null,
        batchMax,
        batchLen: batch.games.length,
        oldestGameAtMs: batch.oldestGameAtMs,
        newestGameAtMs: batch.newestGameAtMs,
      })
    );

    if (batch.games.length === 0) {
      // No more games to fetch. If this is an opponent import and we still haven't indexed
      // the already-synced games into opponent_move_events, keep working through them.
      if (imp.target_type === "opponent" && indexedCountBefore < importedCountBefore) {
        let indexedGameCount = 0;
        try {
          const start = Math.max(0, indexedCountBefore);
          const end = start + STAGE2_BATCH_MAX - 1;
          const { data: existing, error: existingErr } = await supabase
            .from("games")
            .select("platform_game_id, played_at, pgn")
            .eq("profile_id", user.id)
            .eq("platform", "lichess")
            .eq("username", imp.username)
            .order("played_at", { ascending: false })
            .range(start, end);

          if (existingErr) throw existingErr;

          const rows = Array.isArray(existing) ? existing : [];
          const events = rows.flatMap((g: any) => {
            const platformGameId = String(g?.platform_game_id ?? "");
            return buildOpponentMoveEventsFromGame({
              profileId: user.id,
              platform: "lichess",
              username: imp.username,
              platformGameId,
              playedAt: (g?.played_at as string | null) ?? null,
              pgn: String(g?.pgn ?? ""),
              maxPlies: undefined,
            });
          });

          await upsertOpponentMoveEvents({ supabase, rows: events });
          indexedGameCount = rows.length;
        } catch {
          indexedGameCount = 0;
        }

        const indexedCountAfter = indexedCountBefore + indexedGameCount;
        const shouldMarkComplete = indexedCountAfter >= importedCountBefore || indexedGameCount === 0;

        const { data: updated, error: updateErr } = await supabase
          .from("imports")
          .update({
            status: shouldMarkComplete ? "complete" : "running",
            stage: shouldMarkComplete ? "complete" : "archiving",
            ready: true,
            archived_count: indexedCountAfter,
            last_success_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", imp.id)
          .select(
            "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, ready, stage, archived_count, last_success_at, expires_at, last_error, updated_at"
          )
          .single();

        if (updateErr) {
          return NextResponse.json({ error: updateErr.message }, { status: 500 });
        }

        if (updated?.target_type === "opponent" && updated?.status === "complete") {
          try {
            const ratings = await fetchLichessUserRatingsSnapshot({ username: updated.username });
            await supabase.from("opponent_profiles").upsert(
              {
                profile_id: user.id,
                platform: updated.platform,
                username: updated.username,
                ratings,
                fetched_at: new Date().toISOString(),
              },
              { onConflict: "profile_id,platform,username" }
            );
          } catch {
            // best-effort
          }

          await supabase
            .from("opponents")
            .update({ last_refreshed_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .eq("platform", updated.platform)
            .eq("username", updated.username);
        }

        return NextResponse.json({ import: updated, batchCount: 0, indexedGames: indexedGameCount });
      }

      const { data: updated, error: updateErr } = await supabase
        .from("imports")
        .update({
          status: "complete",
          stage: "complete",
          ready: imp.target_type === "opponent" ? true : (imp as any)?.ready,
          last_success_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", imp.id)
        .select(
          "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, ready, stage, archived_count, last_success_at, expires_at, last_error, updated_at"
        )
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      if (updated?.target_type === "opponent") {
        try {
          const ratings = await fetchLichessUserRatingsSnapshot({ username: updated.username });
          await supabase.from("opponent_profiles").upsert(
            {
              profile_id: user.id,
              platform: updated.platform,
              username: updated.username,
              ratings,
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "profile_id,platform,username" }
          );
        } catch {
          // best-effort
        }

        await supabase
          .from("opponents")
          .update({ last_refreshed_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .eq("platform", updated.platform)
          .eq("username", updated.username);
      }

      return NextResponse.json({ import: updated, batchCount: 0 });
    }

    const rows = batch.games.map((g) => ({
      profile_id: user.id,
      platform: "lichess",
      username: imp.username,
      platform_game_id: g.platformGameId,
      played_at: g.playedAt,
      pgn: g.pgn,
    }));

    const batchById = new Map(batch.games.map((g) => [String(g.platformGameId), g] as const));

    const tGames0 = Date.now();
    const { data: upserted, error: upsertErr } = await supabase
      .from("games")
      .upsert(rows, {
        onConflict: "platform,platform_game_id",
        ignoreDuplicates: true,
      })
      .select("platform_game_id, played_at");
    const tGames1 = Date.now();

    if (upsertErr) {
      throw upsertErr;
    }

    const insertedCount = upserted?.length ?? 0;

    const importedCountAfter = importedCountBefore + insertedCount;

    const shouldIndexMovesStage1 = imp.target_type === "opponent" && !ready;
    const shouldIndexMovesStage2 = imp.target_type === "opponent" && (ready || stage === "archiving");

    let indexedGameCount = 0;

    // If we didn't insert any new games (duplicates / already imported), indexing can stall.
    // Keep indexing from the existing games table using archived_count as an offset.
    if (insertedCount === 0 && (shouldIndexMovesStage1 || shouldIndexMovesStage2)) {
      try {
        const start = Math.max(0, indexedCountBefore);
        const end = start + (shouldIndexMovesStage2 ? STAGE2_BATCH_MAX : STAGE1_INDEX_MAX) - 1;
        const { data: existing, error: existingErr } = await supabase
          .from("games")
          .select("platform_game_id, played_at, pgn")
          .eq("profile_id", user.id)
          .eq("platform", "lichess")
          .eq("username", imp.username)
          .order("played_at", { ascending: false })
          .range(start, end);

        if (existingErr) throw existingErr;

        const rows = Array.isArray(existing) ? existing : [];
        const events = rows.flatMap((g: any) => {
          const platformGameId = String(g?.platform_game_id ?? "");
          return buildOpponentMoveEventsFromGame({
            profileId: user.id,
            platform: "lichess",
            username: imp.username,
            platformGameId,
            playedAt: (g?.played_at as string | null) ?? null,
            pgn: String(g?.pgn ?? ""),
            maxPlies: shouldIndexMovesStage2 ? undefined : STAGE1_MAX_PLIES,
          });
        });

        await upsertOpponentMoveEvents({ supabase, rows: events });
        indexedGameCount = rows.length;
      } catch {
        // best-effort
      }
    }

    if (indexedGameCount === 0 && insertedCount > 0 && (shouldIndexMovesStage1 || shouldIndexMovesStage2)) {
      try {
        const tIndex0 = Date.now();
        const limit = shouldIndexMovesStage2
          ? Math.min(insertedCount, STAGE2_BATCH_MAX)
          : Math.min(insertedCount, STAGE1_INDEX_MAX);
        const toIndex = (upserted ?? []).slice(0, limit);
        indexedGameCount = toIndex.length;

        const events = toIndex.flatMap((g: any) => {
          const platformGameId = String(g?.platform_game_id ?? "");
          const src = batchById.get(platformGameId);
          return buildOpponentMoveEventsFromGame({
            profileId: user.id,
            platform: "lichess",
            username: imp.username,
            platformGameId,
            playedAt: (g?.played_at as string | null) ?? null,
            pgn: String(src?.pgn ?? ""),
            maxPlies: shouldIndexMovesStage2 ? undefined : STAGE1_MAX_PLIES,
          });
        });

        const tUpsert0 = Date.now();
        await upsertOpponentMoveEvents({ supabase, rows: events });
        const tUpsert1 = Date.now();

        console.log(
          JSON.stringify({
            tag: "import_continue",
            phase: "index",
            importId: imp.id,
            username: imp.username,
            gamesFetched: batch.games.length,
            gamesInserted: insertedCount,
            gamesIndexed: indexedGameCount,
            eventsAttempted: events.length,
            ms_parse_build: tUpsert0 - tIndex0,
            ms_events_upsert: tUpsert1 - tUpsert0,
          })
        );
      } catch {
        // best-effort
      }
    }

    const nextUntilMs =
      batch.oldestGameAtMs !== null
        ? batch.oldestGameAtMs - 1
        : untilMs !== undefined
          ? untilMs - 1
          : null;

    const updatePayload: any = {
      imported_count: importedCountAfter,
      last_success_at: new Date().toISOString(),
      last_error: null,
    };

    if (imp.target_type === "opponent" && indexedGameCount > 0) {
      const indexedCountAfter = indexedCountBefore + indexedGameCount;
      updatePayload.archived_count = indexedCountAfter;

      if (!ready && indexedCountAfter >= READY_THRESHOLD_GAMES) {
        updatePayload.ready = true;
        updatePayload.stage = "archiving";
      } else if (ready || stage === "archiving") {
        updatePayload.stage = "archiving";
      }
    }

    if (batch.oldestGameAtMs !== null) {
      updatePayload.last_game_at = new Date(batch.oldestGameAtMs).toISOString();
    }

    if (imp.newest_game_at == null && batch.newestGameAtMs !== null) {
      updatePayload.newest_game_at = new Date(batch.newestGameAtMs).toISOString();
    }

    if (nextUntilMs !== null && nextUntilMs > 0) {
      updatePayload.cursor_until = new Date(nextUntilMs).toISOString();
    }

    const { data: updated, error: updateErr } = await supabase
      .from("imports")
      .update(updatePayload)
      .eq("id", imp.id)
      .select(
        "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, ready, stage, archived_count, last_success_at, expires_at, last_error, updated_at"
      )
      .single();

    console.log(
      JSON.stringify({
        tag: "import_continue",
        phase: "done",
        importId: imp.id,
        username: imp.username,
        ms_total: Date.now() - t0,
        ms_fetch: tFetch1 - tFetch0,
        ms_games_upsert: tGames1 - tGames0,
      })
    );

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    if (updated?.status === "complete" && updated?.target_type === "opponent") {
      try {
        const ratings = await fetchLichessUserRatingsSnapshot({ username: updated.username });
        await supabase.from("opponent_profiles").upsert(
          {
            profile_id: user.id,
            platform: updated.platform,
            username: updated.username,
            ratings,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "profile_id,platform,username" }
        );
      } catch {
        // best-effort
      }

      await supabase
        .from("opponents")
        .update({ last_refreshed_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("platform", updated.platform)
        .eq("username", updated.username);
    }

    return NextResponse.json({
      import: updated,
      batchCount: batch.games.length,
      insertedCount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Import failed";

    const statusMatch = /Lichess API error \((\d{3})\)/.exec(message);
    const upstreamStatus = statusMatch ? Number(statusMatch[1]) : null;
    const responseStatus = upstreamStatus && Number.isFinite(upstreamStatus) ? upstreamStatus : 500;

    console.warn(
      JSON.stringify({
        tag: "import_continue",
        phase: "error",
        importId: imp.id,
        username: imp.username,
        message,
      })
    );

    // Keep the import 'running' so the ImportSupervisor can retry.
    // Persist the error so the UI can surface it.
    await supabase
      .from("imports")
      .update({ status: "running", last_error: message })
      .eq("id", imp.id)
      .eq("profile_id", user.id);

    return NextResponse.json({ error: message }, { status: responseStatus });
  } finally {
    continueLocks.delete(lockKey);
  }
}
