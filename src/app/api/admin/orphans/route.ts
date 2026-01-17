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

type OrphanCheckResult = {
  table: string;
  key: string;
  orphanCount: number;
};

function toInList(ids: string[]): string {
  // PostgREST expects: ("id1","id2")
  const escaped = ids.map((id) => `"${id.replaceAll('"', '""')}"`);
  return `(${escaped.join(",")})`;
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();

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

    const service = createSupabaseServiceClient();

    // Fetch all auth user ids
    const { data: authData, error: authErr } = await service.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 500 });
    }

    const authUserIds = (authData?.users ?? [])
      .map((u: any) => String(u?.id ?? ""))
      .filter(Boolean);

    if (authUserIds.length === 0) {
      return NextResponse.json({ results: [] satisfies OrphanCheckResult[] });
    }

    const inList = toInList(authUserIds);

    const checks: Array<{ table: string; key: string }> = [
      { table: "profiles", key: "id" },
      { table: "games", key: "profile_id" },
      { table: "imports", key: "profile_id" },
      { table: "opponent_profiles", key: "profile_id" },
      { table: "opponent_style_markers", key: "profile_id" },
      { table: "opening_graph_nodes", key: "profile_id" },
      { table: "opening_graph_examples", key: "profile_id" },
      { table: "saved_lines", key: "user_id" },
    ];

    const results: OrphanCheckResult[] = [];

    for (const c of checks) {
      const { count, error } = await service
        .from(c.table)
        .select(c.key, { count: "exact", head: true })
        .not(c.key, "in", inList);

      if (error) {
        results.push({ table: c.table, key: c.key, orphanCount: -1 });
        continue;
      }

      results.push({ table: c.table, key: c.key, orphanCount: count ?? 0 });
    }

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
