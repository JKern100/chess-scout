import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardPage } from "@/components/dashboard/DashboardPage";

export const dynamic = "force-dynamic";

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
      .select("platform, username, created_at, last_refreshed_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return (
        <div className="min-h-screen bg-zinc-50">
          <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
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
    }>;

    const opponentsWithCounts = await Promise.all(
      baseOpponents.map(async (o) => {
        const username = String(o.username ?? "").trim();
        const usernameKey = username.toLowerCase();
        const platform = (o.platform === "chesscom" ? "chesscom" : "lichess") as "lichess" | "chesscom";

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

        let eventGamesCount = 0;
        const { count: eventCount0, error: eventCount0Error } = await supabase
          .from("opponent_move_events")
          .select("platform_game_id", { count: "exact", head: true })
          .eq("profile_id", user.id)
          .eq("platform", platform)
          .eq("username", usernameKey)
          .eq("ply", 0);
        if (!eventCount0Error && typeof eventCount0 === "number") {
          eventGamesCount = eventCount0;
        } else {
          const { count: eventCount1, error: eventCount1Error } = await supabase
            .from("opponent_move_events")
            .select("platform_game_id", { count: "exact", head: true })
            .eq("profile_id", user.id)
            .eq("platform", platform)
            .eq("username", usernameKey)
            .eq("ply", 1);
          eventGamesCount = !eventCount1Error && typeof eventCount1 === "number" ? eventCount1 : 0;
        }

        return {
          ...o,
          platform,
          username,
          games_count: Math.max(gamesCount, importedCount, eventGamesCount),
        };
      })
    );

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
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-medium text-zinc-900">Dashboard</div>
            <div className="mt-2 text-sm text-red-600">{msg}</div>
          </div>
        </main>
      </div>
    );
  }
}
