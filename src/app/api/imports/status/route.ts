import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("imports")
      .select(
        "id, profile_id, target_type, platform, username, status, imported_count, last_game_at, cursor_until, newest_game_at, ready, stage, archived_count, last_success_at, expires_at, last_error, updated_at, scout_base_since, scout_base_count, scout_base_fallback, scout_base_fallback_limit"
      )
      .eq("profile_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ imports: data ?? [] });
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
