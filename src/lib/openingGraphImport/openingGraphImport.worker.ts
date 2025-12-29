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
  fen: string;
  played_by: FenAgg;
};

type WorkerProgress = {
  type: "progress";
  gamesProcessed: number;
  bytesRead: number;
  status: "running" | "done" | "stopped";
  lastError?: string | null;
};

type WorkerFlush = {
  type: "flush";
  nodes: FlushPayload[];
  gamesProcessed: number;
};

type WorkerDone = {
  type: "done";
  gamesProcessed: number;
};

let stopRequested = false;
let gamesProcessed = 0;
let bytesRead = 0;

const fenMap = new Map<string, FenAgg>();
const dirtyFens = new Set<string>();

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
  for (const fen of dirtyFens) {
    const played_by = fenMap.get(fen);
    if (!played_by) continue;
    out.push({ fen, played_by });
    dirtyFens.delete(fen);
    i += 1;
    if (i >= maxNodes) break;
  }
  return out;
}

async function runImport(params: ImportStartMessage) {
  stopRequested = false;
  gamesProcessed = 0;
  bytesRead = 0;
  fenMap.clear();
  dirtyFens.clear();

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

      const ts = typeof parsed?.lastMoveAt === "number" ? parsed.lastMoveAt : typeof parsed?.createdAt === "number" ? parsed.createdAt : null;
      const playedAtIso = ts ? new Date(ts).toISOString() : null;

      const chess = new Chess();
      try {
        chess.loadPgn(pgn, { strict: false });
      } catch {
        continue;
      }

      const verbose = chess.history({ verbose: true }) as any[];
      const replay = new Chess();

      for (const mv of verbose) {
        const fenKey = normalizeFen(replay.fen());
        const moveColor = mv?.color as "w" | "b" | undefined;

        const uci = `${mv.from}${mv.to}${mv.promotion ? mv.promotion : ""}`;

        let played: any = null;
        try {
          played = replay.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
        } catch {
          break;
        }
        if (!played) break;

        const fenAgg = ensureFenAgg(fenKey);
        const side = moveColor === oppColor ? fenAgg.opponent : fenAgg.against;
        const agg = ensureMoveAgg(side, uci);

        // Mark the current position as dirty (ensureFenAgg does too, but this is cheap and safe).
        dirtyFens.add(fenKey);

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

      gamesProcessed += 1;

      if (gamesProcessed % flushEveryGames === 0) {
        const now = Date.now();
        // throttle flushes slightly
        if (now - lastFlushAt > 500) {
          lastFlushAt = now;
          (self as any).postMessage({ type: "flush", nodes: flushNodes(), gamesProcessed } satisfies WorkerFlush);
        }
      }

      if (gamesProcessed % 25 === 0) {
        (self as any).postMessage({ type: "progress", gamesProcessed, bytesRead, status: "running" } satisfies WorkerProgress);
      }
    }
  }

  try {
    await reader.cancel();
  } catch {
    // ignore
  }

  (self as any).postMessage({ type: "flush", nodes: flushNodes(), gamesProcessed } satisfies WorkerFlush);
  // Flush any remaining dirty nodes.
  while (dirtyFens.size > 0) {
    (self as any).postMessage({ type: "flush", nodes: flushNodes(500), gamesProcessed } satisfies WorkerFlush);
  }
  (self as any).postMessage({ type: "done", gamesProcessed } satisfies WorkerDone);
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
