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

    // Verify user is authenticated and admin
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userEmailNormalized = normalizeEmail(user.email);
    const isAdmin = ADMIN_EMAILS.some(
      (adminEmail) => normalizeEmail(adminEmail) === userEmailNormalized
    );

    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch minimal fields to check existence and ordering
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, display_name, platform_username, created_at, last_active")
      .order("last_active", { ascending: false, nullsFirst: false });

    if (error) {
      console.error("[Admin Debug] Error fetching profiles:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Also fetch total count
    const { count, error: countError } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });

    if (countError) {
      console.error("[Admin Debug] Error counting profiles:", countError);
    }

    return NextResponse.json({
      totalRows: count ?? null,
      rows: profiles ?? [],
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Admin Debug] Unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
