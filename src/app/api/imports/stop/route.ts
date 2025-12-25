import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  const { data, error } = await supabase
    .from("imports")
    .update({ status: "stopped" })
    .eq("id", importId)
    .eq("profile_id", user.id)
    .select(
      "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, last_success_at, expires_at, last_error, updated_at"
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ import: data ?? null });
}
