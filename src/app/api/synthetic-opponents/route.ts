import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SyntheticStylePreset, RatingTier } from "@/config/syntheticStylePresets";

type SyntheticOpponentRow = {
  id: string;
  name: string;
  style_preset: SyntheticStylePreset;
  opening_eco: string | null;
  opening_name: string;
  opening_fen: string;
  opening_moves_san: string[];
  rating_tier: RatingTier;
  sync_status: "pending" | "syncing" | "complete" | "error";
  sync_error: string | null;
  games_fetched: number;
  games_scored: number;
  style_markers_json: any;
  created_at: string;
  archived_at: string | null;
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
    .from("synthetic_opponents")
    .select("*")
    .eq("profile_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const opponents = (data ?? []).map((row: SyntheticOpponentRow) => ({
    id: row.id,
    name: row.name,
    stylePreset: row.style_preset,
    openingEco: row.opening_eco,
    openingName: row.opening_name,
    openingFen: row.opening_fen,
    openingMovesSan: row.opening_moves_san,
    ratingTier: row.rating_tier,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
    gamesFetched: row.games_fetched,
    gamesScored: row.games_scored,
    styleMarkers: row.style_markers_json,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ syntheticOpponents: opponents });
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

  const stylePreset = String(body?.stylePreset ?? "").toLowerCase();
  if (!["aggressive", "positional", "defensive"].includes(stylePreset)) {
    return NextResponse.json({ error: "Invalid style preset" }, { status: 400 });
  }

  const ratingTier = String(body?.ratingTier ?? "all").toLowerCase();
  if (!["all", "1600", "1800", "masters"].includes(ratingTier)) {
    return NextResponse.json({ error: "Invalid rating tier" }, { status: 400 });
  }

  const openingName = String(body?.openingName ?? "").trim();
  const openingFen = String(body?.openingFen ?? "").trim();
  const openingEco = body?.openingEco ? String(body.openingEco).trim() : null;
  const openingMovesSan = Array.isArray(body?.openingMovesSan) 
    ? body.openingMovesSan.map((m: any) => String(m))
    : [];

  if (!openingName) {
    return NextResponse.json({ error: "Opening name is required" }, { status: 400 });
  }

  if (!openingFen) {
    return NextResponse.json({ error: "Opening FEN is required" }, { status: 400 });
  }

  // Generate a descriptive name
  const name = body?.name 
    ? String(body.name).trim()
    : `${openingName} / ${stylePreset.charAt(0).toUpperCase() + stylePreset.slice(1)}`;

  const { data, error } = await supabase
    .from("synthetic_opponents")
    .upsert(
      {
        profile_id: user.id,
        name,
        style_preset: stylePreset,
        opening_eco: openingEco,
        opening_name: openingName,
        opening_fen: openingFen,
        opening_moves_san: openingMovesSan,
        rating_tier: ratingTier,
        sync_status: "pending",
        sync_error: null,
        games_fetched: 0,
        games_scored: 0,
      },
      { onConflict: "profile_id,opening_fen,style_preset,rating_tier" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    syntheticOpponent: {
      id: data.id,
      name: data.name,
      stylePreset: data.style_preset,
      openingEco: data.opening_eco,
      openingName: data.opening_name,
      openingFen: data.opening_fen,
      openingMovesSan: data.opening_moves_san,
      ratingTier: data.rating_tier,
      syncStatus: data.sync_status,
      createdAt: data.created_at,
    },
  });
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

  const id = String(body?.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const archived = Boolean(body?.archived);
  const archived_at = archived ? new Date().toISOString() : null;

  const { error } = await supabase
    .from("synthetic_opponents")
    .update({ archived_at })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
