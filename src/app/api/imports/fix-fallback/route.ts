import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST /api/imports/fix-fallback
 * 
 * Fix incomplete imports that stopped due to low fallback limits.
 * Updates the fallback limit and resets status to allow continuation.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const username = String(body?.username ?? "").trim().toLowerCase();

    if (!username) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    // Find the import for this opponent
    const { data: imports, error: findErr } = await supabase
      .from("imports")
      .select("*")
      .eq("profile_id", user.id)
      .eq("platform", "lichess")
      .eq("target_type", "opponent")
      .ilike("username", username)
      .order("created_at", { ascending: false })
      .limit(1);

    if (findErr) throw findErr;

    if (!imports || imports.length === 0) {
      return NextResponse.json({ error: "Import not found" }, { status: 404 });
    }

    const imp = imports[0];

    // Update the fallback limit and reset status to allow continuation
    const { data: updated, error: updateErr } = await supabase
      .from("imports")
      .update({
        scout_base_fallback_limit: 5000,
        status: "running",
        last_error: null,
      })
      .eq("id", imp.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Trigger a continue call to start indexing
    try {
      const continueRes = await fetch(`${req.nextUrl.origin}/api/imports/lichess/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import_id: imp.id }),
      });
      
      if (!continueRes.ok) {
        console.warn("[fix-fallback] Continue call failed:", continueRes.status);
      }
    } catch (continueErr) {
      console.warn("[fix-fallback] Failed to trigger continue:", continueErr);
    }

    return NextResponse.json({
      message: "Import fixed and indexing triggered",
      import: updated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal Server Error";
    console.error("[fix-fallback] Error:", msg, err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
