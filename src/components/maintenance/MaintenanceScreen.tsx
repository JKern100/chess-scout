import Link from "next/link";

export function MaintenanceScreen(props: { message?: string | null }) {
  const message = (props.message ?? "").trim();

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-12">
        <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/30">
          <div className="text-sm font-medium tracking-wide text-orange-200">ChessScout</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">We’re upgrading the app</h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-200">
            ChessScout is temporarily unavailable while we roll out improvements to make your scouting faster, more accurate, and more reliable.
          </p>

          {message ? (
            <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-100">
              {message}
            </div>
          ) : null}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium">What’s happening</div>
              <div className="mt-1 text-sm text-zinc-200">
                We’re upgrading our systems and data pipelines to improve report quality and stability.
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium">Check back soon</div>
              <div className="mt-1 text-sm text-zinc-200">
                Please refresh in a little while. Your saved opponents and lines will be waiting.
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-zinc-400">Thanks for your patience — we’ll be back shortly.</div>
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
              >
                Refresh
              </Link>
              <Link
                href="/guide"
                className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
              >
                Product Guide
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-zinc-500">
          If you’re the admin, sign in and you’ll bypass this screen.
        </div>
      </div>
    </div>
  );
}
