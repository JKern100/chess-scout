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

type RouteContext = { params: Promise<{ userId: string; opponentKey: string }> };

/**
 * DELETE /api/admin/users/[userId]/opponents/[opponentKey]
 * opponentKey is "platform:username" (URL-encoded), e.g. "lichess:fernandoracing"
 *
 * Deletes ALL data for a specific opponent under a user:
 * - games
 * - opening_graph_nodes
 * - opening_graph_examples
 * - opponent_profiles
 * - opponent_style_markers
 * - imports
 * - saved_lines (matching opponent)
 * - synthetic_opponents (matching opening if applicable)
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { userId, opponentKey } = await context.params;
    const decoded = decodeURIComponent(opponentKey);
    const colonIdx = decoded.indexOf(":");
    if (colonIdx < 1) {
      return NextResponse.json(
        { error: "Invalid opponentKey format. Expected 'platform:username'" },
        { status: 400 }
      );
    }
    const platform = decoded.slice(0, colonIdx);
    const username = decoded.slice(colonIdx + 1);

    if (!platform || !username) {
      return NextResponse.json(
        { error: "Missing platform or username in opponentKey" },
        { status: 400 }
      );
    }

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

    // Delete from all related tables in parallel
    const results = await Promise.allSettled([
      service
        .from("games")
        .delete()
        .eq("profile_id", userId)
        .eq("platform", platform)
        .eq("username", username),
      service
        .from("opening_graph_nodes")
        .delete()
        .eq("profile_id", userId)
        .eq("platform", platform)
        .eq("username", username),
      service
        .from("opening_graph_examples")
        .delete()
        .eq("profile_id", userId)
        .eq("platform", platform)
        .eq("username", username),
      service
        .from("opponent_profiles")
        .delete()
        .eq("profile_id", userId)
        .eq("platform", platform)
        .eq("username", username),
      service
        .from("opponent_style_markers")
        .delete()
        .eq("profile_id", userId)
        .eq("platform", platform)
        .eq("username", username),
      service
        .from("imports")
        .delete()
        .eq("profile_id", userId)
        .eq("platform", platform)
        .eq("username", username),
      service
        .from("saved_lines")
        .delete()
        .eq("user_id", userId)
        .eq("opponent_platform", platform)
        .eq("opponent_username", username),
      service
        .from("opponents")
        .delete()
        .eq("user_id", userId)
        .eq("platform", platform)
        .ilike("username", username),
    ]);

    const errors: string[] = [];
    const tableNames = [
      "games",
      "opening_graph_nodes",
      "opening_graph_examples",
      "opponent_profiles",
      "opponent_style_markers",
      "imports",
      "saved_lines",
      "opponents",
    ];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        errors.push(`${tableNames[i]}: ${r.reason}`);
      } else if (r.value?.error) {
        errors.push(`${tableNames[i]}: ${r.value.error.message}`);
      }
    }

    console.log(`[Admin API] Opponent data deleted by ${user.email}:`, {
      userId,
      platform,
      username,
      errors: errors.length > 0 ? errors : "none",
    });

    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        message: `Partial deletion for ${platform}:${username}`,
        errors,
      }, { status: 207 });
    }

    return NextResponse.json({
      success: true,
      message: `All data for opponent "${username}" on ${platform} has been deleted`,
    });
  } catch (err) {
    console.error("[Admin Opponent Delete] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
