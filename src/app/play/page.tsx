import Link from "next/link";
import { PlayBoard } from "@/components/chess/PlayBoard";

export default function PlayPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-600">
                <span>ChessScout</span>
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                  v1.0
                </span>
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Play</h1>
            </div>
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Back
            </Link>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600">
            Play through lines on a legal-move board. Next we’ll add an engine opponent (Stockfish) and
            then bias early moves toward an opponent’s repertoire.
          </p>
        </header>

        <PlayBoard />
      </main>
    </div>
  );
}
