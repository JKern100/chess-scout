"use client";

import { useEffect, useRef } from "react";

type ImportRow = {
  id: string;
  platform: "lichess" | "chesscom";
  username: string;
  status: "idle" | "running" | "stopped" | "complete" | "error";
  target_type?: "self" | "opponent";
  imported_count?: number | null;
  archived_count?: number | null;
};

export function ImportSupervisor() {
  const inflight = useRef<Map<string, number>>(new Map());
  const stopped = useRef(false);
  const lastLogAt = useRef(0);
  const lastSeenRunning = useRef<string>("");
  const globalContinueInFlight = useRef(false);
  const backoffUntilMs = useRef(0);
  const backoffMs = useRef(0);

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    const INFIGHT_TTL_MS = 60_000;

    function isInflight(importId: string) {
      const startedAt = inflight.current.get(importId);
      if (!startedAt) return false;
      if (Date.now() - startedAt > INFIGHT_TTL_MS) {
        inflight.current.delete(importId);
        return false;
      }
      return true;
    }

    async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number) {
      const controller = new AbortController();
      const id = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(input, { ...(init ?? {}), signal: controller.signal });
      } finally {
        window.clearTimeout(id);
      }
    }

    async function tick() {
      if (stopped.current) return;

      const now0 = Date.now();
      if (now0 < backoffUntilMs.current) return;

      // Avoid doing work in fully backgrounded tabs.
      if (false && typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      const imports = await (async () => {
        const res = await fetchWithTimeout("/api/imports/status", { cache: "no-store" }, 10_000).catch(() => null);
        if (!res) return [];

        // If the user is logged out / session expired, avoid hammering the endpoint.
        if (res.status === 401) {
          backoffMs.current = 60_000;
          backoffUntilMs.current = Date.now() + backoffMs.current;
          lastSeenRunning.current = "";
          const now = Date.now();
          if (now - lastLogAt.current > 5000) {
            lastLogAt.current = now;
            console.warn("[ImportSupervisor] status fetch failed", res.status, "Unauthorized");
          }
          return [];
        }

        if (!res.ok) {
          const now = Date.now();
          if (now - lastLogAt.current > 5000) {
            lastLogAt.current = now;
            let detail = "";
            try {
              const text = await res.text();
              try {
                const json = JSON.parse(text) as any;
                detail = String(json?.error ?? json?.message ?? text);
              } catch {
                detail = text;
              }
            } catch {
              detail = "";
            }
            console.warn("[ImportSupervisor] status fetch failed", res.status, detail);
          }
          return [];
        }

        const json = await res.json().catch(() => ({}));
        const arr = Array.isArray((json as any)?.imports) ? ((json as any).imports as ImportRow[]) : [];
        return arr;
      })();
      if (stopped.current) return;

      // Handle "self" imports that are running
      const runningSelf = imports.filter((i) => i?.status === "running" && i?.platform === "lichess" && i?.id && i?.target_type === "self");
      
      // Also handle opponent imports that need indexing (archived_count < imported_count)
      const needsIndexing = imports.filter((i) => {
        if (i?.platform !== "lichess" || !i?.id || i?.target_type !== "opponent") return false;
        const imported = typeof (i as any)?.imported_count === "number" ? (i as any).imported_count : 0;
        const indexed = typeof (i as any)?.archived_count === "number" ? (i as any).archived_count : 0;
        const needs = imported > 0 && indexed < imported;
        if (needs) {
          const now = Date.now();
          if (now - lastLogAt.current > 10000) {
            lastLogAt.current = now;
            console.log("[ImportSupervisor] Opponent needs indexing:", (i as any)?.username, "imported:", imported, "indexed:", indexed);
          }
        }
        return needs;
      });
      
      const running = [...runningSelf, ...needsIndexing];

      if (running.length === 0) {
        const now = Date.now();
        if (now - lastLogAt.current > 5000 && lastSeenRunning.current) {
          lastLogAt.current = now;
          console.warn("[ImportSupervisor] no running imports detected (previously running)");
          lastSeenRunning.current = "";
        }
      } else {
        lastSeenRunning.current = running.map((r) => r.id).join(",");
      }

      for (const imp of running) {
        if (isInflight(imp.id)) continue;
        if (globalContinueInFlight.current) break;
        inflight.current.set(imp.id, Date.now());
        globalContinueInFlight.current = true;
        const isOpponent = imp.target_type === "opponent";
        const endpoint = isOpponent ? "/api/imports/reindex" : "/api/imports/lichess/continue";
        const body = isOpponent
          ? JSON.stringify({ platform: imp.platform, username: imp.username, batch_size: 500 })
          : JSON.stringify({ import_id: imp.id });

        void fetchWithTimeout(
          endpoint,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          },
          30_000
        )
          .then(async (res) => {
            if (!res) return;

            if (res.ok) {
              backoffMs.current = 0;
              backoffUntilMs.current = 0;
              return;
            }

            let detail = "";
            try {
              const text = await res.text();
              try {
                const json = JSON.parse(text) as any;
                detail = String(json?.error ?? json?.message ?? text);
              } catch {
                detail = text;
              }
            } catch {
              detail = "";
            }

            // Always back off on 429, even if we throttle logs.
            if (res.status === 429) {
              const next = backoffMs.current ? Math.min(60_000, backoffMs.current * 2) : 4000;
              backoffMs.current = next;
              backoffUntilMs.current = Date.now() + next;
            }

            const now = Date.now();
            if (now - lastLogAt.current > 5000) {
              lastLogAt.current = now;
              console.warn("[ImportSupervisor] continue failed", res.status, detail);
            }
          })
          .catch(() => {
            const now = Date.now();
            if (now - lastLogAt.current > 5000) {
              lastLogAt.current = now;
              console.warn("[ImportSupervisor] continue request errored");
            }
          })
          .finally(() => {
            inflight.current.delete(imp.id);
            globalContinueInFlight.current = false;
            // Successful/clean completion should relax backoff.
            if (Date.now() >= backoffUntilMs.current) {
              backoffMs.current = 0;
            }
          });

        // Only run one continue per tick.
        break;
      }
    }

    // Kick immediately and then poll.
    void tick();
    timer = window.setInterval(() => {
      void tick();
    }, 2000);

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return null;
}
