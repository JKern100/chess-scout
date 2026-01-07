import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Admin email(s) - must match useAdminGuard.ts
const ADMIN_EMAILS = [
  process.env.NEXT_PUBLIC_ADMIN_EMAIL,
  "jeff.kern@gmail.com",
].filter(Boolean) as string[];

function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

export async function GET() {
  try {
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

    // Fetch all users with their metrics
    // Using service role would be ideal, but for now we query profiles directly
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select(`
        id,
        display_name,
        primary_platform,
        platform_username,
        created_at,
        last_active,
        opponents_scouted,
        reports_generated,
        simulations_run,
        total_session_minutes,
        onboarding_completed
      `)
      .order("last_active", { ascending: false, nullsFirst: false });

    if (profilesError) {
      console.error("[Admin API] Error fetching profiles:", profilesError);
      return NextResponse.json(
        { error: "Failed to fetch users" },
        { status: 500 }
      );
    }

    // Transform data for the admin dashboard
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const users = (profiles || []).map((p) => {
      const lastActive = p.last_active ? new Date(p.last_active) : null;
      let status: "online" | "idle" | "offline" | "churning" = "offline";

      if (lastActive) {
        const hoursSinceActive = (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60);
        if (hoursSinceActive < 0.5) {
          status = "online";
        } else if (hoursSinceActive < 24) {
          status = "idle";
        } else if (hoursSinceActive > 24 * 7) {
          status = "churning";
        }
      }

      return {
        id: p.id,
        displayName: p.display_name || p.platform_username || "Unknown",
        email: null, // Don't expose emails for privacy
        platform: p.primary_platform || "unknown",
        platformUsername: p.platform_username || "",
        createdAt: p.created_at,
        lastActive: p.last_active,
        status,
        metrics: {
          opponentsScouted: p.opponents_scouted || 0,
          reportsGenerated: p.reports_generated || 0,
          simulationsRun: p.simulations_run || 0,
          totalTimeSpentMinutes: p.total_session_minutes || 0,
        },
        onboardingCompleted: p.onboarding_completed || false,
      };
    });

    // Calculate global stats
    const activeToday = users.filter(
      (u) => u.lastActive && new Date(u.lastActive) > oneDayAgo
    ).length;
    const activeWeek = users.filter(
      (u) => u.lastActive && new Date(u.lastActive) > oneWeekAgo
    ).length;

    const totalScouts = users.reduce((sum, u) => sum + u.metrics.opponentsScouted, 0);
    const totalReports = users.reduce((sum, u) => sum + u.metrics.reportsGenerated, 0);
    const totalSimulations = users.reduce((sum, u) => sum + u.metrics.simulationsRun, 0);
    const totalTime = users.reduce((sum, u) => sum + u.metrics.totalTimeSpentMinutes, 0);

    const avgSessionDuration = users.length > 0 ? Math.round(totalTime / users.length) : 0;
    const scoutToSimConversion = totalScouts > 0 ? Math.round((totalSimulations / totalScouts) * 100) : 0;
    const churnRiskCount = users.filter((u) => u.status === "churning").length;

    const globalStats = {
      totalUsers: users.length,
      activeUsersToday: activeToday,
      activeUsersWeek: activeWeek,
      totalScouts,
      totalReports,
      totalSimulations,
      avgSessionDuration,
      scoutToSimConversion,
      churnRiskCount,
    };

    return NextResponse.json({
      users,
      globalStats,
      fetchedAt: now.toISOString(),
    });
  } catch (err) {
    console.error("[Admin API] Unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
