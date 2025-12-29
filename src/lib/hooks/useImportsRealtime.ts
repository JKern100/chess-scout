"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type ImportRow = {
  id: string;
  profile_id: string;
  target_type: "self" | "opponent";
  platform: "lichess" | "chesscom";
  username: string;
  status: "idle" | "running" | "stopped" | "complete" | "error";
  imported_count: number;
  archived_count?: number | null;
  ready?: boolean | null;
  stage?: string | null;
  last_game_at: string | null;
  cursor_until: string | null;
  newest_game_at?: string | null;
  last_error: string | null;
  updated_at: string;
};

export function useImportsRealtime() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/imports/status", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((json as any)?.error ?? "Failed to load import status"));
      setImports(((json as any)?.imports as ImportRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load import status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let channel: any = null;

    async function start() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled || !user) return;

      channel = supabase
        .channel(`imports:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "imports",
            filter: `profile_id=eq.${user.id}`,
          },
          (payload: any) => {
            if (cancelled) return;
            const row = (payload?.new ?? payload?.old) as ImportRow | null;
            if (!row?.id) return;

            setImports((prev) => {
              const next = [...prev];
              const idx = next.findIndex((r) => r.id === row.id);
              if (payload?.eventType === "DELETE") {
                if (idx >= 0) next.splice(idx, 1);
                return next;
              }

              if (idx >= 0) {
                next[idx] = { ...next[idx], ...row };
              } else {
                next.unshift(row);
              }

              next.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
              return next;
            });
          }
        )
        .subscribe();
    }

    void start();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase]);

  return { imports, loading, error, refresh };
}
