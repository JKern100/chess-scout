import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const platform = (url.searchParams.get("platform") as ChessPlatform | null) ?? "lichess";
  const username = String(url.searchParams.get("username") ?? "").trim();

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  if (!platform || !["lichess", "chesscom"].includes(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("opponent_profiles")
    .select("id, profile_id, platform, username, ratings, fetched_at, created_at, updated_at")
    .eq("profile_id", user.id)
    .eq("platform", platform)
    .eq("username", username)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ opponent_profile: data ?? null });
}
