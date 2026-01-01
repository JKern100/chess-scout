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
      <main className="mx-auto flex w-full max-w-5xl flex-col px-6 pt-6">
        <OpponentProfileClient platform={platform} username={username} />
      </main>
    </div>
  );
}
