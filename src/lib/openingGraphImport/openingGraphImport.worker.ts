import { Chess } from "chess.js";

type ImportStartMessage = {
  type: "start";
  platform: "lichess";
  username: string;
  opponentUsername?: string; // optional for 'vs' filter
  color?: "white" | "black" | "both";
  sinceMs?: number;
  untilMs?: number;
  rated?: "any" | "rated" | "casual";
  perfType?: string | null;
};

type ImportStopMessage = { type: "stop" };

type Incoming = ImportStartMessage | ImportStopMessage;

type Outcome = { win: number; loss: number; draw: number };

type MoveAgg = {
  count: number;
  win: number;
  loss: number;
  draw: number;
  san: string | null;
  last_played_at: string | null;
  opp_elo_sum: number;
  opp_elo_count: number;
};

type SideAgg = Record<string, MoveAgg>; // uci -> agg

type FenAgg = {
  opponent: SideAgg;
  against: SideAgg;
};

type FlushPayload = {
  filter_key: string;
  fen: string;
  played_by: FenAgg;
};

type FlushEvent = {
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

type WorkerProgress = {
  type: "progress";
  gamesProcessed: number;
  bytesRead: number;
  status: "running" | "done" | "stopped";
  lastError?: string | null;
  newestGameTimestamp?: number | null;
};

type WorkerFlush = {
  type: "flush";
  nodes: FlushPayload[];
  events: FlushEvent[];
  gamesProcessed: number;
};

type WorkerDone = {
  type: "done";
  gamesProcessed: number;
  newestGameTimestamp?: number | null;
};

let stopRequested = false;
let gamesProcessed = 0;
let bytesRead = 0;
let newestGameTimestamp: number | null = null;

const fenMap = new Map<string, FenAgg>();
const dirtyFens = new Set<string>();

type FilterGraph = {
  nodes: Map<string, FenAgg>;
  dirty: Set<string>;
};

const graphs = new Map<string, FilterGraph>();

const eventBuffer: FlushEvent[] = [];

function ensureGraph(filterKey: string): FilterGraph {
  let g = graphs.get(filterKey);
  if (!g) {
    g = { nodes: new Map(), dirty: new Set() };
    graphs.set(filterKey, g);
  }
  return g;
}

function normalizeFen(fen: string) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return fen.trim();
  return parts.slice(0, 4).join(" ");
}

function getPgnTag(pgn: string, tag: string): string | null {
  const re = new RegExp(`^\\[${tag}\\s+\\"([^\\"]*)\\"\\]$`, "mi");
  const m = pgn.match(re);
  const raw = (m?.[1] ?? "").trim();
  return raw ? raw : null;
}

function inferSpeedFromPgn(pgn: string): string | null {
  const speedTag = (getPgnTag(pgn, "Speed") ?? "").trim().toLowerCase();
  if (["bullet", "blitz", "rapid", "classical", "correspondence"].includes(speedTag)) return speedTag;
  const event = (getPgnTag(pgn, "Event") ?? "").toLowerCase();
  if (event.includes("bullet")) return "bullet";
  if (event.includes("blitz")) return "blitz";
  if (event.includes("rapid")) return "rapid";
  if (event.includes("classical")) return "classical";
  if (event.includes("correspondence")) return "correspondence";
  return null;
}

function inferRatedFromPgn(pgn: string): boolean | null {
  const ratedTag = (getPgnTag(pgn, "Rated") ?? "").trim().toLowerCase();
  if (["true", "yes", "1"].includes(ratedTag)) return true;
  if (["false", "no", "0"].includes(ratedTag)) return false;
  const event = (getPgnTag(pgn, "Event") ?? "").toLowerCase();
  if (event.includes("rated")) return true;
  if (event.includes("casual")) return false;
  return null;
}

function inferOpponentColorFromPgn(pgn: string, opponentUsername: string): "w" | "b" | null {
  const re = /^\[(White|Black)\s+\"([^\"]+)\"\]$/gm;
  const opp = opponentUsername.trim().toLowerCase();

  let match: RegExpExecArray | null;
  let white: string | null = null;
  let black: string | null = null;

  while ((match = re.exec(pgn)) !== null) {
    const side = match[1];
    const name = (match[2] ?? "").trim();
    if (!name) continue;
    if (side === "White") white = name;
    if (side === "Black") black = name;
  }

  if (white?.trim().toLowerCase() === opp) return "w";
  if (black?.trim().toLowerCase() === opp) return "b";
  return null;
}

function inferResultFromPgn(pgn: string): "1-0" | "0-1" | "1/2-1/2" | "*" {
  const m = pgn.match(/^\[Result\s+\"(1-0|0-1|1\/2-1\/2|\*)\"\]$/m);
  return (m?.[1] as any) ?? "*";
}

function parseElo(v: any): number | null {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function inferOpponentEloFromPgn(pgn: string, oppColor: "w" | "b"): number | null {
  const whiteElo = parseElo(getPgnTag(pgn, "WhiteElo"));
  const blackElo = parseElo(getPgnTag(pgn, "BlackElo"));
  return oppColor === "w" ? blackElo : whiteElo;
}

function inferOutcomeFlags(params: { oppColor: "w" | "b"; result: string }): Outcome {
  const { oppColor, result } = params;
  if (result === "1/2-1/2") return { win: 0, loss: 0, draw: 1 };
  if (result === "1-0") return oppColor === "w" ? { win: 1, loss: 0, draw: 0 } : { win: 0, loss: 1, draw: 0 };
  if (result === "0-1") return oppColor === "b" ? { win: 1, loss: 0, draw: 0 } : { win: 0, loss: 1, draw: 0 };
  return { win: 0, loss: 0, draw: 0 };
}

function ensureFenAgg(fen: string): FenAgg {
  let entry = fenMap.get(fen);
  if (!entry) {
    entry = { opponent: {}, against: {} };
    fenMap.set(fen, entry);
  }
  dirtyFens.add(fen);
  return entry;
}

function ensureFenAggFor(filterKey: string, fen: string): FenAgg {
  const g = ensureGraph(filterKey);
  let entry = g.nodes.get(fen);
  if (!entry) {
    entry = { opponent: {}, against: {} };
    g.nodes.set(fen, entry);
  }
  g.dirty.add(fen);
  return entry;
}

function ensureMoveAgg(map: SideAgg, uci: string): MoveAgg {
  let agg = map[uci];
  if (!agg) {
    agg = {
      count: 0,
      win: 0,
      loss: 0,
      draw: 0,
      san: null,
      last_played_at: null,
      opp_elo_sum: 0,
      opp_elo_count: 0,
    };
    map[uci] = agg;
  }
  return agg;
}

function flushNodes(maxNodes = 250): FlushPayload[] {
  const out: FlushPayload[] = [];
  let i = 0;
  for (const [filterKey, g] of graphs) {
    for (const fen of g.dirty) {
      const played_by = g.nodes.get(fen);
      if (!played_by) continue;
      out.push({ filter_key: filterKey, fen, played_by });
      g.dirty.delete(fen);
      i += 1;
      if (i >= maxNodes) return out;
    }
  }
  return out;
}

function flushEvents(maxEvents = 2000): FlushEvent[] {
  if (eventBuffer.length === 0) return [];
  const out = eventBuffer.splice(0, maxEvents);
  return out;
}

function emitFlush(params?: { maxNodes?: number; maxEvents?: number }) {
  const nodes = flushNodes(params?.maxNodes ?? 250);
  const events = flushEvents(params?.maxEvents ?? 2000);
  if (nodes.length === 0 && events.length === 0) return;
  (self as any).postMessage({ type: "flush", nodes, events, gamesProcessed } satisfies WorkerFlush);
}

async function runImport(params: ImportStartMessage) {
  stopRequested = false;
  gamesProcessed = 0;
  bytesRead = 0;
  newestGameTimestamp = null;
  fenMap.clear();
  dirtyFens.clear();
  graphs.clear();
  eventBuffer.length = 0;

  const user = params.username.trim();
  if (!user) {
    (self as any).postMessage({ type: "progress", gamesProcessed: 0, bytesRead: 0, status: "stopped", lastError: "username is required" } satisfies WorkerProgress);
    return;
  }

  const url = new URL(`https://lichess.org/api/games/user/${encodeURIComponent(user)}`);
  url.searchParams.set("max", "1000000");
  url.searchParams.set("pgnInJson", "true");
  url.searchParams.set("moves", "true");
  url.searchParams.set("clocks", "false");
  url.searchParams.set("evals", "false");
  url.searchParams.set("opening", "false");

  if (params.color && params.color !== "both") url.searchParams.set("color", params.color);
  if (typeof params.sinceMs === "number") url.searchParams.set("since", String(params.sinceMs));
  if (typeof params.untilMs === "number") url.searchParams.set("until", String(params.untilMs));
  if (params.rated === "rated") url.searchParams.set("rated", "true");
  if (params.rated === "casual") url.searchParams.set("rated", "false");
  if (params.perfType) url.searchParams.set("perfType", String(params.perfType));
  if (params.opponentUsername) url.searchParams.set("vs", String(params.opponentUsername));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        accept: "application/x-ndjson",
      },
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fetch failed";
    (self as any).postMessage({ type: "progress", gamesProcessed, bytesRead, status: "stopped", lastError: msg } satisfies WorkerProgress);
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    const msg = `Lichess API error (${res.status}): ${text || res.statusText}`;
    (self as any).postMessage({ type: "progress", gamesProcessed, bytesRead, status: "stopped", lastError: msg } satisfies WorkerProgress);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const flushEveryGames = 50;
  let lastFlushAt = 0;

  while (!stopRequested) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      bytesRead += value.byteLength;
      buf += decoder.decode(value, { stream: true });
    }

    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      if (stopRequested) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;

      let parsed: any = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const pgn = String(parsed?.pgn ?? "");
      const platformGameId = String(parsed?.id ?? "");
      if (!pgn || !platformGameId) continue;

      const oppColor = inferOpponentColorFromPgn(pgn, user);
      if (!oppColor) continue;

      const result = inferResultFromPgn(pgn);
      const outcome = inferOutcomeFlags({ oppColor, result });
      const oppElo = inferOpponentEloFromPgn(pgn, oppColor);
      const ratedFlag =
        typeof parsed?.rated === "boolean" ? (parsed.rated as boolean) : inferRatedFromPgn(pgn);
      const speed =
        typeof parsed?.speed === "string" && ["bullet", "blitz", "rapid", "classical", "correspondence"].includes(String(parsed.speed).toLowerCase())
          ? String(parsed.speed).toLowerCase()
          : inferSpeedFromPgn(pgn);

      const ts = typeof parsed?.lastMoveAt === "number" ? parsed.lastMoveAt : typeof parsed?.createdAt === "number" ? parsed.createdAt : null;
      const playedAtIso = ts ? new Date(ts).toISOString() : null;

      // Track the newest game timestamp for incremental sync
      if (ts !== null && (newestGameTimestamp === null || ts > newestGameTimestamp)) {
        newestGameTimestamp = ts;
      }

      const chess = new Chess();
      try {
        chess.loadPgn(pgn, { strict: false });
      } catch {
        continue;
      }

      const verbose = chess.history({ verbose: true }) as any[];
      const replay = new Chess();

      let ply = 0;

      for (const mv of verbose) {
        const fenKey = normalizeFen(replay.fen());
        const moveColor = mv?.color as "w" | "b" | undefined;

        const uci = `${mv.from}${mv.to}${mv.promotion ? mv.promotion : ""}`;

        const isOpponentMove = Boolean(moveColor && moveColor === oppColor);

        // Record an event row for precise filtering.
        eventBuffer.push({
          platform_game_id: platformGameId,
          played_at: playedAtIso,
          speed: speed ?? null,
          rated: ratedFlag ?? null,
          fen: fenKey,
          uci,
          san: mv?.san != null ? String(mv.san) : null,
          ply,
          is_opponent_move: isOpponentMove,
          win: outcome.win,
          loss: outcome.loss,
          draw: outcome.draw,
        });

        let played: any = null;
        try {
          played = replay.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
        } catch {
          break;
        }
        if (!played) break;

        ply += 1;

        // Always aggregate into the 'all' graph.
        const baseAll = ensureFenAggFor("all", fenKey);
        const sideAll = moveColor === oppColor ? baseAll.opponent : baseAll.against;
        const aggAll = ensureMoveAgg(sideAll, uci);

        const keys: string[] = [];
        if (ratedFlag === true) keys.push("rated");
        if (ratedFlag === false) keys.push("casual");
        if (speed) keys.push(`speed:${speed}`);

        for (const k of keys) {
          const g = ensureFenAggFor(k, fenKey);
          const side = moveColor === oppColor ? g.opponent : g.against;
          const agg = ensureMoveAgg(side, uci);
          agg.count += 1;
          agg.win += outcome.win;
          agg.loss += outcome.loss;
          agg.draw += outcome.draw;
          if (!agg.san) agg.san = mv?.san != null ? String(mv.san) : null;
          if (playedAtIso) {
            if (!agg.last_played_at || agg.last_played_at < playedAtIso) {
              agg.last_played_at = playedAtIso;
            }
          }
          if (oppElo != null) {
            agg.opp_elo_sum += oppElo;
            agg.opp_elo_count += 1;
          }
        }

        aggAll.count += 1;
        aggAll.win += outcome.win;
        aggAll.loss += outcome.loss;
        aggAll.draw += outcome.draw;
        if (!aggAll.san) aggAll.san = mv?.san != null ? String(mv.san) : null;

        if (playedAtIso) {
          if (!aggAll.last_played_at || aggAll.last_played_at < playedAtIso) {
            aggAll.last_played_at = playedAtIso;
          }
        }

        if (oppElo != null) {
          aggAll.opp_elo_sum += oppElo;
          aggAll.opp_elo_count += 1;
        }
      }

      gamesProcessed += 1;

      if (gamesProcessed % flushEveryGames === 0) {
        const now = Date.now();
        // throttle flushes slightly
        if (now - lastFlushAt > 500) {
          lastFlushAt = now;
          emitFlush();
        }
      }

      if (gamesProcessed % 25 === 0) {
        (self as any).postMessage({ type: "progress", gamesProcessed, bytesRead, status: "running", newestGameTimestamp } satisfies WorkerProgress);
      }
    }
  }

  try {
    await reader.cancel();
  } catch {
    // ignore
  }

  emitFlush({ maxNodes: 500, maxEvents: 5000 });
  // Flush any remaining dirty nodes / event rows.
  const hasDirty = () => {
    for (const [, g] of graphs) {
      if (g.dirty.size > 0) return true;
    }
    return false;
  };

  while (hasDirty() || eventBuffer.length > 0) {
    emitFlush({ maxNodes: 500, maxEvents: 5000 });
  }
  (self as any).postMessage({ type: "done", gamesProcessed, newestGameTimestamp } satisfies WorkerDone);
}

(self as any).onmessage = (event: MessageEvent) => {
  const msg = event.data as Incoming;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "stop") {
    stopRequested = true;
    return;
  }

  if (msg.type === "start") {
    void runImport(msg);
  }
};
