import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const ADMIN_EMAILS = [process.env.NEXT_PUBLIC_ADMIN_EMAIL, "jeff.kern@gmail.com"].filter(Boolean) as string[];

function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

async function assertAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    return { ok: false as const, status: 401 as const, message: "Unauthorized" };
  }

  const userEmailNormalized = normalizeEmail(user.email);
  const isAdmin = ADMIN_EMAILS.some((adminEmail) => normalizeEmail(adminEmail) === userEmailNormalized);

  if (!isAdmin) {
    return { ok: false as const, status: 403 as const, message: "Forbidden" };
  }

  return { ok: true as const };
}

export async function GET() {
  const guard = await assertAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.message }, { status: guard.status });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", "ai_system_instruction")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      value: String((data as any)?.value ?? ""),
      updated_at: (data as any)?.updated_at ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const guard = await assertAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.message }, { status: guard.status });
  }

  try {
    const body = (await req.json().catch(() => null)) as { value?: unknown } | null;
    const value = String(body?.value ?? "");

    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("app_settings")
      .upsert(
        {
          key: "ai_system_instruction",
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      )
      .select("value, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      value: String((data as any)?.value ?? ""),
      updated_at: (data as any)?.updated_at ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal server error" }, { status: 500 });
  }
}
