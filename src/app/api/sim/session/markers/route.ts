import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ChessPlatform = "lichess" | "chesscom";

export async function GET(request: Request) {
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

  const usernameKey = username.toLowerCase();

  const { data, error } = await supabase
    .from("opponent_style_markers")
    .select("marker_key, label, strength, tooltip, metrics_json, created_at")
    .eq("profile_id", user.id)
    .eq("platform", platform)
    .eq("username", usernameKey)
    .eq("source_type", "SESSION")
    .like("marker_key", "axis_%")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of (data ?? []) as any[]) {
    const k = String(r?.marker_key ?? "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }

  return NextResponse.json(
    { markers: out },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        pragma: "no-cache",
        expires: "0",
      },
    }
  );
}
