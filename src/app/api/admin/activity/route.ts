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

/**
 * GET /api/admin/activity?days=30
 * Returns daily activity counts for the admin dashboard chart.
 */
export async function GET(request: Request) {
  try {
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

    const url = new URL(request.url);
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Daily active users: count distinct profile_id per day from activity_events
    const { data: dailyEvents, error: eventsErr } = await service
      .from("activity_events")
      .select("profile_id, created_at, event_type")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true });

    if (eventsErr) {
      // Table might not exist yet — fall back to profile-based approximation
      console.warn("[Admin Activity] activity_events query failed:", eventsErr.message);
      return NextResponse.json({ dailyActivity: [], eventBreakdown: [], source: "unavailable" });
    }

    // Aggregate by day
    const dayMap = new Map<string, Set<string>>();
    const eventCounts = new Map<string, number>();

    for (const row of dailyEvents ?? []) {
      const day = new Date(row.created_at).toISOString().slice(0, 10);
      if (!dayMap.has(day)) dayMap.set(day, new Set());
      dayMap.get(day)!.add(row.profile_id);

      const et = row.event_type ?? "unknown";
      eventCounts.set(et, (eventCounts.get(et) ?? 0) + 1);
    }

    // Fill in missing days with 0
    const dailyActivity: Array<{ date: string; activeUsers: number; events: number }> = [];
    const cursor = new Date(since);
    const today = new Date();
    while (cursor <= today) {
      const day = cursor.toISOString().slice(0, 10);
      const users = dayMap.get(day);
      // Count events for this day
      const dayEvents = (dailyEvents ?? []).filter(
        (e) => new Date(e.created_at).toISOString().slice(0, 10) === day
      );
      dailyActivity.push({
        date: day,
        activeUsers: users?.size ?? 0,
        events: dayEvents.length,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    const eventBreakdown = Array.from(eventCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      dailyActivity,
      eventBreakdown,
      totalEvents: dailyEvents?.length ?? 0,
      source: "activity_events",
    });
  } catch (err) {
    console.error("[Admin Activity] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
