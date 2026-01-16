import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeFen } from "@/server/opponentModel";
import { upsertCachedGames, type CachedGame, type OpeningTraceEntry } from "@/lib/analysis/analysisCache";

type WorkerFlushNode = {
  filter_key: string;
  fen: string;
  played_by: {
    opponent: Record<string, any>;
    against: Record<string, any>;
  };
};

type WorkerFlushGame = {
  platform_game_id: string;
  played_at: string | null;
  speed: string | null;
  rated: boolean | null;
  pgn: string;
  opponent_color: "w" | "b";
  result: string;
  opening_trace: Array<{
    ply: number;
    positionKey: string;
    moveUci: string;
    isOpponentMove: boolean;
  }>;
};

type WorkerMessage =
  | { type: "progress"; gamesProcessed: number; bytesRead: number; status: "running" | "done" | "stopped"; phase: "streaming" | "flushing" | "done"; lastError?: string | null; newestGameTimestamp?: number | null }
  | { type: "flush"; nodes: WorkerFlushNode[]; games: WorkerFlushGame[]; gamesProcessed: number }
  | { type: "done"; gamesProcessed: number; newestGameTimestamp?: number | null };

export type OpeningGraphImportStatus = {
  phase: "idle" | "streaming" | "saving" | "done" | "error";
  gamesProcessed: number;
  bytesRead: number;
  lastError: string | null;
  newestGameTimestamp?: number | null;
  pendingWrites?: number;
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
  maxGames?: number; // Cap on number of games to import (default: 1000)
};

export function createOpeningGraphImporter(params: {
  onStatus: (s: OpeningGraphImportStatus) => void;
}) {
  const supabase = createSupabaseBrowserClient();
  const { onStatus } = params;

  let worker: Worker | null = null;
  let stopped = false;
  let status: OpeningGraphImportStatus = { phase: "idle", gamesProcessed: 0, bytesRead: 0, lastError: null, pendingWrites: 0 };
  let pendingWriteCount = 0;

  let profileId: string | null = null;
  let writeDisabled = false;

  let writeQueue: Promise<void> = Promise.resolve();

  async function upsertNodes(platform: string, username: string, nodes: WorkerFlushNode[]) {
    if (nodes.length === 0) return;
    if (writeDisabled) return;
    if (!profileId) throw new Error("Not authenticated");

    const usernameNormalized = username.trim().toLowerCase();

    const rows = nodes.map((n) => ({
      platform,
      username: usernameNormalized,
      filter_key: String((n as any)?.filter_key ?? "all"),
      fen: normalizeFen(n.fen),
      played_by: n.played_by,
    }));

    // Use RPC function that merges played_by JSON instead of overwriting
    // This fixes incremental imports which previously overwrote existing data
    const chunkSize = 200; // Smaller chunks for RPC to avoid payload limits
    const chunks: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      chunks.push(rows.slice(i, i + chunkSize));
    }
    
    // Write chunks sequentially to avoid race conditions in merge
    for (const chunk of chunks) {
      const { error } = await supabase.rpc("upsert_opening_graph_nodes_merge", {
        nodes: chunk,
      });
      
      if (error) {
        const statusCode = (error as any)?.status;
        // If RPC doesn't exist yet, fall back to simple upsert (for backwards compatibility)
        if (statusCode === 404 || (error.message && error.message.includes("function") && error.message.includes("does not exist"))) {
          console.warn("[ImportService] Merge RPC not available, falling back to simple upsert");
          const fallbackRows = chunk.map((r) => ({
            profile_id: profileId,
            ...r,
            updated_at: new Date().toISOString(),
          }));
          const { error: fallbackError } = await supabase.from("opening_graph_nodes").upsert(fallbackRows, {
            onConflict: "profile_id,platform,username,filter_key,fen",
          });
          if (fallbackError) {
            const fallbackStatus = (fallbackError as any)?.status;
            if (fallbackStatus === 401 || fallbackStatus === 403) {
              writeDisabled = true;
            }
            throw fallbackError;
          }
          continue;
        }
        if (statusCode === 401 || statusCode === 403) {
          writeDisabled = true;
        }
        throw error;
      }
    }
  }

  async function upsertGames(platform: string, username: string, games: WorkerFlushGame[]) {
    if (games.length === 0) return;
    if (writeDisabled) return;
    if (!profileId) throw new Error("Not authenticated");

    const usernameNormalized = username.trim().toLowerCase();

    const rowsRaw = games
      .map((g) => ({
        profile_id: profileId,
        platform,
        username: usernameNormalized,
        platform_game_id: String(g.platform_game_id ?? ""),
        played_at: g.played_at ?? null,
        pgn: String(g.pgn ?? ""),
      }))
      .filter((r) => r.platform_game_id && r.pgn);

    // Important: Postgres can throw `ON CONFLICT DO UPDATE command cannot affect row a second time`
    // if the same conflict key appears more than once within a single INSERT/UPSERT payload.
    // This surfaces via PostgREST as a 409 Conflict.
    // Dedup by (profile_id, platform, platform_game_id) within this flush.
    const deduped = new Map<string, (typeof rowsRaw)[number]>();
    for (const r of rowsRaw) {
      const key = `${r.profile_id}::${r.platform}::${r.platform_game_id}`;
      if (!deduped.has(key)) deduped.set(key, r);
    }
    const rows = Array.from(deduped.values());

    // Use larger chunks and parallel writes for better performance
    const chunkSize = 200;
    const chunks: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      chunks.push(rows.slice(i, i + chunkSize));
    }
    
    // Write chunks in parallel (up to 3 at a time)
    const batchSize = 3;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(chunk => 
          supabase.from("games").upsert(chunk, {
            onConflict: "profile_id,platform,platform_game_id",
            ignoreDuplicates: true,
          })
        )
      );
      
      for (const { error } of results) {
        if (error) {
          const statusCode = (error as any)?.status;
          if (statusCode === 401 || statusCode === 403) {
            writeDisabled = true;
          }
          const baseMsg =
            typeof (error as any)?.message === "string" ? String((error as any).message) : "Failed to write games";

          if (statusCode === 400) {
            throw new Error(
              `${baseMsg} (400). This usually means your Supabase 'games' table is missing the required unique constraint for on_conflict=profile_id,platform,platform_game_id. Run supabase/migrations/20260109_fix_games_table.sql in Supabase SQL editor.`
            );
          }

          throw new Error(baseMsg);
        }
      }
    }
  }

  async function cacheGamesInIndexedDB(
    visitorId: string,
    platform: string,
    username: string,
    games: WorkerFlushGame[]
  ): Promise<void> {
    if (games.length === 0) return;
    
    const usernameNormalized = username.trim().toLowerCase();
    const visitorKey = `${visitorId}_${platform}_${usernameNormalized}`;
    
    const cachedGames: CachedGame[] = games
      .filter((g) => g.platform_game_id && g.opening_trace)
      .map((g) => ({
        id: g.platform_game_id,
        visitorKey,
        platform,
        opponent: usernameNormalized,
        playedAt: g.played_at ?? new Date().toISOString(),
        speed: g.speed,
        rated: g.rated,
        result: g.result ?? "*",
        opponentColor: g.opponent_color,
        openingTrace: g.opening_trace.map((t) => ({
          ply: t.ply,
          positionKey: t.positionKey,
          moveUci: t.moveUci,
          isOpponentMove: t.isOpponentMove,
        })),
      }));
    
    try {
      await upsertCachedGames(cachedGames);
    } catch (e) {
      // IndexedDB caching is best-effort; don't fail the import
      console.warn("[ImportService] Failed to cache games in IndexedDB:", e);
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
    pendingWriteCount = 0;
    setStatus({ phase: "streaming", gamesProcessed: 0, bytesRead: 0, lastError: null, pendingWrites: 0 });

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
        // Map worker phase to service phase
        let servicePhase: OpeningGraphImportStatus["phase"] = status.phase;
        if (msg.phase === "streaming") servicePhase = "streaming";
        else if (msg.phase === "flushing") servicePhase = "saving";
        
        setStatus({ 
          phase: servicePhase,
          gamesProcessed: msg.gamesProcessed, 
          bytesRead: msg.bytesRead, 
          lastError: msg.lastError ?? null, 
          newestGameTimestamp: msg.newestGameTimestamp ?? null,
          pendingWrites: pendingWriteCount,
        });
        if (msg.status === "stopped" && msg.lastError) {
          setStatus({ phase: "error", lastError: msg.lastError });
        }
        return;
      }

      if (msg.type === "flush") {
        const platform = p.platform;
        const username = p.username.trim().toLowerCase();
        const nodes = Array.isArray(msg.nodes) ? msg.nodes : [];
        const games = Array.isArray(msg.games) ? msg.games : [];

        pendingWriteCount++;
        setStatus({ pendingWrites: pendingWriteCount });
        
        writeQueue = writeQueue
          .then(() => Promise.all([
            upsertNodes(platform, username, nodes),
            upsertGames(platform, username, games),
            cacheGamesInIndexedDB(profileId!, platform, username, games),
          ]))
          .then(() => {
            pendingWriteCount = Math.max(0, pendingWriteCount - 1);
            setStatus({ pendingWrites: pendingWriteCount });
          })
          .catch((e) => {
            pendingWriteCount = Math.max(0, pendingWriteCount - 1);
            const m = e instanceof Error ? e.message : "Failed to write opening graph";
            setStatus({ phase: "error", lastError: m, pendingWrites: pendingWriteCount });
            if (writeDisabled) {
              postStop();
            }
          });
        return;
      }

      if (msg.type === "done") {
        console.log("[ImportService] Received done message, games:", msg.gamesProcessed);
        // Wait for pending writes then signal completion
        writeQueue = writeQueue
          .then(() => {
            console.log("[ImportService] Write queue flushed, signaling done");
            setStatus({ phase: "done", gamesProcessed: msg.gamesProcessed, newestGameTimestamp: msg.newestGameTimestamp ?? null });
          })
          .catch((e) => {
            // Even if writes fail, we should signal completion so queue progresses
            console.error("[ImportService] Write queue error during done:", e);
            setStatus({ phase: "done", gamesProcessed: msg.gamesProcessed, newestGameTimestamp: msg.newestGameTimestamp ?? null });
          });
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      console.error("[ImportService] Worker error:", e.message);
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

    if (status.phase === "streaming" || status.phase === "saving") {
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
