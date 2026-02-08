import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ecoIndexRaw from "@/server/openings/eco_index.json";

// Build a lookup map: ECO code → name (pick the first/shortest entry per code)
const ecoNameMap = new Map<string, string>();
if (Array.isArray(ecoIndexRaw)) {
  for (const e of ecoIndexRaw as Array<{ eco?: string; name?: string }>) {
    const code = String(e?.eco ?? "").trim();
    const name = String(e?.name ?? "").trim();
    if (code && name && !ecoNameMap.has(code)) {
      ecoNameMap.set(code, name);
    }
  }
}

/**
 * GET /api/games/ecos?platform=lichess&username=fernandoracing
 *
 * Returns distinct ECO openings extracted from PGN headers for a given opponent.
 * Each entry includes eco code, opening name, opponent color, and game count.
 * Uses PostgreSQL regex to extract headers server-side (no full PGN transfer).
 */
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const platform = searchParams.get("platform") || "lichess";
  const username = searchParams.get("username");

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  try {
    // Use raw SQL via Supabase RPC-style query to extract ECO from PGN headers
    // This runs entirely in PostgreSQL — no full PGN text transferred
    const { data, error } = await supabase.rpc("get_distinct_ecos", {
      p_profile_id: user.id,
      p_platform: platform,
      p_username: username.trim().toLowerCase(),
    });

    if (error) {
      // If the RPC function doesn't exist yet, fall back to client-side parsing
      if (error.code === "42883" || error.message?.includes("function") || error.code === "PGRST202") {
        return await fallbackParsePgn(supabase, user.id, platform, username);
      }
      console.error("[/api/games/ecos] RPC error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ecos: data ?? [] });
  } catch (e) {
    // If RPC fails entirely, use fallback
    return await fallbackParsePgn(supabase, user.id, platform, username);
  }
}

// Regex patterns for PGN header extraction
const ECO_RE = /\[ECO\s+"([^"]+)"\]/;
const OPENING_RE = /\[Opening\s+"([^"]+)"\]/;
const WHITE_RE = /\[White\s+"([^"]+)"\]/;

/**
 * Fallback: fetch PGN text and parse headers in Node.js.
 * Only fetches the pgn column to minimize data transfer.
 */
async function fallbackParsePgn(
  supabase: any,
  profileId: string,
  platform: string,
  username: string
) {
  const usernameNorm = username.trim().toLowerCase();

  // Fetch only pgn column — headers are in the first ~500 chars
  const { data: games, error } = await supabase
    .from("games")
    .select("pgn")
    .eq("profile_id", profileId)
    .eq("platform", platform)
    .ilike("username", usernameNorm);

  if (error) {
    console.error("[/api/games/ecos] Fallback query error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!games || games.length === 0) {
    return NextResponse.json({ ecos: [] });
  }

  // Parse ECO from PGN headers
  const counts = new Map<string, { eco: string; eco_name: string; opponent_color: string; count: number }>();

  for (const g of games) {
    const pgn: string = g.pgn ?? "";
    // Only look at headers (first 600 chars is more than enough)
    const header = pgn.slice(0, 600);

    const ecoMatch = ECO_RE.exec(header);
    if (!ecoMatch) continue;

    const eco = ecoMatch[1];
    const openingMatch = OPENING_RE.exec(header);
    const ecoName = openingMatch?.[1] ?? ecoNameMap.get(eco) ?? eco;

    const whiteMatch = WHITE_RE.exec(header);
    const whiteName = whiteMatch?.[1]?.toLowerCase() ?? "";
    const oppColor = whiteName === usernameNorm ? "w" : "b";

    const key = `${eco}|${ecoName}|${oppColor}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { eco, eco_name: ecoName, opponent_color: oppColor, count: 1 });
    }
  }

  const ecos = Array.from(counts.values()).sort((a, b) => b.count - a.count);
  return NextResponse.json({ ecos });
}
