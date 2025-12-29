import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeFen } from "@/server/opponentModel";

type MoveAgg = {
  uci: string;
  san?: string | null;
  count?: number;
  win?: number;
  loss?: number;
  draw?: number;
  last_played_at?: string | null;
  opp_elo_sum?: number;
  opp_elo_count?: number;
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
  const platform = String(url.searchParams.get("platform") ?? "lichess");
  const username = String(url.searchParams.get("username") ?? "").trim();
  const fenRaw = String(url.searchParams.get("fen") ?? "").trim();

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  if (!fenRaw) {
    return NextResponse.json({ error: "fen is required" }, { status: 400 });
  }

  const fen = normalizeFen(fenRaw);

  const { data, error } = await supabase
    .from("opening_graph_nodes")
    .select("fen, played_by")
    .eq("profile_id", user.id)
    .eq("platform", platform)
    .eq("username", username)
    .eq("fen", fen)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const playedBy = (data as any)?.played_by as Record<string, MoveAgg> | null | undefined;

  const moves = Object.entries(playedBy ?? {})
    .map(([uci, agg]) => {
      const count = Number((agg as any)?.count ?? 0);
      const win = Number((agg as any)?.win ?? 0);
      const loss = Number((agg as any)?.loss ?? 0);
      const draw = Number((agg as any)?.draw ?? 0);
      const oppEloSum = Number((agg as any)?.opp_elo_sum ?? 0);
      const oppEloCount = Number((agg as any)?.opp_elo_count ?? 0);
      const avgOpponentElo = oppEloCount > 0 ? oppEloSum / oppEloCount : null;

      return {
        uci: String(uci),
        san: (agg as any)?.san != null ? String((agg as any).san) : null,
        played_count: count,
        win,
        loss,
        draw,
        last_played_at: (agg as any)?.last_played_at != null ? String((agg as any).last_played_at) : null,
        avg_opponent_elo: avgOpponentElo,
      };
    })
    .filter((m) => m.uci && Number.isFinite(m.played_count))
    .sort((a, b) => b.played_count - a.played_count);

  const totalCount = moves.reduce((s, m) => s + (m.played_count ?? 0), 0);

  return NextResponse.json({
    platform,
    username,
    fen,
    available_count: moves.length,
    available_total_count: totalCount,
    moves,
  });
}
