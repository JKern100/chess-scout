import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildOpponentProfileV2, type ChessPlatform, type LichessSpeed } from "@/server/opponentProfileV2";
import { calculateAndStoreMarkers } from "@/server/styleMarkerService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
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

    const platformRaw = String(body?.platform ?? "lichess");
    const platform: ChessPlatform = platformRaw === "chesscom" ? "chesscom" : "lichess";
    const username = String(body?.username ?? "").trim();

    if (!username) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    const enableStyleMarkers = Boolean(body?.enableStyleMarkers);
    if (!enableStyleMarkers) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const speedsProvided = Array.isArray(body?.speeds) || typeof body?.speeds === "string";
    const speedsRaw = Array.isArray(body?.speeds) ? (body.speeds as any[]) : typeof body?.speeds === "string" ? [body.speeds] : [];
    const speeds = speedsRaw
      .map((s) => String(s))
      .filter((s) => ["bullet", "blitz", "rapid", "classical", "correspondence"].includes(s)) as LichessSpeed[];

    const ratedRaw = String(body?.rated ?? "any");
    const rated = ratedRaw === "rated" ? "rated" : ratedRaw === "casual" ? "casual" : "any";

    const from = typeof body?.from === "string" ? String(body.from) : null;
    const to = typeof body?.to === "string" ? String(body.to) : null;

    const sessionKey = typeof body?.session_key === "string" && body.session_key.trim() ? String(body.session_key).trim() : null;

    // Semantics:
    // - speeds not provided => treat as "any" (no speed filter)
    // - speeds provided but empty => treat as "none" (match nothing)
    // - all 5 speeds selected => treat as "any"
    const speedsFilter: LichessSpeed[] = !speedsProvided ? [] : speeds;

    // Fixed cap of 5000 games for all date ranges (consistent with Profile route)
    const maxGamesCap = 5000;

    try {
      const { normalized } = await buildOpponentProfileV2({
        supabase,
        profileId: user.id,
        platform,
        username,
        filters: { speeds: speedsFilter, rated, from, to },
        includeNormalized: true,
        maxGamesCap,
      });

      if (Array.isArray(normalized) && normalized.length > 0) {
        await calculateAndStoreMarkers({
          supabase,
          profileId: user.id,
          platform,
          username,
          games: normalized,
          sourceType: "SESSION",
          sessionKey,
        });
      } else {
        // Important: if filters match 0 games, clear previous SESSION axis markers so UI doesn't show stale values.
        const usernameKey = username.trim().toLowerCase();
        await supabase
          .from("opponent_style_markers")
          .delete()
          .eq("profile_id", user.id)
          .eq("platform", platform)
          .eq("username", usernameKey)
          .eq("source_type", "SESSION")
          .like("marker_key", "axis_%");
      }

      return NextResponse.json({ ok: true, games_analyzed: Array.isArray(normalized) ? normalized.length : 0 });
    } catch (e) {
      console.error("Style markers (SESSION) failed", {
        platform,
        username,
        error: e instanceof Error ? e.message : e,
      });
      const msg = e instanceof Error ? e.message : "Failed to compute style markers";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (e) {
    const anyErr = e as any;
    const status = Number(anyErr?.status);
    const msg = e instanceof Error ? e.message : typeof anyErr?.message === "string" ? anyErr.message : "Internal Server Error";
    if (Number.isFinite(status) && status >= 400 && status < 600) {
      return NextResponse.json({ error: msg }, { status });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
