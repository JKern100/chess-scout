import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const ADMIN_EMAILS = [
  process.env.NEXT_PUBLIC_ADMIN_EMAIL,
  "jeff.kern@gmail.com",
].filter(Boolean) as string[];

function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

type RouteContext = { params: Promise<{ userId: string }> };

/**
 * GET /api/admin/users/[userId]/opponents
 * List all opponents (imported accounts) for a user with data counts per opponent.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { userId } = await context.params;
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = ADMIN_EMAILS.some(
      (e) => normalizeEmail(e) === normalizeEmail(user.email)
    );
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let service: ReturnType<typeof createSupabaseServiceClient>;
    try {
      service = createSupabaseServiceClient();
    } catch {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY required" },
        { status: 409 }
      );
    }

    // Get all distinct opponents from imports table
    const { data: imports, error: importsErr } = await service
      .from("imports")
      .select("id, platform, username, target_type, imported_count, status, created_at, updated_at")
      .eq("profile_id", userId)
      .order("updated_at", { ascending: false });

    if (importsErr) {
      return NextResponse.json({ error: importsErr.message }, { status: 500 });
    }

    // For each unique opponent, get counts from related tables
    const opponentMap = new Map<string, {
      platform: string;
      username: string;
      targetType: string;
      importId: string;
      importedCount: number;
      status: string;
      lastImportAt: string;
      games: number;
      graphNodes: number;
      graphExamples: number;
      opponentProfiles: number;
      styleMarkers: number;
    }>();

    for (const imp of imports ?? []) {
      const key = `${imp.platform}:${imp.username}`;
      if (opponentMap.has(key)) continue;

      const username = imp.username;
      const platform = imp.platform;

      // Count related data for this specific opponent
      const [gamesRes, nodesRes, examplesRes, profilesRes, markersRes] = await Promise.all([
        service
          .from("games")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", userId)
          .eq("platform", platform)
          .eq("username", username),
        service
          .from("opening_graph_nodes")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", userId)
          .eq("platform", platform)
          .eq("username", username),
        service
          .from("opening_graph_examples")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", userId)
          .eq("platform", platform)
          .eq("username", username),
        service
          .from("opponent_profiles")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", userId)
          .eq("platform", platform)
          .eq("username", username),
        service
          .from("opponent_style_markers")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", userId)
          .eq("platform", platform)
          .eq("username", username),
      ]);

      opponentMap.set(key, {
        platform,
        username,
        targetType: imp.target_type ?? "opponent",
        importId: imp.id,
        importedCount: imp.imported_count ?? 0,
        status: imp.status ?? "unknown",
        lastImportAt: imp.updated_at ?? imp.created_at ?? "",
        games: gamesRes.count ?? 0,
        graphNodes: nodesRes.count ?? 0,
        graphExamples: examplesRes.count ?? 0,
        opponentProfiles: profilesRes.count ?? 0,
        styleMarkers: markersRes.count ?? 0,
      });
    }

    const opponents = Array.from(opponentMap.values()).sort((a, b) => {
      // Sort by most data first
      const aTotal = a.games + a.graphNodes + a.graphExamples;
      const bTotal = b.games + b.graphNodes + b.graphExamples;
      return bTotal - aTotal;
    });

    return NextResponse.json({ opponents });
  } catch (err) {
    console.error("[Admin Opponents] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
