import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchLichessGamesBatch } from "@/server/services/lichess";
import { fetchLichessUserRatingsSnapshot } from "@/server/services/lichess";
import { buildOpponentMoveEventsFromGame, upsertOpponentMoveEvents } from "@/server/openingTree";

const STAGE1_BATCH_MAX = 200;
const STAGE2_BATCH_MAX = 500;
const READY_THRESHOLD_GAMES = 1000;
const STAGE1_INDEX_MAX = 50;

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

  if (imp.status !== "running") {
    return NextResponse.json({ import: imp, message: "Not running" });
  }

  if (imp.platform !== "lichess") {
    return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }

  try {
    const untilMs = imp.cursor_until ? new Date(imp.cursor_until).getTime() : undefined;

    const stage = typeof (imp as any)?.stage === "string" ? String((imp as any).stage) : "indexing";
    const ready = Boolean((imp as any)?.ready);
    const importedCountBefore = typeof imp.imported_count === "number" ? imp.imported_count : 0;
    const indexedCountBefore = typeof (imp as any)?.archived_count === "number" ? (imp as any).archived_count : 0;

    const batchMax = ready || stage === "archiving" ? STAGE2_BATCH_MAX : STAGE1_BATCH_MAX;

    const batch = await fetchLichessGamesBatch({
      username: imp.username,
      max: batchMax,
      untilMs,
    });

    if (batch.games.length === 0) {
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

    const { data: upserted, error: upsertErr } = await supabase
      .from("games")
      .upsert(rows, {
        onConflict: "platform,platform_game_id",
        ignoreDuplicates: true,
      })
      .select("platform_game_id, played_at");

    if (upsertErr) {
      throw upsertErr;
    }

    const insertedCount = upserted?.length ?? 0;

    const importedCountAfter = importedCountBefore + insertedCount;

    const shouldIndexMovesStage1 = imp.target_type === "opponent" && !ready;
    const shouldIndexMovesStage2 = imp.target_type === "opponent" && (ready || stage === "archiving");

    let indexedGameCount = 0;

    if (insertedCount > 0 && (shouldIndexMovesStage1 || shouldIndexMovesStage2)) {
      try {
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
          });
        });

        await upsertOpponentMoveEvents({ supabase, rows: events });
      } catch {
        // best-effort
      }
    }

    const nextUntilMs = batch.oldestGameAtMs !== null ? batch.oldestGameAtMs - 1 : null;

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

    if (nextUntilMs !== null) {
      updatePayload.cursor_until = new Date(nextUntilMs).toISOString();
    }

    if (batch.games.length < batchMax) {
      updatePayload.status = "complete";
      updatePayload.stage = "complete";
      if (imp.target_type === "opponent") updatePayload.ready = true;
    }

    const { data: updated, error: updateErr } = await supabase
      .from("imports")
      .update(updatePayload)
      .eq("id", imp.id)
      .select(
        "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, ready, stage, archived_count, last_success_at, expires_at, last_error, updated_at"
      )
      .single();

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

    await supabase
      .from("imports")
      .update({ status: "error", last_error: message })
      .eq("id", imp.id)
      .eq("profile_id", user.id);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
