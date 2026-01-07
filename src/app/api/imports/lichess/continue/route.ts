import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchLichessGamesBatch } from "@/server/services/lichess";
import { fetchLichessUserRatingsSnapshot } from "@/server/services/lichess";
import { buildOpponentMoveEventsFromGame, upsertOpponentMoveEvents } from "@/server/openingTree";

const STAGE1_BATCH_MAX = 200;
const STAGE2_BATCH_MAX = 500;
const READY_THRESHOLD_GAMES = 1000;
const STAGE1_INDEX_MAX = 200;
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
      "id, profile_id, target_type, platform, username, status, imported_count, cursor_until, newest_game_at, ready, stage, archived_count, scout_base_since, scout_base_count, scout_base_fallback, scout_base_fallback_limit"
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

  const lockKey = `${imp.profile_id}:${imp.platform}:${imp.username}`;
  const heldAt = continueLocks.get(lockKey);
  if (heldAt && Date.now() - heldAt < CONTINUE_LOCK_TTL_MS) {
    return NextResponse.json({ busy: true }, { status: 202 });
  }
  continueLocks.set(lockKey, Date.now());

  try {
    const t0 = Date.now();
    const untilMs = imp.cursor_until ? new Date(imp.cursor_until).getTime() : undefined;

    let scoutBaseSinceIso = (imp as any)?.scout_base_since as string | null | undefined;
    let scoutBaseFallback = Boolean((imp as any)?.scout_base_fallback);
    const scoutBaseFallbackLimitRaw = (imp as any)?.scout_base_fallback_limit;
    const scoutBaseFallbackLimit = Number.isFinite(Number(scoutBaseFallbackLimitRaw))
      ? Math.max(1, Number(scoutBaseFallbackLimitRaw))
      : 100;
    let scoutBaseCount = typeof (imp as any)?.scout_base_count === "number" ? (imp as any).scout_base_count : null;

    if (imp.target_type === "opponent" && scoutBaseSinceIso == null) {
      const SCOUT_BASE_YEARS = 3;
      const FALLBACK_MOST_RECENT_LIMIT = 5000; // Increased to allow complete imports for most opponents
      const nowMs = Date.now();
      const sinceMs3y = new Date(nowMs).setFullYear(new Date(nowMs).getFullYear() - SCOUT_BASE_YEARS);
      scoutBaseSinceIso = new Date(sinceMs3y).toISOString();

      try {
        const { countLichessGamesSince } = await import("@/server/services/lichess");
        scoutBaseCount = await countLichessGamesSince({ username: imp.username, sinceMs: sinceMs3y, cap: 50000 });
        scoutBaseFallback = (scoutBaseCount ?? 0) === 0;
      } catch {
        scoutBaseCount = null;
        scoutBaseFallback = false;
      }

      await supabase
        .from("imports")
        .update({
          scout_base_since: scoutBaseSinceIso,
          scout_base_count: scoutBaseCount,
          scout_base_fallback: scoutBaseFallback,
          scout_base_fallback_limit: FALLBACK_MOST_RECENT_LIMIT,
        })
        .eq("id", imp.id);
    }

    const sinceMs =
      imp.target_type === "opponent" && !scoutBaseFallback && scoutBaseSinceIso
        ? new Date(scoutBaseSinceIso).getTime()
        : undefined;

    const stage = typeof (imp as any)?.stage === "string" ? String((imp as any).stage) : "indexing";
    const ready = Boolean((imp as any)?.ready);
    const importedCountBefore = importedCountGate;
    const indexedCountBefore = indexedCountGate;

    let batchMax = ready || stage === "archiving" ? STAGE2_BATCH_MAX : STAGE1_BATCH_MAX;
    if (imp.target_type === "opponent" && scoutBaseFallback) {
      const remaining = scoutBaseFallbackLimit - importedCountBefore;
      // Ensure we don't fetch more than the remaining limit
      batchMax = Math.max(0, Math.min(batchMax, remaining));
      // If we're close to the limit, stop fetching to avoid overshooting
      if (remaining <= 0) {
        batchMax = 0;
      }
    }

    const tFetch0 = Date.now();
    const batch = await fetchLichessGamesBatch({
      username: imp.username,
      max: batchMax,
      sinceMs,
      untilMs,
    });
    const tFetch1 = Date.now();

    console.log(
      JSON.stringify({
        tag: "import_continue",
        phase: "fetch",
        importId: imp.id,
        username: imp.username,
        sinceMs: sinceMs ?? null,
        untilMs: untilMs ?? null,
        batchMax,
        batchLen: batch.games.length,
        oldestGameAtMs: batch.oldestGameAtMs,
        newestGameAtMs: batch.newestGameAtMs,
        scoutBaseCount,
        scoutBaseFallback,
        importedCountBefore,
        indexedCountBefore,
      })
    );

    if (batch.games.length === 0 || batchMax <= 0) {
      // No more games to fetch from Lichess.
      // Mark as complete if we've reached the end of available games.
      const shouldMarkCompleteNoMoreGames = batch.games.length === 0 && importedCountBefore > 0;
      
      // If this is an opponent import and we still haven't indexed
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

      // No more games to fetch and no indexing needed - mark as complete
      const { data: updated, error: updateErr } = await supabase
        .from("imports")
        .update({
          status: "complete",
          stage: "complete",
          ready: imp.target_type === "opponent" ? true : (imp as any)?.ready,
          last_success_at: new Date().toISOString(),
          last_error: null,
          cursor_until: null,
        })
        .eq("id", imp.id)
        .select(
          "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, ready, stage, archived_count, last_success_at, expires_at, last_error, updated_at, scout_base_since, scout_base_count, scout_base_fallback, scout_base_fallback_limit"
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
      // Engine analysis data (if available from Lichess)
      white_acpl: g.whiteAnalysis?.acpl ?? null,
      black_acpl: g.blackAnalysis?.acpl ?? null,
      white_inaccuracies: g.whiteAnalysis?.inaccuracies ?? null,
      black_inaccuracies: g.blackAnalysis?.inaccuracies ?? null,
      white_mistakes: g.whiteAnalysis?.mistakes ?? null,
      black_mistakes: g.blackAnalysis?.mistakes ?? null,
      white_blunders: g.whiteAnalysis?.blunders ?? null,
      black_blunders: g.blackAnalysis?.blunders ?? null,
      evals_json: g.evals ? g.evals.map((e) => ({ e: e.eval, m: e.mate })) : null,
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

    // If we're in fallback mode (no games in last 3 years), stop after importing the most recent N games.
    const fallbackReached =
      imp.target_type === "opponent" && scoutBaseFallback && importedCountAfter >= scoutBaseFallbackLimit;

    const shouldIndexMovesStage1 = imp.target_type === "opponent" && !ready;
    const shouldIndexMovesStage2 = imp.target_type === "opponent" && (ready || stage === "archiving");

    let indexedGameCount = 0;

    // Index moves if: (1) no new games inserted, OR (2) fallback limit reached and we need to index what we have
    const shouldIndexNow = (shouldIndexMovesStage1 || shouldIndexMovesStage2) && 
                          (insertedCount === 0 || (fallbackReached && indexedCountBefore < importedCountAfter));

    if (shouldIndexNow) {
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
      } catch (indexErr) {
        const errMsg = indexErr instanceof Error ? indexErr.message : "Indexing failed";
        console.error(
          JSON.stringify({
            tag: "import_continue",
            phase: "index_error",
            importId: imp.id,
            username: imp.username,
            error: errMsg,
            context: "catch-up indexing",
          })
        );
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
      } catch (indexErr) {
        const errMsg = indexErr instanceof Error ? indexErr.message : "Indexing failed";
        console.error(
          JSON.stringify({
            tag: "import_continue",
            phase: "index_error",
            importId: imp.id,
            username: imp.username,
            error: errMsg,
            context: "new games indexing",
          })
        );
        indexedGameCount = 0;
      }
    }

    const nextUntilMs =
      batch.oldestGameAtMs !== null
        ? batch.oldestGameAtMs - 1
        : untilMs !== undefined
          ? untilMs - 1
          : null;

    const indexedCountAfterCalc = indexedCountBefore + indexedGameCount;
    const noNewGamesAndCaughtUp =
      insertedCount === 0 &&
      imp.target_type === "opponent" &&
      indexedCountAfterCalc >= importedCountBefore;

    const updatePayload: any = {
      imported_count: importedCountAfter,
      last_success_at: new Date().toISOString(),
      last_error: null,
    };

    if (fallbackReached || noNewGamesAndCaughtUp) {
      updatePayload.status = "complete";
      updatePayload.stage = "complete";
      updatePayload.ready = true;
      updatePayload.cursor_until = null;
      
      // Ensure archived_count is set when completing
      if (imp.target_type === "opponent" && indexedGameCount > 0) {
        updatePayload.archived_count = indexedCountBefore + indexedGameCount;
      }
    }

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
        "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, ready, stage, archived_count, last_success_at, expires_at, last_error, updated_at, scout_base_since, scout_base_count, scout_base_fallback, scout_base_fallback_limit"
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
      const msg = String(updateErr.message || "");
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
            details: updateErr.message,
          },
          { status: 409 }
        );
      }
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
