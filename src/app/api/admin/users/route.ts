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

    // Fetch all registered users.
    // Prefer service role to list auth.users + join profiles for metrics.
    // If service role env vars are missing (common in local dev), fall back to the cookie-authenticated client,
    // which will likely only return the current admin due to RLS.
    let warning: string | null = null;
    let serviceRoleAvailable = true;
    let authUsers: Array<{ id: string; email: string | null; created_at: string | null }> = [];
    let profiles: any[] = [];

    try {
      const service = createSupabaseServiceClient();
      const { data: authData, error: authErr } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (authErr) throw authErr;

      authUsers = (authData?.users ?? []).map((u: any) => ({
        id: String(u?.id ?? ""),
        email: typeof u?.email === "string" ? u.email : null,
        created_at: typeof u?.created_at === "string" ? u.created_at : null,
      })).filter((u) => Boolean(u.id));

      const ids = authUsers.map((u) => u.id);
      if (ids.length > 0) {
        const result = await service
          .from("profiles")
          .select(
            "id, display_name, primary_platform, platform_username, created_at, last_active, opponents_scouted, reports_generated, simulations_run, total_session_minutes, onboarding_completed"
          )
          .in("id", ids);
        if (result.error) throw result.error;
        profiles = (result.data as any[]) ?? [];
      }
    } catch (err) {
      serviceRoleAvailable = false;
      warning = "SUPABASE_SERVICE_ROLE_KEY is not set. Admin user list is limited by RLS and may be incomplete.";

      const result = await supabase
        .from("profiles")
        .select(
          "id, display_name, primary_platform, platform_username, created_at, last_active, opponents_scouted, reports_generated, simulations_run, total_session_minutes, onboarding_completed"
        )
        .order("last_active", { ascending: false, nullsFirst: false });
      profiles = (result.data as any[]) ?? [];

      // Best-effort: only the current user is reliably visible under RLS.
      authUsers = profiles.map((p: any) => ({
        id: String(p?.id ?? ""),
        email: null,
        created_at: typeof p?.created_at === "string" ? p.created_at : null,
      })).filter((u) => Boolean(u.id));
    }

    // Transform data for the admin dashboard
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const profileById = new Map<string, any>();
    for (const p of profiles) {
      const id = String(p?.id ?? "");
      if (id) profileById.set(id, p);
    }

    const users = (authUsers || []).map((au) => {
      const p = profileById.get(au.id) ?? null;
      const lastActive = p?.last_active ? new Date(p.last_active) : null;
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
        id: au.id,
        displayName:
          p?.display_name ||
          p?.platform_username ||
          (au.email ? String(au.email).split("@")[0] : "Unknown"),
        email: null, // Don't expose emails for privacy
        platform: p?.primary_platform || "unknown",
        platformUsername: p?.platform_username || "",
        createdAt: p?.created_at || au.created_at || new Date().toISOString(),
        lastActive: p?.last_active ?? null,
        status,
        metrics: {
          opponentsScouted: p?.opponents_scouted || 0,
          reportsGenerated: p?.reports_generated || 0,
          simulationsRun: p?.simulations_run || 0,
          totalTimeSpentMinutes: p?.total_session_minutes || 0,
        },
        onboardingCompleted: p?.onboarding_completed || false,
      };
    });

    // Sort newest activity first (stable for missing lastActive)
    users.sort((a, b) => {
      const aTime = a.lastActive ? new Date(a.lastActive).getTime() : 0;
      const bTime = b.lastActive ? new Date(b.lastActive).getTime() : 0;
      return bTime - aTime;
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
      warning,
      serviceRoleAvailable,
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
