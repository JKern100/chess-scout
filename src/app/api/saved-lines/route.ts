import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ChessPlatform = "lichess" | "chesscom";

type Mode = "simulation" | "analysis";

type CreateSavedLineBody = {
  opponent_id?: string | null;
  opponent_platform?: ChessPlatform | null;
  opponent_username?: string | null;
  mode?: Mode;
  platform?: ChessPlatform | null;
  starting_fen?: string;
  moves_san?: string[];
  final_fen?: string;
  name?: string;
  notes?: string | null;
};

type SavedLineRow = {
  id: string;
  opponent_id: string | null;
  opponent_platform: ChessPlatform | null;
  opponent_username: string | null;
  mode: Mode;
  platform: ChessPlatform | null;
  starting_fen: string;
  moves_san: string[];
  final_fen: string;
  name: string;
  notes: string | null;
  saved_at: string;
};

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
  const id = url.searchParams.get("id");
  const opponent_platform_raw = url.searchParams.get("opponent_platform");
  const opponent_username_raw = url.searchParams.get("opponent_username");
  const synthetic_opponent_id = url.searchParams.get("synthetic_opponent_id");

  if (id) {
    const { data, error } = await supabase
      .from("saved_lines")
      .select(
        "id, opponent_id, opponent_platform, opponent_username, mode, platform, starting_fen, moves_san, final_fen, name, notes, saved_at"
      )
      .eq("user_id", user.id)
      .eq("id", id)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ saved_line: data as unknown as SavedLineRow });
  }

  const opponent_platform: ChessPlatform | null =
    opponent_platform_raw === "lichess"
      ? "lichess"
      : opponent_platform_raw === "chesscom"
        ? "chesscom"
        : null;
  const opponent_username = opponent_username_raw ? String(opponent_username_raw).trim() : null;

  let query = supabase
    .from("saved_lines")
    .select(
      "id, opponent_id, opponent_platform, opponent_username, mode, platform, starting_fen, moves_san, final_fen, name, notes, saved_at"
    )
    .eq("user_id", user.id)
    .order("saved_at", { ascending: false });

  if (synthetic_opponent_id) {
    query = query.eq("opponent_id", synthetic_opponent_id);
  } else if (opponent_platform && opponent_username) {
    query = query.eq("opponent_platform", opponent_platform).eq("opponent_username", opponent_username);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved_lines: (data ?? []) as unknown as SavedLineRow[] });
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

  let body: CreateSavedLineBody = {};
  try {
    body = (await request.json()) as CreateSavedLineBody;
  } catch {
    body = {};
  }

  const mode: Mode = body.mode === "simulation" ? "simulation" : "analysis";
  const platformRaw = body.platform;
  const platform: ChessPlatform | null =
    platformRaw === "lichess" ? "lichess" : platformRaw === "chesscom" ? "chesscom" : null;

  const starting_fen = String(body.starting_fen ?? "").trim();
  const final_fen = String(body.final_fen ?? "").trim();
  const name = String(body.name ?? "").trim();

  const moves_san = Array.isArray(body.moves_san)
    ? body.moves_san.map((m) => String(m ?? "").trim()).filter((m) => m)
    : [];

  const notes = body.notes == null ? null : String(body.notes);
  const opponent_id = body.opponent_id == null ? null : String(body.opponent_id);
  const opponent_platform: ChessPlatform | null =
    body.opponent_platform === "lichess" ? "lichess" : body.opponent_platform === "chesscom" ? "chesscom" : null;
  const opponent_username = body.opponent_username == null ? null : String(body.opponent_username).trim();

  if (!starting_fen) {
    return NextResponse.json({ error: "starting_fen is required" }, { status: 400 });
  }

  if (!final_fen) {
    return NextResponse.json({ error: "final_fen is required" }, { status: 400 });
  }

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("saved_lines")
    .insert({
      user_id: user.id,
      opponent_id,
      opponent_platform,
      opponent_username: opponent_username || null,
      mode,
      platform,
      starting_fen,
      moves_san,
      final_fen,
      name,
      notes,
    })
    .select("id, saved_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved_line: data });
}
