type BestMoveResult = {
  bestMoveUci: string | null;
};

export type EngineScore =
  | { type: "cp"; value: number }
  | { type: "mate"; value: number };

type EvalResult = {
  score: EngineScore | null;
};

type Pending = {
  resolve: (r: any) => void;
  reject: (e: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let requestQueue: Promise<any> = Promise.resolve();

function ensureWorker() {
  if (typeof window === "undefined") {
    throw new Error("Engine service can only be used in the browser");
  }

  if (!worker) {
    worker = new Worker("/stockfish/engine.js");

    worker.onmessage = (event: MessageEvent) => {
      const raw = typeof (event as any)?.data === "string" ? (event as any).data : String((event as any)?.data ?? "");
      const line = raw.trim();

      const id = Number((worker as any).__activeRequestId);
      const entry = pending.get(id);
      if (!entry) return;

      if (line.startsWith("info")) {
        const m = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)\b/);
        if (m) {
          const kind = m[1];
          const value = Number(m[2]);
          if (Number.isFinite(value)) {
            (worker as any).__activeLastScore = kind === "cp" ? ({ type: "cp", value } as EngineScore) : ({ type: "mate", value } as EngineScore);
          }
        }
        return;
      }

      if (line.startsWith("bestmove")) {
        const parts = line.split(/\s+/);
        const best = parts[1] && parts[1] !== "(none)" ? parts[1] : null;
        const score = ((worker as any).__activeLastScore as EngineScore | undefined) ?? null;
        const kind = String((worker as any).__activeRequestKind ?? "bestmove");

        pending.delete(id);
        if (kind === "eval") {
          entry.resolve({ score } satisfies EvalResult);
        } else {
          entry.resolve({ bestMoveUci: best } satisfies BestMoveResult);
        }
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      for (const [, entry] of pending) {
        entry.reject(new Error(event.message || "Engine worker error"));
      }
      pending.clear();
    };

    worker.postMessage("uci");
  }

  return worker;
}

async function requestEngine<T>(params: {
  fen: string;
  depth: number;
  kind: "bestmove" | "eval";
  timeoutMs?: number;
}): Promise<T> {
  const w = ensureWorker();
  const id = nextId++;
  const timeoutMs = Number.isFinite(params.timeoutMs) ? Math.max(500, Number(params.timeoutMs)) : 10_000;

  w.postMessage("stop");
  w.postMessage("ucinewgame");
  w.postMessage("isready");
  w.postMessage(`position fen ${params.fen}`);
  (w as any).__activeRequestId = id;
  (w as any).__activeRequestKind = params.kind;
  (w as any).__activeLastScore = null;
  w.postMessage(`go depth ${params.depth}`);

  return await new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });

    window.setTimeout(() => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      reject(new Error("Engine request timed out"));
    }, timeoutMs);
  });
}

async function enqueue<T>(fn: () => Promise<T>) {
  const next = requestQueue.then(fn, fn);
  requestQueue = next.then(
    () => undefined,
    () => undefined
  );
  return await next;
}

async function requestBestMove(fen: string, opts?: { depth?: number }): Promise<BestMoveResult> {
  const depth = Number.isFinite(opts?.depth) ? Math.max(1, Math.min(30, Math.floor(opts!.depth!))) : 12;
  return await enqueue(() => requestEngine<BestMoveResult>({ fen, depth, kind: "bestmove" }));
}

async function requestEval(fen: string, opts?: { depth?: number }): Promise<EvalResult> {
  const depth = Number.isFinite(opts?.depth) ? Math.max(1, Math.min(30, Math.floor(opts!.depth!))) : 20;
  return await enqueue(() => requestEngine<EvalResult>({ fen, depth, kind: "eval", timeoutMs: 12_000 }));
}

export async function evaluateBestMove(fen: string, opts?: { depth?: number }): Promise<BestMoveResult> {
  const depth = Number.isFinite(opts?.depth) ? Math.max(8, Math.min(24, Math.floor(opts!.depth!))) : 14;
  return await requestBestMove(fen, { depth });
}

export async function getBestMoveForPlay(fen: string): Promise<string | null> {
  const res = await requestBestMove(fen, { depth: 12 });
  return res.bestMoveUci;
}

export async function evaluatePositionShallow(fen: string, opts?: { depth?: number }): Promise<EngineScore | null> {
  const depth = Number.isFinite(opts?.depth) ? Math.max(8, Math.min(24, Math.floor(opts!.depth!))) : 20;
  const res = await requestEval(fen, { depth });
  return res.score;
}
