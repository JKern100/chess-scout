import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, chess_platform, chess_username")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profile?.chess_username) {
    return NextResponse.json({ error: "No connected username" }, { status: 400 });
  }

  if (profile.chess_platform !== "lichess") {
    return NextResponse.json({ error: "Connected platform is not lichess" }, { status: 400 });
  }

  const username = profile.chess_username;

  const { count } = await supabase
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", user.id)
    .eq("platform", "lichess")
    .eq("username", username);

  const { data: importRow, error } = await supabase
    .from("imports")
    .upsert(
      {
        profile_id: user.id,
        target_type: "self",
        platform: "lichess",
        username,
        status: "running",
        imported_count: count ?? 0,
        last_error: null,
        expires_at: null,
      },
      { onConflict: "profile_id,target_type,platform,username" }
    )
    .select(
      "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, last_success_at, expires_at, last_error, updated_at"
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ import: importRow });
}
