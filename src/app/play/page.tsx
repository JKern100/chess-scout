import Link from "next/link";
import { PlayBoardModes } from "@/components/chess/PlayBoardModes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function PlayPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10 text-[10px]">
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                <span>ChessScout</span>
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                  v1.0
                </span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Play</h1>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Back
            </Link>
          </div>
          <p className="max-w-2xl text-xs leading-5 text-zinc-600">
            Play through lines on a legal-move board. Next we’ll add an engine opponent (Stockfish) and
            then bias early moves toward an opponent’s repertoire.
          </p>
        </header>

        <PlayBoardModes />
      </main>
    </div>
  );
}
