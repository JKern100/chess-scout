let engine: any = null;
let engineReady: Promise<void> | null = null;

type EngineRequest = {
  id: number;
  fen: string;
  depth?: number;
};

type EngineResponse =
  | { type: "bestmove"; id: number; bestMoveUci: string | null; ponderUci: string | null }
  | { type: "error"; id: number; message: string };

async function ensureEngine() {
  if (engine && engineReady) return engineReady;

  engineReady = (async () => {
    const mod: any = await import("stockfish");
    const create = mod?.default ?? mod;
    if (typeof create !== "function") {
      throw new Error("stockfish module did not export a factory function");
    }

    engine = create();
    if (!engine || typeof engine.postMessage !== "function") {
      throw new Error("stockfish factory did not return a Worker-like engine");
    }

    await new Promise<void>((resolve) => {
      let resolved = false;
      const prev = engine.onmessage;
      engine.onmessage = (event: any) => {
        const data = typeof event?.data === "string" ? event.data : String(event?.data ?? "");
        if (!resolved && data.includes("uciok")) {
          resolved = true;
          resolve();
        }
        if (typeof prev === "function") prev(event);
      };

      engine.postMessage("uci");
    });

    await new Promise<void>((resolve) => {
      let resolved = false;
      const prev = engine.onmessage;
      engine.onmessage = (event: any) => {
        const data = typeof event?.data === "string" ? event.data : String(event?.data ?? "");
        if (!resolved && data.includes("readyok")) {
          resolved = true;
          resolve();
        }
        if (typeof prev === "function") prev(event);
      };

      engine.postMessage("isready");
    });
  })();

  return engineReady;
}

async function computeBestMove(req: EngineRequest): Promise<{ best: string | null; ponder: string | null }> {
  await ensureEngine();

  if (!engine) return { best: null, ponder: null };

  const depth = Number.isFinite(req.depth) ? Math.max(1, Math.min(30, Math.floor(req.depth!))) : 12;

  engine.postMessage("stop");
  engine.postMessage("ucinewgame");
  engine.postMessage("isready");
  engine.postMessage(`position fen ${req.fen}`);

  return await new Promise((resolve) => {
    const prev = engine.onmessage;

    engine.onmessage = (event: any) => {
      const raw = typeof event?.data === "string" ? event.data : String(event?.data ?? "");
      const line = raw.trim();

      if (line.startsWith("bestmove")) {
        const parts = line.split(/\s+/);
        const best = parts[1] && parts[1] !== "(none)" ? parts[1] : null;
        const ponderIdx = parts.indexOf("ponder");
        const ponder = ponderIdx >= 0 && parts[ponderIdx + 1] ? parts[ponderIdx + 1] : null;
        engine.onmessage = prev;
        resolve({ best, ponder });
        return;
      }

      if (typeof prev === "function") prev(event);
    };

    engine.postMessage(`go depth ${depth}`);
  });
}

(self as any).onmessage = async (event: MessageEvent) => {
  const msg = event.data as any;
  const id = Number(msg?.id);
  const fen = String(msg?.fen ?? "");
  const depth = msg?.depth;

  if (!Number.isFinite(id) || !fen) {
    return;
  }

  try {
    const result = await computeBestMove({ id, fen, depth });
    const payload: EngineResponse = {
      type: "bestmove",
      id,
      bestMoveUci: result.best,
      ponderUci: result.ponder,
    };
    (self as any).postMessage(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Engine error";
    const payload: EngineResponse = { type: "error", id, message };
    (self as any).postMessage(payload);
  }
};
