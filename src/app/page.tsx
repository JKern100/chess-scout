import { AuthPanel } from "@/components/auth/AuthPanel";
import { ImportPanel } from "@/components/imports/ImportPanel";
import { ConnectAccountPanel } from "@/components/profile/ConnectAccountPanel";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("id, chess_platform, chess_username, is_pro, analyses_remaining")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-3">
          <div className="text-sm font-medium text-zinc-600">ChessScout</div>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900">
            Prepare for opponents with Lichess-based scouting reports
          </h1>
          <p className="max-w-2xl text-base leading-7 text-zinc-600">
            Connect your account, enter an opponent’s Lichess username, and get a focused
            strategy brief based on their recent games.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-medium text-zinc-900">Get started</div>
            <div className="mt-2 text-sm text-zinc-600">
              Sign in with an email magic link.
            </div>
            <div className="mt-5">
              <AuthPanel userEmail={user?.email} />
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-medium text-zinc-900">MVP roadmap</div>
            <div className="mt-4 grid gap-3 text-sm text-zinc-700">
              <div>
                <span className="font-medium text-zinc-900">1.</span> Save your chess username to
                your profile.
              </div>
              <div>
                <span className="font-medium text-zinc-900">2.</span> Fetch last 50 games via the
                Lichess API.
              </div>
              <div>
                <span className="font-medium text-zinc-900">3.</span> Generate a report: openings,
                tendencies, time trouble, endgames.
              </div>
            </div>
          </div>
        </section>

        {user ? (
          <section>
            <ConnectAccountPanel initialProfile={profile as any} />
          </section>
        ) : null}

        {user ? (
          <section>
            <ImportPanel
              selfPlatform={(profile as any)?.chess_platform ?? null}
              selfUsername={(profile as any)?.chess_username ?? null}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}
