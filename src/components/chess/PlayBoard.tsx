"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

type Side = "white" | "black";

type Props = {
  initialFen?: string;
};

export function PlayBoard({ initialFen }: Props) {
  const initialGame = useMemo(() => {
    const g = new Chess();
    if (initialFen) {
      try {
        g.load(initialFen);
      } catch {
        // ignore invalid fen
      }
    }
    return g;
  }, [initialFen]);

  const [game, setGame] = useState<Chess>(initialGame);
  const [playerSide, setPlayerSide] = useState<Side>("white");
  const [status, setStatus] = useState<string | null>(null);
  const [simulateOpponent, setSimulateOpponent] = useState(false);
  const [opponentUsername, setOpponentUsername] = useState<string>("");
  const [opponentMode, setOpponentMode] = useState<"proportional" | "random">("proportional");
  const [depthRemaining, setDepthRemaining] = useState<number | null>(null);
  const [lastOpponentMove, setLastOpponentMove] = useState<{
    uci: string;
    san: string | null;
    played_count: number;
    win: number;
    loss: number;
    draw: number;
  } | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [opponentCommentary, setOpponentCommentary] = useState<string | null>(null);
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const [boardWidth, setBoardWidth] = useState<number>(400);

  const squareSize = Math.floor(boardWidth / 8);

  function formatPct(n: number) {
    if (!Number.isFinite(n)) return "0%";
    const clamped = Math.max(0, Math.min(1, n));
    return `${Math.round(clamped * 100)}%`;
  }

  function buildOpponentCommentary(params: {
    username: string;
    moveLabel: string;
    moveCount: number;
    totalCount: number;
    mode: "proportional" | "random";
    depthRemaining: number | null;
  }) {
    const { username, moveLabel, moveCount, totalCount, mode, depthRemaining } = params;
    const ratio = totalCount > 0 ? moveCount / totalCount : 0;
    const pct = formatPct(ratio);

    const remainingAfterThis =
      depthRemaining == null ? null : Math.max(0, Math.floor(depthRemaining) - 1);

    const depthPhrase =
      remainingAfterThis == null
        ? ""
        : remainingAfterThis === 0
          ? " This likely ends the known line."
          : ` About ${remainingAfterThis} more opponent moves of history remain.`;

    const samplePhrase = totalCount > 0 ? ` (${moveCount}/${totalCount})` : "";

    const templates = [
      `${username} chooses ${moveLabel} — they go for this about ${pct} of the time here${samplePhrase}.${depthPhrase}`,
      `Opponent plays ${moveLabel}. In this position, ${username} picks it roughly ${pct} of the time${samplePhrase}.${depthPhrase}`,
      `${moveLabel} from ${username} (seen ~${pct}${samplePhrase} in their games from this spot).${depthPhrase}`,
      `This is a familiar choice: ${moveLabel} shows up around ${pct} of the time for ${username} here${samplePhrase}.${depthPhrase}`,
      `${username} goes with ${moveLabel}. Frequency in this position: ~${pct}${samplePhrase}.${depthPhrase}`,
      mode === "random"
        ? `${username} replies with ${moveLabel}. (Random mode) Historically: ~${pct}${samplePhrase}.${depthPhrase}`
        : `${username} replies with ${moveLabel}. Historically: ~${pct}${samplePhrase}.${depthPhrase}`,
    ];

    return templates[Math.floor(Math.random() * templates.length)] ?? templates[0]!;
  }

  useEffect(() => {
    const el = boardContainerRef.current;
    if (!el) return;

    const update = () => {
      const paddingPx = 32;
      const raw = Math.max(240, Math.floor(el.clientWidth - paddingPx));
      const square = Math.max(1, Math.floor(raw / 8));
      const snapped = square * 8;
      setBoardWidth(snapped);
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function requestOpponentMove(params: {
    fen: string;
    username: string;
    mode: "proportional" | "random";
  }) {
    const res = await fetch("/api/sim/next-move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: "lichess",
        username: params.username,
        fen: params.fen,
        mode: params.mode,
        max_games: 2000,
        max_depth: 16,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error ?? "Opponent simulation failed");
    }
    return json as any;
  }

  async function maybePlayOpponentReply(nextGame: Chess) {
    if (!simulateOpponent) return;

    const trimmed = opponentUsername.trim();
    if (!trimmed) {
      setStatus("Enter an opponent username to simulate opponent moves.");
      return;
    }

    const shouldOpponentMove =
      (playerSide === "white" && nextGame.turn() === "b") ||
      (playerSide === "black" && nextGame.turn() === "w");

    if (!shouldOpponentMove) return;
    if (nextGame.isGameOver()) return;

    setSimBusy(true);
    try {
      const json = await requestOpponentMove({
        fen: nextGame.fen(),
        username: trimmed,
        mode: opponentMode,
      });

      const cacheStatus = String(json?.cache?.status ?? "");
      const cacheBuildMs = Number(json?.cache?.build_ms ?? 0);

      setDepthRemaining(
        typeof json?.depth_remaining === "number" ? (json.depth_remaining as number) : null
      );

      const move = json?.move as any;
      const totalCount = Number(json?.available_total_count ?? 0);
      if (!move?.uci) {
        setLastOpponentMove(null);
        setOpponentCommentary(null);
        setStatus(
          `No opponent data for this position. (cache: ${cacheStatus || "?"}, build: ${Number.isFinite(cacheBuildMs) ? Math.round(cacheBuildMs) : 0}ms)`
        );
        return;
      }

      const reply = new Chess(nextGame.fen());
      const from = String(move.uci).slice(0, 2);
      const to = String(move.uci).slice(2, 4);
      const promotion = String(move.uci).length > 4 ? String(move.uci).slice(4) : undefined;

      const played = reply.move({ from, to, promotion: (promotion as any) ?? undefined });
      if (!played) {
        setStatus("Opponent move from history was not legal in this position.");
        return;
      }

      setLastOpponentMove({
        uci: String(move.uci),
        san: (move.san as string | null) ?? null,
        played_count: Number(move.played_count ?? 0),
        win: Number(move.win ?? 0),
        loss: Number(move.loss ?? 0),
        draw: Number(move.draw ?? 0),
      });

      setOpponentCommentary(
        buildOpponentCommentary({
          username: trimmed,
          moveLabel: String((move.san as string | null) ?? move.uci),
          moveCount: Number(move.played_count ?? 0),
          totalCount,
          mode: opponentMode,
          depthRemaining: typeof json?.depth_remaining === "number" ? (json.depth_remaining as number) : null,
        })
      );

      setStatus(null);
      setGame(reply);
    } finally {
      setSimBusy(false);
    }
  }

  function safeGameMutate(mutator: (g: Chess) => void) {
    setGame((prev) => {
      const next = new Chess(prev.fen());
      mutator(next);
      return next;
    });
  }

  function onPieceDrop(args: any) {
    setStatus(null);

    const sourceSquare = args?.sourceSquare as string | undefined;
    const targetSquare = args?.targetSquare as string | null | undefined;

    if (!sourceSquare) {
      return false;
    }

    if (!targetSquare) {
      return false;
    }

    const isPlayersTurn =
      (playerSide === "white" && game.turn() === "w") ||
      (playerSide === "black" && game.turn() === "b");

    if (!isPlayersTurn) {
      return false;
    }

    try {
      const next = new Chess(game.fen());
      const move = next.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q",
      });

      if (move == null) {
        return false;
      }

      setGame(next);
      void maybePlayOpponentReply(next);
      return true;
    } catch {
      return false;
    }
  }

  function reset() {
    setStatus(null);
    const g = new Chess();
    if (initialFen) {
      try {
        g.load(initialFen);
      } catch {
        // ignore invalid fen
      }
    }
    setGame(g);
  }

  function undo() {
    setStatus(null);
    safeGameMutate((g) => {
      g.undo();
    });
  }

  function flipSide() {
    setPlayerSide((s) => (s === "white" ? "black" : "white"));
  }

  const fen = game.fen();
  const isGameOver = game.isGameOver();

  const outcome = (() => {
    if (!isGameOver) return null;
    if (game.isCheckmate()) return "Checkmate";
    if (game.isStalemate()) return "Stalemate";
    if (game.isThreefoldRepetition()) return "Threefold repetition";
    if (game.isInsufficientMaterial()) return "Insufficient material";
    if (game.isDraw()) return "Draw";
    return "Game over";
  })();

  return (
    <div className="grid gap-6 md:grid-cols-[420px_1fr]">
      <div
        ref={boardContainerRef}
        className="flex justify-center rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
      >
        <Chessboard
          options={{
            position: fen,
            onPieceDrop,
            boardOrientation: playerSide,
            animationDurationInMs: 150,
            showNotation: false,
            boardStyle: {
              width: boardWidth,
              height: boardWidth,
              display: "grid",
              gridTemplateColumns: `repeat(8, ${squareSize}px)`,
              gridTemplateRows: `repeat(8, ${squareSize}px)`,
              gap: 0,
              lineHeight: 0,
            },
            squareStyle: {
              width: squareSize,
              height: squareSize,
              lineHeight: 0,
            },
          }}
        />
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              onClick={reset}
            >
              Reset
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              onClick={undo}
            >
              Undo
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              onClick={flipSide}
            >
              Flip side
            </button>
          </div>

          <div className="mt-4 grid gap-2 text-sm text-zinc-700">
            <div>
              Turn: <span className="font-medium text-zinc-900">{game.turn() === "w" ? "White" : "Black"}</span>
            </div>
            <div>
              You play: <span className="font-medium text-zinc-900">{playerSide === "white" ? "White" : "Black"}</span>
            </div>
            {outcome ? (
              <div>
                Result: <span className="font-medium text-zinc-900">{outcome}</span>
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-medium text-zinc-900">Opponent simulation</div>
              <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={simulateOpponent}
                  onChange={(e) => setSimulateOpponent(e.target.checked)}
                />
                Enable
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-zinc-900" htmlFor="opp-username">
                  Opponent (Lichess username)
                </label>
                <input
                  id="opp-username"
                  className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  value={opponentUsername}
                  onChange={(e) => setOpponentUsername(e.target.value)}
                  placeholder="opponent_username"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-zinc-900" htmlFor="opp-mode">
                  Move selection
                </label>
                <select
                  id="opp-mode"
                  className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  value={opponentMode}
                  onChange={(e) => setOpponentMode(e.target.value as any)}
                >
                  <option value="proportional">Proportional (by frequency)</option>
                  <option value="random">Random (uniform)</option>
                </select>
              </div>
            </div>

            <div className="grid gap-2 text-sm text-zinc-700">
              <div>
                Depth remaining (approx):{" "}
                <span className="font-medium text-zinc-900">
                  {depthRemaining == null ? "—" : String(depthRemaining)}
                </span>
              </div>
              <div>
                Last opponent move:{" "}
                <span className="font-medium text-zinc-900">
                  {lastOpponentMove ? `${lastOpponentMove.san ?? lastOpponentMove.uci}` : "—"}
                </span>
              </div>
              {opponentCommentary ? (
                <div className="text-sm text-zinc-700">{opponentCommentary}</div>
              ) : null}
              {simulateOpponent ? (
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                  disabled={simBusy || !opponentUsername.trim() || isGameOver}
                  onClick={() => void maybePlayOpponentReply(game)}
                >
                  {simBusy ? "Thinking…" : "Opponent move now"}
                </button>
              ) : null}
            </div>
          </div>

          {status ? <div className="mt-3 text-sm text-zinc-600">{status}</div> : null}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">Moves</div>
          <div className="mt-3 grid gap-1 text-sm text-zinc-700">
            {game.history().length ? (
              <div className="whitespace-pre-wrap break-words">
                {game.history().map((m, idx) => (
                  <span key={idx}>
                    {m}
                    {idx < game.history().length - 1 ? " " : ""}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-zinc-600">No moves yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
