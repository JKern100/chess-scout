import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchLichessUserTotalGames } from "@/server/services/lichess";

type ChessPlatform = "lichess" | "chesscom";

type OpponentRow = {
  platform: ChessPlatform;
  username: string;
  created_at: string;
  last_refreshed_at: string | null;
  archived_at?: string | null;
  games_count?: number;
  total_games?: number;
  style_markers?: Array<{
    marker_key: string;
    label: string;
    strength: string;
    tooltip: string;
  }>;
};

function strengthRank(s: unknown) {
  const v = String(s ?? "").toLowerCase();
  if (v === "strong") return 3;
  if (v === "medium") return 2;
  if (v === "light") return 1;
  return 0;
}

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("opponents")
    .select("platform, username, created_at, last_refreshed_at, archived_at")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as OpponentRow[];

  const baseOpponents = rows
    .map((r) => ({
      platform: (r.platform as ChessPlatform) ?? "lichess",
      username: String(r.username ?? "").trim(),
      created_at: r.created_at,
      last_refreshed_at: r.last_refreshed_at ?? null,
      archived_at: (r as any)?.archived_at ?? null,
    }))
    .filter((o) => o.username);

  const opponents = await Promise.all(
    baseOpponents.map(async (o) => {
      const { count, error: gamesCountError } = await supabase
        .from("games")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", user.id)
        .eq("platform", o.platform)
        .eq("username", o.username);

      const { data: impCountRow } = await supabase
        .from("imports")
        .select("imported_count")
        .eq("profile_id", user.id)
        .eq("target_type", "opponent")
        .eq("platform", o.platform)
        .eq("username", o.username)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const importedCount = Number((impCountRow as any)?.imported_count ?? 0);

      const gamesTableCount = gamesCountError ? 0 : typeof count === "number" ? count : 0;
      const loadedGamesCount = Math.max(0, gamesTableCount, importedCount);

      let totalGames: number | null = null;
      if (o.platform === "lichess") {
        try {
          totalGames = await fetchLichessUserTotalGames({ username: o.username });
        } catch {
          totalGames = null;
        }
      }

      let lastRefreshedAt = o.last_refreshed_at;
      if (!lastRefreshedAt) {
        const { data: imp } = await supabase
          .from("imports")
          .select("last_success_at")
          .eq("profile_id", user.id)
          .eq("target_type", "opponent")
          .eq("platform", o.platform)
          .eq("username", o.username)
          .order("last_success_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const derived = (imp as any)?.last_success_at as string | null | undefined;
        if (derived) {
          lastRefreshedAt = derived;
          await supabase
            .from("opponents")
            .update({ last_refreshed_at: derived })
            .eq("user_id", user.id)
            .eq("platform", o.platform)
            .eq("username", o.username);
        }
      }

      return {
        ...o,
        games_count: loadedGamesCount,
        total_games: typeof totalGames === "number" ? totalGames : undefined,
        last_refreshed_at: lastRefreshedAt,
      };
    })
  );

  // Best-effort: attach top style markers (PROFILE) if the table exists.
  try {
    const lichessKeys = opponents
      .filter((o) => o.platform === "lichess")
      .map((o) => String(o.username ?? "").trim().toLowerCase())
      .filter(Boolean);
    const chesscomKeys = opponents
      .filter((o) => o.platform === "chesscom")
      .map((o) => String(o.username ?? "").trim().toLowerCase())
      .filter(Boolean);

    const rows: any[] = [];

    if (lichessKeys.length) {
      const { data } = await supabase
        .from("opponent_style_markers")
        .select("platform, username, marker_key, label, strength, tooltip, updated_at")
        .eq("profile_id", user.id)
        .eq("platform", "lichess")
        .eq("source_type", "PROFILE")
        .in("username", lichessKeys);
      if (Array.isArray(data)) rows.push(...data);
    }

    if (chesscomKeys.length) {
      const { data } = await supabase
        .from("opponent_style_markers")
        .select("platform, username, marker_key, label, strength, tooltip, updated_at")
        .eq("profile_id", user.id)
        .eq("platform", "chesscom")
        .eq("source_type", "PROFILE")
        .in("username", chesscomKeys);
      if (Array.isArray(data)) rows.push(...data);
    }

    const byKey = new Map<string, any[]>();
    for (const r of rows) {
      const platform = String(r?.platform ?? "");
      const username = String(r?.username ?? "").trim().toLowerCase();
      if (!platform || !username) continue;
      const k = `${platform}:${username}`;
      const arr = byKey.get(k) ?? [];
      arr.push(r);
      byKey.set(k, arr);
    }

    for (const o of opponents as OpponentRow[]) {
      const k = `${o.platform}:${String(o.username ?? "").trim().toLowerCase()}`;
      const arr = byKey.get(k) ?? [];
      arr.sort((a, b) => {
        const sr = strengthRank(b?.strength) - strengthRank(a?.strength);
        if (sr !== 0) return sr;
        const ta = String(a?.updated_at ?? "");
        const tb = String(b?.updated_at ?? "");
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });
      (o as any).style_markers = arr.slice(0, 2).map((m) => ({
        marker_key: String(m?.marker_key ?? ""),
        label: String(m?.label ?? ""),
        strength: String(m?.strength ?? ""),
        tooltip: String(m?.tooltip ?? ""),
      }));
    }
  } catch {
    // ignore missing table / schema errors
  }

  return NextResponse.json({ opponents });
}

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

  const platformRaw = String(body?.platform ?? "lichess");
  const platform: ChessPlatform = platformRaw === "chesscom" ? "chesscom" : "lichess";
  const username = String(body?.username ?? "").trim();

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("opponents")
    .upsert(
      {
        user_id: user.id,
        platform,
        username,
        last_refreshed_at: null,
        archived_at: null,
      },
      { onConflict: "user_id,platform,username" }
    )
    .select("platform, username, created_at, last_refreshed_at, archived_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ opponent: data });
}

export async function PATCH(request: Request) {
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
  const archived = Boolean(body?.archived);

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  const archived_at = archived ? new Date().toISOString() : null;

  const { error } = await supabase
    .from("opponents")
    .update({ archived_at })
    .eq("user_id", user.id)
    .eq("platform", platform)
    .eq("username", username);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const platformRaw = String(url.searchParams.get("platform") ?? "lichess");
  const platform: ChessPlatform = platformRaw === "chesscom" ? "chesscom" : "lichess";
  const username = String(url.searchParams.get("username") ?? "").trim();

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("opponents")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("platform", platform)
    .eq("username", username);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
