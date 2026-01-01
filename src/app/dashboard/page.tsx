import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { fetchLichessUserTotalGames } from "@/server/services/lichess";

export const dynamic = "force-dynamic";

function strengthRank(s: unknown) {
  const v = String(s ?? "").toLowerCase();
  if (v === "strong") return 3;
  if (v === "medium") return 2;
  if (v === "light") return 1;
  return 0;
}

export default async function Dashboard() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      redirect("/");
    }

    const { data, error } = await supabase
      .from("opponents")
      .select("platform, username, created_at, last_refreshed_at, archived_at")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      return (
        <div className="min-h-screen bg-zinc-50">
          <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-10">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="text-lg font-medium text-zinc-900">Dashboard</div>
              <div className="mt-2 text-sm text-red-600">{error.message}</div>
            </div>
          </main>
        </div>
      );
    }

    const baseOpponents = (data ?? []) as Array<{
      platform: "lichess" | "chesscom";
      username: string;
      created_at: string;
      last_refreshed_at: string | null;
      archived_at?: string | null;
    }>;

    const opponentsWithCounts = await Promise.all(
      baseOpponents.map(async (o) => {
        const username = String(o.username ?? "").trim();
        const usernameKey = username.toLowerCase();
        const platform = (o.platform === "chesscom" ? "chesscom" : "lichess") as "lichess" | "chesscom";

        let totalGames: number | null = null;
        if (platform === "lichess") {
          try {
            totalGames = await fetchLichessUserTotalGames({ username });
          } catch {
            totalGames = null;
          }
        }

        const { data: imp } = await supabase
          .from("imports")
          .select("imported_count")
          .eq("profile_id", user.id)
          .eq("target_type", "opponent")
          .eq("platform", platform)
          .eq("username", usernameKey)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const importedCount = Number((imp as any)?.imported_count ?? 0);

        let gamesCount = 0;
        const { count: gamesTableCount, error: gamesCountError } = await supabase
          .from("games")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", user.id)
          .eq("platform", platform)
          .eq("username", usernameKey);
        gamesCount = gamesCountError ? 0 : typeof gamesTableCount === "number" ? gamesTableCount : 0;

        return {
          ...o,
          platform,
          username,
          games_count: Math.max(gamesCount, importedCount),
          total_games: typeof totalGames === "number" ? totalGames : undefined,
        };
      })
    );

    try {
      const lichessKeys = opponentsWithCounts
        .filter((o) => o.platform === "lichess")
        .map((o) => String(o.username ?? "").trim().toLowerCase())
        .filter(Boolean);
      const chesscomKeys = opponentsWithCounts
        .filter((o) => o.platform === "chesscom")
        .map((o) => String(o.username ?? "").trim().toLowerCase())
        .filter(Boolean);

      const rows: any[] = [];

      if (lichessKeys.length) {
        const { data } = await supabase
          .from("opponent_style_markers")
          .select("platform, username, marker_key, label, strength, tooltip, updated_at")
          .eq("profile_id", user.id)
          .eq("platform", "lichess")
          .eq("source_type", "PROFILE")
          .in("username", lichessKeys);
        if (Array.isArray(data)) rows.push(...data);
      }

      if (chesscomKeys.length) {
        const { data } = await supabase
          .from("opponent_style_markers")
          .select("platform, username, marker_key, label, strength, tooltip, updated_at")
          .eq("profile_id", user.id)
          .eq("platform", "chesscom")
          .eq("source_type", "PROFILE")
          .in("username", chesscomKeys);
        if (Array.isArray(data)) rows.push(...data);
      }

      const byKey = new Map<string, any[]>();
      for (const r of rows) {
        const platform = String(r?.platform ?? "");
        const username = String(r?.username ?? "").trim().toLowerCase();
        if (!platform || !username) continue;
        const k = `${platform}:${username}`;
        const arr = byKey.get(k) ?? [];
        arr.push(r);
        byKey.set(k, arr);
      }

      for (const o of opponentsWithCounts as any[]) {
        const k = `${o.platform}:${String(o.username ?? "").trim().toLowerCase()}`;
        const arr = byKey.get(k) ?? [];
        arr.sort((a, b) => {
          const sr = strengthRank(b?.strength) - strengthRank(a?.strength);
          if (sr !== 0) return sr;
          const ta = String(a?.updated_at ?? "");
          const tb = String(b?.updated_at ?? "");
          return ta < tb ? 1 : ta > tb ? -1 : 0;
        });
        o.style_markers = arr.slice(0, 2).map((m) => ({
          marker_key: String(m?.marker_key ?? ""),
          label: String(m?.label ?? ""),
          strength: String(m?.strength ?? ""),
          tooltip: String(m?.tooltip ?? ""),
        }));
      }
    } catch {}

    return <DashboardPage initialOpponents={opponentsWithCounts as any} />;
  } catch (e) {
    if (e && typeof e === "object") {
      const anyErr = e as any;
      const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
      const digest = typeof anyErr?.digest === "string" ? anyErr.digest : "";
      if (msg === "NEXT_REDIRECT" || digest.startsWith("NEXT_REDIRECT")) {
        throw e;
      }
    }

    const msg = e instanceof Error ? e.message : String(e);
    return (
      <div className="min-h-screen bg-zinc-50">
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-10">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-medium text-zinc-900">Dashboard</div>
            <div className="mt-2 text-sm text-red-600">{msg}</div>
          </div>
        </main>
      </div>
    );
  }
}
