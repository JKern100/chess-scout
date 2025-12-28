import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardPage } from "@/components/dashboard/DashboardPage";

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

    return <DashboardPage initialOpponents={(data ?? []) as any} />;
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
