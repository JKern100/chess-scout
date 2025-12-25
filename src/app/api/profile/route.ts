import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ChessPlatform = "lichess" | "chesscom";

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
    .from("profiles")
    .select("id, chess_platform, chess_username, is_pro, analyses_remaining")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data ?? null });
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const chessPlatform = (body as any)?.chess_platform as ChessPlatform | undefined;
  const chessUsername = (body as any)?.chess_username as string | undefined;

  if (!chessPlatform || !["lichess", "chesscom"].includes(chessPlatform)) {
    return NextResponse.json({ error: "Invalid chess_platform" }, { status: 400 });
  }

  const username = (chessUsername ?? "").trim();
  if (!username) {
    return NextResponse.json({ error: "chess_username is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        chess_platform: chessPlatform,
        chess_username: username,
      },
      { onConflict: "id" }
    )
    .select("id, chess_platform, chess_username, is_pro, analyses_remaining")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}
