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
  const [fenHistory, setFenHistory] = useState<string[]>(() => [initialGame.fen()]);
  const [redoFens, setRedoFens] = useState<string[]>([]);
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
  const [simWarmStatus, setSimWarmStatus] = useState<"idle" | "warming" | "warm" | "error">("idle");
  const [simWarmMeta, setSimWarmMeta] = useState<{ status: string; buildMs: number; maxGames: number } | null>(
    null
  );
  const [showOpponentArrow, setShowOpponentArrow] = useState(false);
  const [showOpponentMoveTable, setShowOpponentMoveTable] = useState(false);
  const [opponentMovesTab, setOpponentMovesTab] = useState<"moves" | "tab2">("moves");
  const [opponentStats, setOpponentStats] = useState<{
    totalCountOpponent: number;
    totalCountAgainst: number;
    movesOpponent: Array<{
      uci: string;
      san: string | null;
      played_count: number;
      win: number;
      loss: number;
      draw: number;
    }>;
    movesAgainst: Array<{
      uci: string;
      san: string | null;
      played_count: number;
      win: number;
      loss: number;
      draw: number;
    }>;
  } | null>(null);
  const [opponentStatsBusy, setOpponentStatsBusy] = useState(false);
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const [boardWidth, setBoardWidth] = useState<number>(400);

  const squareSize = Math.floor(boardWidth / 8);

  function loadGameFromFen(fen: string) {
    const g = new Chess();
    try {
      g.load(fen);
    } catch {
      return null;
    }
    return g;
  }

  function commitGame(next: Chess) {
    const nextFen = next.fen();
    setGame(next);
    setFenHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last === nextFen) return prev;
      return [...prev, nextFen];
    });
    setRedoFens([]);
  }

  function undoPlies(count: number) {
    setStatus(null);
    setFenHistory((prev) => {
      if (prev.length <= 1) return prev;

      const clamped = Math.max(1, Math.min(count, prev.length - 1));
      const nextHistory = prev.slice(0, prev.length - clamped);
      const removed = prev.slice(prev.length - clamped);

      setRedoFens((r) => [...removed.reverse(), ...r]);

      const targetFen = nextHistory[nextHistory.length - 1];
      if (targetFen) {
        const g = loadGameFromFen(targetFen);
        if (g) setGame(g);
      }

      return nextHistory;
    });
  }

  function redoPlies(count: number) {
    setStatus(null);
    setRedoFens((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;

      const clamped = Math.max(1, Math.min(count, prevRedo.length));
      const toApply = prevRedo.slice(0, clamped);
      const remaining = prevRedo.slice(clamped);

      setFenHistory((h) => {
        const next = [...h, ...toApply];
        const targetFen = next[next.length - 1];
        if (targetFen) {
          const g = loadGameFromFen(targetFen);
          if (g) setGame(g);
        }
        return next;
      });

      return remaining;
    });
  }

  function formatPct(n: number) {
    if (!Number.isFinite(n)) return "0%";
    const clamped = Math.max(0, Math.min(1, n));
    return `${Math.round(clamped * 100)}%`;
  }

  function formatGameCount(value: number) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(Math.round(n));
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
    prefetch?: boolean;
  }) {
    const res = await fetch("/api/sim/next-move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: "lichess",
        username: params.username,
        fen: params.fen,
        mode: params.mode,
        max_depth: 16,
        prefetch: params.prefetch ?? false,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error ?? "Opponent simulation failed");
    }
    return json as any;
  }

  async function fetchOpponentStats(params: { fen: string; username: string }) {
    const json = await requestOpponentMove({
      fen: params.fen,
      username: params.username,
      mode: "proportional",
      prefetch: false,
    });
    const moves = Array.isArray(json?.moves) ? (json.moves as any[]) : [];
    const movesAgainst = Array.isArray(json?.moves_against) ? (json.moves_against as any[]) : [];
    const normalized = moves.map((m) => ({
      uci: String(m.uci),
      san: (m.san as string | null) ?? null,
      played_count: Number(m.played_count ?? 0),
      win: Number(m.win ?? 0),
      loss: Number(m.loss ?? 0),
      draw: Number(m.draw ?? 0),
    }));
    const normalizedAgainst = movesAgainst.map((m) => ({
      uci: String(m.uci),
      san: (m.san as string | null) ?? null,
      played_count: Number(m.played_count ?? 0),
      win: Number(m.win ?? 0),
      loss: Number(m.loss ?? 0),
      draw: Number(m.draw ?? 0),
    }));
    return {
      totalCountOpponent: Number(json?.available_total_count ?? 0),
      totalCountAgainst: Number(json?.available_against_total_count ?? 0),
      movesOpponent: normalized,
      movesAgainst: normalizedAgainst,
    };
  }

  useEffect(() => {
    if (!simulateOpponent) return;
    const trimmed = opponentUsername.trim();
    if (!trimmed) return;

    let cancelled = false;
    setSimWarmStatus("warming");

    void requestOpponentMove({
      fen: new Chess().fen(),
      username: trimmed,
      mode: opponentMode,
      prefetch: true,
    })
      .then((json) => {
        if (cancelled) return;
        setSimWarmMeta({
          status: String(json?.cache?.status ?? ""),
          buildMs: Number(json?.cache?.build_ms ?? 0),
          maxGames: Number(json?.cache?.max_games ?? 0),
        });
        setSimWarmStatus("warm");
      })
      .catch(() => {
        if (cancelled) return;
        setSimWarmStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [simulateOpponent, opponentUsername, opponentMode]);

  useEffect(() => {
    if (!simulateOpponent) {
      setOpponentStats(null);
      return;
    }
    const trimmed = opponentUsername.trim();
    if (!trimmed) {
      setOpponentStats(null);
      return;
    }

    if (!showOpponentArrow && !showOpponentMoveTable) {
      return;
    }

    let cancelled = false;
    setOpponentStatsBusy(true);

    void fetchOpponentStats({ fen: game.fen(), username: trimmed })
      .then((stats) => {
        if (cancelled) return;
        setOpponentStats(stats);
      })
      .finally(() => {
        if (cancelled) return;
        setOpponentStatsBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [simulateOpponent, opponentUsername, showOpponentArrow, showOpponentMoveTable, game]);

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
      commitGame(reply);
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

      commitGame(next);
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
    setFenHistory([g.fen()]);
    setRedoFens([]);
    setOpponentCommentary(null);
  }

  function undo() {
    undoPlies(1);
  }

  function undoFullMove() {
    undoPlies(2);
  }

  function redo() {
    redoPlies(1);
  }

  function flipSide() {
    setPlayerSide((s) => (s === "white" ? "black" : "white"));
  }

  const fen = game.fen();
  const isGameOver = game.isGameOver();

  const userColor = playerSide === "white" ? "w" : "b";
  const opponentColor = userColor === "w" ? "b" : "w";
  const isOppToMove = game.turn() === opponentColor;

  const nextMoveList = useMemo(() => {
    if (!opponentStats) return { total: 0, moves: [] as NonNullable<typeof opponentStats>["movesOpponent"] };
    if (isOppToMove) return { total: opponentStats.totalCountOpponent, moves: opponentStats.movesOpponent };
    return { total: opponentStats.totalCountAgainst, moves: opponentStats.movesAgainst };
  }, [opponentStats, isOppToMove]);

  const opponentArrow = useMemo(() => {
    if (!simulateOpponent) return [];
    if (!showOpponentArrow) return [];
    const trimmed = opponentUsername.trim();
    if (!trimmed) return [];
    const first = nextMoveList.moves?.[0];
    if (!first?.uci) return [];
    const uci = String(first.uci);
    if (uci.length < 4) return [];
    return [
      {
        startSquare: uci.slice(0, 2),
        endSquare: uci.slice(2, 4),
        color: "rgba(37, 99, 235, 0.9)",
      },
    ];
  }, [simulateOpponent, showOpponentArrow, opponentUsername, nextMoveList]);

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
      <div className="flex flex-col gap-3">
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
              allowDrawingArrows: false,
              arrows: opponentArrow as any,
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

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={showOpponentArrow}
                onChange={(e) => setShowOpponentArrow(e.target.checked)}
              />
              Show most common next move
            </label>

            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              onClick={() => {
                setShowOpponentMoveTable((v) => {
                  const next = !v;
                  if (next) setOpponentMovesTab("moves");
                  return next;
                });
              }}
            >
              {showOpponentMoveTable ? "Hide opponent moves" : "Show opponent moves"}
            </button>
          </div>
        </div>

        {showOpponentMoveTable ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-zinc-900">Opponent moves</div>
              <div className="inline-flex overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <button
                  type="button"
                  className={
                    opponentMovesTab === "moves"
                      ? "h-9 px-3 text-sm font-medium text-zinc-900"
                      : "h-9 px-3 text-sm font-medium text-zinc-600 hover:text-zinc-900"
                  }
                  onClick={() => setOpponentMovesTab("moves")}
                >
                  Moves
                </button>
                <div className="h-9 w-px bg-zinc-200" />
                <button
                  type="button"
                  className={
                    opponentMovesTab === "tab2"
                      ? "h-9 px-3 text-sm font-medium text-zinc-900"
                      : "h-9 px-3 text-sm font-medium text-zinc-600 hover:text-zinc-900"
                  }
                  onClick={() => setOpponentMovesTab("tab2")}
                >
                  Tab 2
                </button>
              </div>
            </div>

            <div className="mt-3">
              {opponentMovesTab === "moves" ? (
                <div className="grid gap-2">
                  {opponentStatsBusy ? (
                    <div className="text-sm text-zinc-600">Loading…</div>
                  ) : nextMoveList.moves?.length ? (
                    <div className="grid gap-2">
                      <div className="grid grid-cols-[80px_80px_1fr_56px] gap-2 text-xs font-medium text-zinc-500">
                        <div>Move</div>
                        <div>Games</div>
                        <div>Results</div>
                        <div className="text-right">%</div>
                      </div>
                      {nextMoveList.moves.slice(0, 12).map((m) => {
                        const total = Math.max(1, m.played_count);
                        const winPct = (m.win / total) * 100;
                        const drawPct = (m.draw / total) * 100;
                        const lossPct = (m.loss / total) * 100;
                        const freq = nextMoveList.total > 0 ? m.played_count / nextMoveList.total : 0;
                        const freqPct = Math.round(freq * 100);

                        return (
                          <div
                            key={m.uci}
                            className="grid grid-cols-[80px_80px_1fr_56px] items-center gap-2"
                          >
                            <div className="text-sm font-medium text-zinc-900">{m.san ?? m.uci}</div>
                            <div className="text-sm font-medium text-zinc-700">
                              {formatGameCount(m.played_count)}
                            </div>
                            <div className="h-3 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
                              <div className="flex h-full w-full">
                                <div
                                  className="h-full bg-emerald-500"
                                  style={{ width: `${winPct}%` }}
                                  title={`Win: ${m.win}`}
                                />
                                <div
                                  className="h-full bg-zinc-300"
                                  style={{ width: `${drawPct}%` }}
                                  title={`Draw: ${m.draw}`}
                                />
                                <div
                                  className="h-full bg-rose-500"
                                  style={{ width: `${lossPct}%` }}
                                  title={`Loss: ${m.loss}`}
                                />
                              </div>
                            </div>
                            <div className="text-right text-sm font-medium text-zinc-700">{freqPct}%</div>
                          </div>
                        );
                      })}
                      <div className="text-xs text-zinc-500">Showing top 12 moves.</div>
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-600">No data for this position.</div>
                  )}
                </div>
              ) : (
                <div className="min-h-16" />
              )}
            </div>
          </div>
        ) : null}
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
              className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              onClick={undoFullMove}
              disabled={fenHistory.length <= 2}
            >
              Undo full move
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              onClick={redo}
              disabled={redoFens.length === 0}
            >
              Redo
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
              {simulateOpponent ? (
                <div>
                  Cache: <span className="font-medium text-zinc-900">
                    {simWarmStatus === "warming"
                      ? "Warming…"
                      : simWarmStatus === "warm"
                        ? "Warm"
                        : simWarmStatus === "error"
                          ? "Error"
                          : "—"}
                  </span>
                  {simWarmStatus === "warm" && simWarmMeta ? (
                    <span className="text-zinc-600"> {`(${simWarmMeta.status || "?"}, build ${Math.round(simWarmMeta.buildMs)}ms, ${simWarmMeta.maxGames} games)`}</span>
                  ) : null}
                </div>
              ) : null}
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
