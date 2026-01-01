import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OpponentProfileClient } from "@/components/profile/OpponentProfileClient";

type ChessPlatform = "lichess" | "chesscom";

type Params = {
  platform: string;
  username: string;
};

export default async function OpponentProfilePage({ params }: { params: Promise<Params> }) {
  const resolvedParams = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const platform =
    resolvedParams.platform === "lichess" || resolvedParams.platform === "chesscom"
      ? (resolvedParams.platform as ChessPlatform)
      : null;
  const username = String(resolvedParams.username ?? "");

  if (!platform || !username.trim()) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-zinc-600">ChessScout</div>
            <div className="mt-1 text-sm font-medium text-zinc-900">Scout Report</div>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Back
          </Link>
        </header>

        <OpponentProfileClient platform={platform} username={username} />
      </main>
    </div>
  );
}
