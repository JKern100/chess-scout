import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Admin email(s) - must match useAdminGuard.ts
const ADMIN_EMAILS = [
  process.env.NEXT_PUBLIC_ADMIN_EMAIL,
  "jeff.kern@gmail.com",
].filter(Boolean) as string[];

function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

type RouteContext = { params: Promise<{ userId: string }> };

/**
 * GET /api/admin/users/[userId]
 * Fetch detailed info about a specific user
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { userId } = await context.params;
    const supabase = await createSupabaseServerClient();

    // Verify user is authenticated
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user is admin
    const userEmailNormalized = normalizeEmail(user.email);
    const isAdmin = ADMIN_EMAILS.some(
      (adminEmail) => normalizeEmail(adminEmail) === userEmailNormalized
    );

    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let service: ReturnType<typeof createSupabaseServiceClient>;
    try {
      service = createSupabaseServiceClient();
    } catch {
      return NextResponse.json(
        {
          error:
            "SUPABASE_SERVICE_ROLE_KEY is not set. Admin user details are not available locally due to RLS.",
          needs_service_role: true,
        },
        { status: 409 }
      );
    }

    const { data: authUserResult, error: authUserError } = await service.auth.admin.getUserById(userId);
    if (authUserError || !authUserResult?.user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Profile row is optional (it can be missing if signup/seed didn't create it)
    const { data: profile } = await service
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    // Get counts of related data
    const [gamesCount, importsCount, opponentsCount, markersCount, graphNodesCount, savedLinesCount] = await Promise.all([
      service.from("games").select("id", { count: "exact", head: true }).eq("profile_id", userId),
      service.from("imports").select("id", { count: "exact", head: true }).eq("profile_id", userId),
      service.from("opponent_profiles").select("id", { count: "exact", head: true }).eq("profile_id", userId),
      service.from("opponent_style_markers").select("id", { count: "exact", head: true }).eq("profile_id", userId),
      service.from("opening_graph_nodes").select("id", { count: "exact", head: true }).eq("profile_id", userId),
      service.from("saved_lines").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ]);

    return NextResponse.json({
      user: {
        id: userId,
        displayName:
          profile?.display_name ||
          profile?.platform_username ||
          (authUserResult.user.email ? String(authUserResult.user.email).split("@")[0] : "Unknown"),
        email: null,
        platform: profile?.primary_platform || "unknown",
        platformUsername: profile?.platform_username || "",
        createdAt: (profile?.created_at ?? authUserResult.user.created_at) as string | null,
        lastActive: (profile?.last_active ?? null) as string | null,
        onboardingCompleted: Boolean(profile?.onboarding_completed),
        metrics: {
          opponentsScouted: profile?.opponents_scouted || 0,
          reportsGenerated: profile?.reports_generated || 0,
          simulationsRun: profile?.simulations_run || 0,
          totalTimeSpentMinutes: profile?.total_session_minutes || 0,
        },
      },
      relatedDataCounts: {
        games: gamesCount.count || 0,
        imports: importsCount.count || 0,
        opponentProfiles: opponentsCount.count || 0,
        styleMarkers: markersCount.count || 0,
        openingGraphNodes: graphNodesCount.count || 0,
        savedLines: savedLinesCount.count || 0,
      },
    });
  } catch (err) {
    console.error("[Admin API] Error fetching user details:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/users/[userId]
 * Delete a user and all their associated data (cascade delete via FK constraints)
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { userId } = await context.params;
    const supabase = await createSupabaseServerClient();

    // Verify user is authenticated
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user is admin
    const userEmailNormalized = normalizeEmail(user.email);
    const isAdmin = ADMIN_EMAILS.some(
      (adminEmail) => normalizeEmail(adminEmail) === userEmailNormalized
    );

    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Prevent admin from deleting themselves
    if (userId === user.id) {
      return NextResponse.json(
        { error: "Cannot delete your own admin account" },
        { status: 400 }
      );
    }

    let service: ReturnType<typeof createSupabaseServiceClient>;
    try {
      service = createSupabaseServiceClient();
    } catch {
      return NextResponse.json(
        {
          error:
            "SUPABASE_SERVICE_ROLE_KEY is not set. Admin user deletion is not available locally due to RLS.",
          needs_service_role: true,
        },
        { status: 409 }
      );
    }

    const { data: authUserResult, error: authUserError } = await service.auth.admin.getUserById(userId);
    if (authUserError || !authUserResult?.user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Profile is optional
    const { data: profile } = await service
      .from("profiles")
      .select("display_name, platform_username, primary_platform")
      .eq("id", userId)
      .maybeSingle();

    const userName =
      profile?.display_name ||
      profile?.platform_username ||
      (authUserResult.user.email ? String(authUserResult.user.email) : userId);

    // Get counts of data that will be deleted (for confirmation/logging)
    const [gamesCount, importsCount, opponentsCount, markersCount, graphNodesCount, graphExamplesCount, savedLinesCount] = await Promise.all([
      service.from("games").select("id", { count: "exact", head: true }).eq("profile_id", userId),
      service.from("imports").select("id", { count: "exact", head: true }).eq("profile_id", userId),
      service.from("opponent_profiles").select("id", { count: "exact", head: true }).eq("profile_id", userId),
      service.from("opponent_style_markers").select("id", { count: "exact", head: true }).eq("profile_id", userId),
      service.from("opening_graph_nodes").select("id", { count: "exact", head: true }).eq("profile_id", userId),
      service.from("opening_graph_examples").select("id", { count: "exact", head: true }).eq("profile_id", userId),
      service.from("saved_lines").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ]);

    const deletedCounts = {
      games: gamesCount.count || 0,
      imports: importsCount.count || 0,
      opponentProfiles: opponentsCount.count || 0,
      styleMarkers: markersCount.count || 0,
      openingGraphNodes: graphNodesCount.count || 0,
      openingGraphExamples: graphExamplesCount.count || 0,
      savedLines: savedLinesCount.count || 0,
    };

    // Delete the user from auth.users - this will cascade to all related tables
    // due to ON DELETE CASCADE foreign key constraints
    const { error: deleteError } = await service.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error("[Admin API] Error deleting user:", deleteError);
      return NextResponse.json(
        { error: `Failed to delete user: ${deleteError.message}` },
        { status: 500 }
      );
    }

    console.log(`[Admin API] User deleted by ${user.email}:`, {
      deletedUserId: userId,
      deletedUserName: userName,
      deletedCounts,
    });

    return NextResponse.json({
      success: true,
      message: `User "${userName}" and all associated data have been deleted`,
      deletedCounts,
    });
  } catch (err) {
    console.error("[Admin API] Unexpected error deleting user:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
