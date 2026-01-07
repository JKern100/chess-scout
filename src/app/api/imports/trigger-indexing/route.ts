import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const username = body?.username as string | undefined;
  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  const { data: imp, error: impError } = await supabase
    .from("imports")
    .select("id, status, imported_count, archived_count")
    .eq("profile_id", user.id)
    .eq("target_type", "opponent")
    .eq("platform", "lichess")
    .ilike("username", username)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (impError) {
    return NextResponse.json({ error: impError.message }, { status: 500 });
  }

  if (!imp) {
    return NextResponse.json({ error: "Import not found" }, { status: 404 });
  }

  const imported = typeof imp.imported_count === "number" ? imp.imported_count : 0;
  const indexed = typeof (imp as any)?.archived_count === "number" ? (imp as any).archived_count : 0;

  if (indexed >= imported) {
    return NextResponse.json({ 
      message: "Already fully indexed", 
      imported, 
      indexed 
    });
  }

  // Set status to running to trigger indexing
  const { error: updateError } = await supabase
    .from("imports")
    .update({ status: "running" })
    .eq("id", imp.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ 
    message: "Indexing triggered", 
    importId: imp.id,
    imported,
    indexed,
    needsIndexing: imported - indexed
  });
}
