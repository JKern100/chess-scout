import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ChessPlatform = "lichess" | "chesscom";

type OpponentRow = {
  platform: ChessPlatform;
  username: string;
  created_at: string;
  last_refreshed_at: string | null;
  games_count?: number;
};

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
    .select("platform, username, created_at, last_refreshed_at")
    .eq("user_id", user.id)
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
    }))
    .filter((o) => o.username);

  const opponents = await Promise.all(
    baseOpponents.map(async (o) => {
      const { count } = await supabase
        .from("games")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", user.id)
        .eq("platform", o.platform)
        .eq("username", o.username);

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
        games_count: typeof count === "number" ? count : 0,
        last_refreshed_at: lastRefreshedAt,
      };
    })
  );

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
      },
      { onConflict: "user_id,platform,username" }
    )
    .select("platform, username, created_at, last_refreshed_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ opponent: data });
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
    .delete()
    .eq("user_id", user.id)
    .eq("platform", platform)
    .eq("username", username);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
