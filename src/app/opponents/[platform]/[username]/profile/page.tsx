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

  // Check if this is the user's own profile (self-analysis)
  const { data: profile } = await supabase
    .from("profiles")
    .select("primary_platform, platform_username")
    .eq("id", user.id)
    .maybeSingle();

  const isSelfAnalysis =
    profile?.primary_platform === platform &&
    profile?.platform_username?.toLowerCase() === username.toLowerCase();

  return (
    <div className="min-h-screen">
      <main className="mx-auto flex w-full max-w-5xl flex-col px-6 pt-6">
        <OpponentProfileClient platform={platform} username={username} isSelfAnalysis={isSelfAnalysis} />
      </main>
    </div>
  );
}
