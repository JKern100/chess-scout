import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeFen } from "@/server/opponentModel";

type WorkerFlushNode = {
  filter_key: string;
  fen: string;
  played_by: {
    opponent: Record<string, any>;
    against: Record<string, any>;
  };
};

type WorkerFlushEvent = {
  platform_game_id: string;
  played_at: string | null;
  speed: string | null;
  rated: boolean | null;
  fen: string;
  uci: string;
  san: string | null;
  ply: number;
  is_opponent_move: boolean;
  win: number;
  loss: number;
  draw: number;
};

type WorkerMessage =
  | { type: "progress"; gamesProcessed: number; bytesRead: number; status: "running" | "done" | "stopped"; lastError?: string | null }
  | { type: "flush"; nodes: WorkerFlushNode[]; events: WorkerFlushEvent[]; gamesProcessed: number }
  | { type: "done"; gamesProcessed: number };

export type OpeningGraphImportStatus = {
  phase: "idle" | "running" | "done" | "error";
  gamesProcessed: number;
  bytesRead: number;
  lastError: string | null;
};

export type OpeningGraphImportParams = {
  platform: "lichess";
  username: string;
  color?: "white" | "black" | "both";
  opponentUsername?: string;
  sinceMs?: number;
  untilMs?: number;
  rated?: "any" | "rated" | "casual";
  perfType?: string | null;
};

export function createOpeningGraphImporter(params: {
  onStatus: (s: OpeningGraphImportStatus) => void;
}) {
  const supabase = createSupabaseBrowserClient();
  const { onStatus } = params;

  let worker: Worker | null = null;
  let stopped = false;
  let status: OpeningGraphImportStatus = { phase: "idle", gamesProcessed: 0, bytesRead: 0, lastError: null };

  let profileId: string | null = null;
  let writeDisabled = false;

  let writeQueue: Promise<void> = Promise.resolve();

  async function upsertNodes(platform: string, username: string, nodes: WorkerFlushNode[]) {
    if (nodes.length === 0) return;
    if (writeDisabled) return;
    if (!profileId) throw new Error("Not authenticated");

    const usernameNormalized = username.trim().toLowerCase();

    const rows = nodes.map((n) => ({
      profile_id: profileId,
      platform,
      username: usernameNormalized,
      filter_key: String((n as any)?.filter_key ?? "all"),
      fen: normalizeFen(n.fen),
      played_by: n.played_by,
      updated_at: new Date().toISOString(),
    }));

    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase.from("opening_graph_nodes").upsert(chunk, {
        onConflict: "profile_id,platform,username,filter_key,fen",
      });
      if (error) {
        // If we hit RLS/permission issues, stop spamming and surface a clear error.
        const statusCode = (error as any)?.status;
        if (statusCode === 401 || statusCode === 403) {
          writeDisabled = true;
        }
        throw error;
      }
    }
  }

  async function upsertEvents(platform: string, username: string, events: WorkerFlushEvent[]) {
    if (events.length === 0) return;
    if (writeDisabled) return;
    if (!profileId) throw new Error("Not authenticated");

    const usernameNormalized = username.trim().toLowerCase();

    const rows = events
      .map((e) => ({
        profile_id: profileId,
        platform,
        username: usernameNormalized,
        platform_game_id: String((e as any)?.platform_game_id ?? ""),
        played_at: (e as any)?.played_at ?? null,
        speed: (e as any)?.speed ?? null,
        rated: (e as any)?.rated ?? null,
        fen: normalizeFen(String((e as any)?.fen ?? "")),
        uci: String((e as any)?.uci ?? ""),
        san: (e as any)?.san != null ? String((e as any).san) : null,
        ply: Number((e as any)?.ply ?? 0),
        is_opponent_move: Boolean((e as any)?.is_opponent_move),
        win: Number((e as any)?.win ?? 0),
        loss: Number((e as any)?.loss ?? 0),
        draw: Number((e as any)?.draw ?? 0),
      }))
      .filter((r) => r.platform_game_id && r.fen && r.uci);

    const chunkSize = 2000;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase.from("opponent_move_events").upsert(chunk, {
        onConflict: "profile_id,platform,platform_game_id,ply",
      });
      if (error) {
        const statusCode = (error as any)?.status;
        if (statusCode === 401 || statusCode === 403) {
          writeDisabled = true;
        }
        throw error;
      }
    }
  }

  function postStart(p: OpeningGraphImportParams) {
    if (!worker) throw new Error("Worker not initialized");
    worker.postMessage({ type: "start", ...p });
  }

  function postStop() {
    if (!worker) return;
    worker.postMessage({ type: "stop" });
  }

  function setStatus(next: Partial<OpeningGraphImportStatus>) {
    status = { ...status, ...next };
    onStatus(status);
  }

  async function start(p: OpeningGraphImportParams) {
    stopped = false;
    writeDisabled = false;
    setStatus({ phase: "running", gamesProcessed: 0, bytesRead: 0, lastError: null });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user?.id) {
      setStatus({ phase: "error", lastError: "Not signed in" });
      return;
    }
    profileId = user.id;

    worker = new Worker(new URL("./openingGraphImport.worker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as WorkerMessage;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "progress") {
        setStatus({ gamesProcessed: msg.gamesProcessed, bytesRead: msg.bytesRead, lastError: msg.lastError ?? null });
        if (msg.status === "stopped" && msg.lastError) {
          setStatus({ phase: "error", lastError: msg.lastError });
        }
        return;
      }

      if (msg.type === "flush") {
        const platform = p.platform;
        const username = p.username.trim().toLowerCase();
        const nodes = Array.isArray(msg.nodes) ? msg.nodes : [];
        const events = Array.isArray((msg as any).events) ? ((msg as any).events as WorkerFlushEvent[]) : [];

        writeQueue = writeQueue
          .then(() => upsertNodes(platform, username, nodes))
          .then(() => upsertEvents(platform, username, events))
          .catch((e) => {
            const m = e instanceof Error ? e.message : "Failed to write opening graph";
            setStatus({ phase: "error", lastError: m });
            if (writeDisabled) {
              postStop();
            }
          });
        return;
      }

      if (msg.type === "done") {
        writeQueue = writeQueue
          .then(() => {
            setStatus({ phase: "done", gamesProcessed: msg.gamesProcessed });
          })
          .catch(() => {
            // ignore
          });
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      setStatus({ phase: "error", lastError: e.message || "Worker error" });
    };

    postStart(p);
  }

  async function stop() {
    stopped = true;
    postStop();

    try {
      await writeQueue;
    } catch {
      // ignore
    }

    if (worker) {
      worker.terminate();
      worker = null;
    }

    if (status.phase === "running") {
      setStatus({ phase: "done" });
    }
  }

  return {
    start,
    stop,
    getStatus: () => status,
    isStopped: () => stopped,
  };
}
