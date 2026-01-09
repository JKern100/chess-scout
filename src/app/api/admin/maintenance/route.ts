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

const KEY_ENABLED = "maintenance_mode_enabled";
const KEY_MESSAGE = "maintenance_mode_message";

function parseBool(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
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
      .select("key, value, updated_at")
      .in("key", [KEY_ENABLED, KEY_MESSAGE]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const byKey = new Map((data ?? []).map((r: any) => [String(r.key), r] as const));
    const enabledRow: any = byKey.get(KEY_ENABLED);
    const messageRow: any = byKey.get(KEY_MESSAGE);

    return NextResponse.json({
      enabled: parseBool(enabledRow?.value),
      message: String(messageRow?.value ?? ""),
      updated_at: (enabledRow?.updated_at ?? messageRow?.updated_at ?? null) as string | null,
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
    const body = (await req.json().catch(() => null)) as { enabled?: unknown; message?: unknown } | null;
    const enabled = Boolean(body?.enabled);
    const message = String(body?.message ?? "");

    const supabase = createSupabaseServiceClient();

    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from("app_settings")
      .upsert(
        [
          { key: KEY_ENABLED, value: enabled ? "true" : "false", updated_at: nowIso },
          { key: KEY_MESSAGE, value: message, updated_at: nowIso },
        ],
        { onConflict: "key" }
      )
      .select("key, value, updated_at");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const byKey = new Map((data ?? []).map((r: any) => [String(r.key), r] as const));
    const enabledRow: any = byKey.get(KEY_ENABLED);
    const messageRow: any = byKey.get(KEY_MESSAGE);

    return NextResponse.json({
      enabled: parseBool(enabledRow?.value),
      message: String(messageRow?.value ?? ""),
      updated_at: (enabledRow?.updated_at ?? messageRow?.updated_at ?? null) as string | null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal server error" }, { status: 500 });
  }
}
