import { PlayBoardModes } from "@/components/chess/PlayBoardModes";
import { PlayModeToggle } from "@/components/chess/PlayModeToggle";
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
    <div className="min-h-screen">
      <main className="mx-auto flex w-full max-w-none flex-col gap-4 p-2 text-[10px] sm:px-6 sm:pt-6">
        <div className="flex items-center">
          <PlayModeToggle />
        </div>

        <PlayBoardModes />
      </main>
    </div>
  );
}
