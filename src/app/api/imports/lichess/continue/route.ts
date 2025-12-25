import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchLichessGamesBatch } from "@/server/services/lichess";

const BATCH_MAX = 200;

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
      "id, profile_id, target_type, platform, username, status, imported_count, cursor_until, newest_game_at"
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

    const batch = await fetchLichessGamesBatch({
      username: imp.username,
      max: BATCH_MAX,
      untilMs,
    });

    if (batch.games.length === 0) {
      const { data: updated, error: updateErr } = await supabase
        .from("imports")
        .update({
          status: "complete",
          last_success_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", imp.id)
        .select(
          "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, last_success_at, expires_at, last_error, updated_at"
        )
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
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

    const { data: upserted, error: upsertErr } = await supabase
      .from("games")
      .upsert(rows, {
        onConflict: "platform,platform_game_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (upsertErr) {
      throw upsertErr;
    }

    const insertedCount = upserted?.length ?? 0;

    const nextUntilMs = batch.oldestGameAtMs !== null ? batch.oldestGameAtMs - 1 : null;

    const updatePayload: any = {
      imported_count: (imp.imported_count ?? 0) + insertedCount,
      last_success_at: new Date().toISOString(),
      last_error: null,
    };

    if (batch.oldestGameAtMs !== null) {
      updatePayload.last_game_at = new Date(batch.oldestGameAtMs).toISOString();
    }

    if (imp.newest_game_at == null && batch.newestGameAtMs !== null) {
      updatePayload.newest_game_at = new Date(batch.newestGameAtMs).toISOString();
    }

    if (nextUntilMs !== null) {
      updatePayload.cursor_until = new Date(nextUntilMs).toISOString();
    }

    if (batch.games.length < BATCH_MAX) {
      updatePayload.status = "complete";
    }

    const { data: updated, error: updateErr } = await supabase
      .from("imports")
      .update(updatePayload)
      .eq("id", imp.id)
      .select(
        "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, last_success_at, expires_at, last_error, updated_at"
      )
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
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
