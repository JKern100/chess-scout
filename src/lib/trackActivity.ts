import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Activity types that can be tracked in the admin dashboard.
 */
export type ActivityType =
  | "session_start"
  | "opponent_scouted"
  | "report_generated"
  | "simulation_run"
  | "page_view";

/**
 * Track user activity for admin dashboard metrics.
 * Updates the user's profile with activity counts and timestamps.
 *
 * @param actionType - The type of activity to track
 * @param metadata - Optional additional data about the activity
 */
export async function trackActivity(
  actionType: ActivityType,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = createSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      console.log("[trackActivity] No authenticated user, skipping");
      return;
    }

    const now = new Date().toISOString();

    // Build the update payload based on action type
    const updates: Record<string, unknown> = {
      last_active: now,
    };

    switch (actionType) {
      case "session_start":
        // Just update last_active timestamp
        break;

      case "opponent_scouted":
        // Increment opponents_scouted counter
        // Using raw SQL increment via RPC would be ideal, but for now we'll use a simple approach
        const { data: currentProfile } = await supabase
          .from("profiles")
          .select("opponents_scouted")
          .eq("id", user.id)
          .single();
        
        updates.opponents_scouted = (currentProfile?.opponents_scouted || 0) + 1;
        break;

      case "report_generated":
        // Increment reports_generated counter
        const { data: profileForReports } = await supabase
          .from("profiles")
          .select("reports_generated")
          .eq("id", user.id)
          .single();
        
        updates.reports_generated = (profileForReports?.reports_generated || 0) + 1;
        break;

      case "simulation_run":
        // Increment simulations_run counter
        const { data: profileForSims } = await supabase
          .from("profiles")
          .select("simulations_run")
          .eq("id", user.id)
          .single();
        
        updates.simulations_run = (profileForSims?.simulations_run || 0) + 1;
        break;

      case "page_view":
        // Just update last_active for page views
        break;
    }

    // Update the profile with the new metrics
    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id);

    if (error) {
      console.error("[trackActivity] Error updating profile:", error);
    }

    // Also log to activity_events table for admin analytics (best-effort)
    supabase
      .from("activity_events")
      .insert({
        profile_id: user.id,
        event_type: actionType,
        metadata: metadata ? metadata : null,
      })
      .then(({ error: evtErr }) => {
        if (evtErr) {
          // Table may not exist yet — silently ignore
        }
      });
  } catch (err) {
    console.error("[trackActivity] Failed to track activity:", err);
  }
}

/**
 * Track session duration using periodic heartbeats.
 * Call this when the user's session starts and it will send heartbeats.
 *
 * @returns cleanup function to stop tracking
 */
export function startSessionTracking(): () => void {
  const HEARTBEAT_INTERVAL = 60000; // 1 minute

  let intervalId: NodeJS.Timeout | null = null;
  let sessionStartTime = Date.now();

  // Initial activity track
  trackActivity("session_start");

  // Set up periodic heartbeat
  intervalId = setInterval(() => {
    trackActivity("session_start");
  }, HEARTBEAT_INTERVAL);

  // Track session end on page unload
  const handleBeforeUnload = async () => {
    const sessionDurationMinutes = Math.round((Date.now() - sessionStartTime) / 60000);
    
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user?.id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("total_session_minutes")
          .eq("id", user.id)
          .single();

        await supabase
          .from("profiles")
          .update({
            total_session_minutes: (profile?.total_session_minutes || 0) + sessionDurationMinutes,
            last_active: new Date().toISOString(),
          })
          .eq("id", user.id);
      }
    } catch {
      // Can't do much on unload errors
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", handleBeforeUnload);
  }

  // Return cleanup function
  return () => {
    if (intervalId) {
      clearInterval(intervalId);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    }
  };
}
