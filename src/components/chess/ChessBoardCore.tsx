"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useChessSounds } from "@/hooks/useChessSounds";

export type Side = "white" | "black";

export type ChessBoardCoreState = {
  game: Chess;
  fen: string;
  fenHistory: string[];
  moveHistory: string[];
  redoFens: string[];
  redoMoves: string[];
  playerSide: Side;
  setPlayerSide: (side: Side) => void;
  status: string | null;
  setStatus: (s: string | null) => void;
  isGameOver: boolean;
  outcome: string | null;
  squareSize: number;
  boardWidth: number;
  commitGame: (next: Chess, lastSan?: string | null) => void;
  reset: () => void;
  undoPlies: (count: number) => void;
  redoPlies: (count: number) => void;
  loadGameFromFen: (fen: string) => Chess | null;
  hydrateFromFenAndMoves: (startingFen: string, movesSan: string[]) => void;
};

type Props = {
  initialFen?: string;
  soundEnabled?: boolean;
  arrows?: any[] | ((state: ChessBoardCoreState) => any[]);
  squareStyles?: Record<string, React.CSSProperties> | ((state: ChessBoardCoreState) => Record<string, React.CSSProperties>);
  specialArrow?:
    | { startSquare: string; endSquare: string; intensity?: number }
    | ((state: ChessBoardCoreState) => { startSquare: string; endSquare: string; intensity?: number } | null);
  leftPanel?: React.ReactNode | ((state: ChessBoardCoreState) => React.ReactNode);
  aboveBoard?: React.ReactNode | ((state: ChessBoardCoreState) => React.ReactNode);
  belowBoard?: React.ReactNode | ((state: ChessBoardCoreState) => React.ReactNode);
  onPieceDrop: (args: any, state: ChessBoardCoreState) => boolean;
  underBoard?: React.ReactNode;
  children: (state: ChessBoardCoreState) => React.ReactNode;
};

const PLAYER_SIDE_STORAGE_KEY = "chessscout_player_side";

const BOARD_HEIGHT_STORAGE_KEY = "chessscout_analysis_board_height_px";

export function ChessBoardCore({ initialFen, soundEnabled = true, arrows, squareStyles, specialArrow, leftPanel, aboveBoard, belowBoard, onPieceDrop, underBoard, children }: Props) {
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
  const [moveHistory, setMoveHistory] = useState<string[]>(() => []);
  const [redoFens, setRedoFens] = useState<string[]>([]);
  const [redoMoves, setRedoMoves] = useState<string[]>([]);
  const [playerSide, setPlayerSideState] = useState<Side>("white");
  const [status, setStatus] = useState<string | null>(null);

  const [isMounted, setIsMounted] = useState(false);

  const [isLg, setIsLg] = useState(false);

  const desktopRowRef = useRef<HTMLDivElement | null>(null);
  const [desktopRowWidth, setDesktopRowWidth] = useState<number>(1200);

  const boardSlotRef = useRef<HTMLDivElement | null>(null);

  const [boardContainerSizePx, setBoardContainerSizePx] = useState<number>(600);

  const [boardHeightPx, setBoardHeightPx] = useState<number>(() => 550);
  const resizeDragRef = useRef<{ startY: number; startHeight: number; pointerId: number } | null>(null);

  const fen = game.fen();

  const { playMoveSound } = useChessSounds(soundEnabled);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(BOARD_HEIGHT_STORAGE_KEY);
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        setBoardHeightPx(Math.round(n));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(BOARD_HEIGHT_STORAGE_KEY, String(Math.round(boardHeightPx)));
    } catch {
      // ignore
    }
  }, [boardHeightPx]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PLAYER_SIDE_STORAGE_KEY);
      if (saved === "white" || saved === "black") {
        setPlayerSideState(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsLg(mql.matches);
    update();

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }

    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  useEffect(() => {
    const el = boardSlotRef.current;
    if (!el) return;

    const update = () => {
      // boardSlotRef is the *padded* center container. We want the board to expand until it hits
      // those padding edges while staying square.
      const w = Math.max(1, Math.floor(el.clientWidth));
      const h = Math.max(1, Math.floor(el.clientHeight));
      const FRAME_PAD_PX = 12;
      const raw = Math.max(1, Math.min(w, h) - FRAME_PAD_PX * 2);
      const square = Math.max(1, Math.floor(raw / 8));
      setBoardContainerSizePx(square * 8);
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLg]);

  function setPlayerSide(side: Side) {
    setPlayerSideState(side);
    try {
      window.localStorage.setItem(PLAYER_SIDE_STORAGE_KEY, side);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const el = desktopRowRef.current;
    if (!el) return;

    const update = () => {
      setDesktopRowWidth(Math.max(1, Math.floor(el.clientWidth)));
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxBoardHeightPx = useMemo(() => {
    const MIN_PX = 340;
    const LEFT_PX = 260;
    const RIGHT_PX = 360;
    const GAP_PX = 24;
    const CENTER_PAD_PX = 24;
    if (!isMounted || typeof window === "undefined") return 650;

    const top = boardSlotRef.current?.getBoundingClientRect().top ?? 0;
    const paddingAndHandle = 64;
    const maxByViewport = Math.max(MIN_PX, Math.floor(window.innerHeight - top - paddingAndHandle));

    const maxByWidth = Math.max(MIN_PX, Math.floor(desktopRowWidth - LEFT_PX - RIGHT_PX - GAP_PX - CENTER_PAD_PX));

    return Math.max(MIN_PX, Math.min(maxByViewport, maxByWidth));
  }, [desktopRowWidth, isMounted]);

  useEffect(() => {
    setBoardHeightPx((prev) => {
      const MIN_PX = 340;
      return Math.max(MIN_PX, Math.min(prev, maxBoardHeightPx));
    });
  }, [maxBoardHeightPx]);

  const effectiveBoardSizePx = useMemo(() => {
    const raw = Math.max(300, Math.floor(boardContainerSizePx));
    const square = Math.max(1, Math.floor(raw / 8));
    return square * 8;
  }, [boardContainerSizePx]);

  const boardWidth = effectiveBoardSizePx;
  const squareSize = Math.max(1, Math.floor(boardWidth / 8));

  function loadGameFromFen(fenValue: string) {
    const g = new Chess();
    try {
      g.load(fenValue);
    } catch {
      return null;
    }
    return g;
  }

  function commitGame(next: Chess, lastSan?: string | null) {
    const nextFen = next.fen();
    setGame(next);
    setMoveHistory((prevMoves) => {
      const san = typeof lastSan === "string" && lastSan.trim() ? lastSan.trim() : null;
      return san ? [...prevMoves, san] : prevMoves;
    });
    setFenHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last === nextFen) return prev;
      const san = typeof lastSan === "string" ? lastSan : "";
      const isCapture = san.includes("x");
      playMoveSound(isCapture);

      return [...prev, nextFen];
    });
    setRedoFens([]);
    setRedoMoves([]);
  }

  function hydrateFromFenAndMoves(startingFen: string, movesSan: string[]) {
    setStatus(null);
    const g = new Chess();
    try {
      g.load(startingFen);
    } catch {
      return;
    }

    const sanitized = Array.isArray(movesSan) ? movesSan.map((m) => String(m ?? "").trim()).filter((m) => m) : [];
    const applied: string[] = [];
    const fens: string[] = [g.fen()];

    for (const san of sanitized) {
      try {
        const played = g.move(san, { sloppy: true } as any);
        if (!played) break;
        applied.push(String(played.san ?? san));
        fens.push(g.fen());
      } catch {
        break;
      }
    }

    setGame(g);
    setFenHistory(fens);
    setMoveHistory(applied);
    setRedoFens([]);
    setRedoMoves([]);
  }

  function undoPlies(count: number) {
    setStatus(null);
    if (fenHistory.length <= 1) return;

    const clamped = Math.max(1, Math.min(count, fenHistory.length - 1));
    const nextFenHistory = fenHistory.slice(0, fenHistory.length - clamped);
    const removedFens = fenHistory.slice(fenHistory.length - clamped);

    const nextMoveHistory = moveHistory.slice(0, moveHistory.length - clamped);
    const removedMoves = moveHistory.slice(moveHistory.length - clamped);

    setFenHistory(nextFenHistory);
    setRedoFens([...removedFens, ...redoFens]);
    setMoveHistory(nextMoveHistory);
    setRedoMoves([...removedMoves, ...redoMoves]);

    const targetFen = nextFenHistory[nextFenHistory.length - 1];
    if (targetFen) {
      const g = loadGameFromFen(targetFen);
      if (g) setGame(g);
    }
  }

  function redoPlies(count: number) {
    setStatus(null);
    if (redoFens.length === 0) return;

    const clamped = Math.max(1, Math.min(count, redoFens.length));
    const toApplyFens = redoFens.slice(0, clamped);
    const remainingFens = redoFens.slice(clamped);

    const toApplyMoves = redoMoves.slice(0, clamped);
    const remainingMoves = redoMoves.slice(clamped);

    const nextFenHistory = [...fenHistory, ...toApplyFens];
    const nextMoveHistory = [...moveHistory, ...toApplyMoves];

    setRedoFens(remainingFens);
    setRedoMoves(remainingMoves);
    setFenHistory(nextFenHistory);
    setMoveHistory(nextMoveHistory);

    const targetFen = nextFenHistory[nextFenHistory.length - 1];
    if (targetFen) {
      const g = loadGameFromFen(targetFen);
      if (g) setGame(g);
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
    setMoveHistory([]);
    setRedoFens([]);
    setRedoMoves([]);
  }

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

  const state: ChessBoardCoreState = {
    game,
    fen,
    fenHistory,
    moveHistory,
    redoFens,
    redoMoves,
    playerSide,
    setPlayerSide,
    status,
    setStatus,
    isGameOver,
    outcome,
    squareSize,
    boardWidth,
    commitGame,
    reset,
    undoPlies,
    redoPlies,
    loadGameFromFen,
    hydrateFromFenAndMoves,
  };

  const resolvedArrows = typeof arrows === "function" ? arrows(state) : (arrows ?? []);
  const resolvedSquareStyles = typeof squareStyles === "function" ? squareStyles(state) : (squareStyles ?? {});
  const resolvedSpecialArrow =
    typeof specialArrow === "function" ? specialArrow(state) : (specialArrow ?? null);
  const resolvedLeftPanel = typeof leftPanel === "function" ? leftPanel(state) : (leftPanel ?? null);
  const resolvedAboveBoard = typeof aboveBoard === "function" ? aboveBoard(state) : (aboveBoard ?? null);
  const resolvedBelowBoard = typeof belowBoard === "function" ? belowBoard(state) : (belowBoard ?? null);

  const boardId = "chessscout-board";
  const specialMarkerEnd = resolvedSpecialArrow
    ? `url(#${boardId}-arrowhead-0-${resolvedSpecialArrow.startSquare}-${resolvedSpecialArrow.endSquare})`
    : null;

  const specialIntensity = (() => {
    const v = Number(resolvedSpecialArrow?.intensity ?? 0);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  })();

  const glowStrong = (0.55 + specialIntensity * 0.45).toFixed(3);
  const glowMid = (0.42 + specialIntensity * 0.38).toFixed(3);
  const glowSoft = (0.30 + specialIntensity * 0.30).toFixed(3);

  return (
    <div className="min-w-0">
      {isLg ? (
        <div className="flex h-[calc(100vh-80px)] min-w-0 flex-col gap-3 px-6 lg:flex-row lg:items-stretch lg:justify-center">
          <div ref={desktopRowRef} className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-stretch lg:justify-center">
            <div className="flex w-[260px] min-w-0 flex-none flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="min-w-0 overflow-y-auto overflow-x-hidden p-0">{resolvedLeftPanel}</div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col items-stretch justify-start lg:max-w-[calc(100vh-100px)]">
              {resolvedAboveBoard ? <div className="w-full min-w-0">{resolvedAboveBoard}</div> : null}

              <div className="relative flex min-w-0 items-start justify-center" style={{ height: boardHeightPx }}>
                <div ref={boardSlotRef} className="flex h-full w-full min-w-0 items-center justify-center overflow-hidden">
                  <div className="inline-flex max-h-full max-w-full items-center justify-center rounded-lg bg-neutral-900 p-3 shadow-2xl">
                    <div className="flex min-w-0 items-center justify-center" style={{ width: boardWidth, height: boardWidth }}>
                      <div data-chessscout-board={boardId} className="overflow-hidden" style={{ width: boardWidth, height: boardWidth }}>
                      {specialMarkerEnd ? (
                        <style>{`
                          [data-chessscout-board="${boardId}"] svg path[marker-end="${specialMarkerEnd}"] {
                            filter:
                              drop-shadow(0 0 2px rgba(34, 197, 94, ${glowStrong}))
                              drop-shadow(0 0 10px rgba(34, 197, 94, ${glowMid}))
                              drop-shadow(0 0 22px rgba(34, 197, 94, ${glowSoft}));
                            stroke-linecap: round;
                          }

                          [data-chessscout-board="${boardId}"] svg marker[id^="${boardId}-arrowhead-0-"] polygon {
                            filter:
                              drop-shadow(0 0 2px rgba(34, 197, 94, ${glowStrong}))
                              drop-shadow(0 0 10px rgba(34, 197, 94, ${glowMid}))
                              drop-shadow(0 0 22px rgba(34, 197, 94, ${glowSoft}));
                          }
                        `}</style>
                      ) : null}

                      <Chessboard
                        options={{
                          id: boardId,
                          position: fen,
                          onPieceDrop: (args: any) => onPieceDrop(args, state),
                          boardOrientation: playerSide,
                          animationDurationInMs: 150,
                          showNotation: false,
                          allowDrawingArrows: false,
                          arrows: resolvedArrows,
                          squareStyles: resolvedSquareStyles,
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
                    </div>
                  </div>
                </div>

                <div
                  className="absolute bottom-0 left-0 right-0 h-4 cursor-ns-resize"
                  onPointerDown={(e) => {
                    if (typeof window === "undefined") return;
                    const pointerId = e.pointerId;
                    resizeDragRef.current = { startY: e.clientY, startHeight: boardHeightPx, pointerId };
                    try {
                      (e.currentTarget as HTMLDivElement).setPointerCapture(pointerId);
                    } catch {
                      // ignore
                    }
                  }}
                  onPointerMove={(e) => {
                    const drag = resizeDragRef.current;
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    const dy = e.clientY - drag.startY;
                    const next = drag.startHeight + dy;
                    setBoardHeightPx(Math.max(340, Math.min(next, maxBoardHeightPx)));
                  }}
                  onPointerUp={(e) => {
                    const drag = resizeDragRef.current;
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    resizeDragRef.current = null;
                    try {
                      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
                    } catch {
                      // ignore
                    }
                  }}
                  onPointerCancel={(e) => {
                    const drag = resizeDragRef.current;
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    resizeDragRef.current = null;
                    try {
                      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
                    } catch {
                      // ignore
                    }
                  }}
                />
              </div>

              {resolvedBelowBoard ? <div className="w-full min-w-0">{resolvedBelowBoard}</div> : null}
              {underBoard}
            </div>

            <div className="flex w-[360px] min-w-0 flex-none flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="flex h-full min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden p-3">{children(state)}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-col gap-3">
            {resolvedAboveBoard ? <div>{resolvedAboveBoard}</div> : null}
            <div className="flex items-center justify-center">
              <div ref={boardSlotRef} className="inline-flex max-w-full items-center justify-center rounded-2xl bg-neutral-900 p-3 shadow-2xl">
                <div className="flex items-center justify-center" style={{ width: boardWidth, height: boardWidth }}>
                  <div data-chessscout-board={boardId} style={{ width: boardWidth, height: boardWidth }}>
                  {specialMarkerEnd ? (
                    <style>{`
                      [data-chessscout-board="${boardId}"] svg path[marker-end="${specialMarkerEnd}"] {
                        filter:
                          drop-shadow(0 0 2px rgba(34, 197, 94, ${glowStrong}))
                          drop-shadow(0 0 10px rgba(34, 197, 94, ${glowMid}))
                          drop-shadow(0 0 22px rgba(34, 197, 94, ${glowSoft}));
                        stroke-linecap: round;
                      }

                      [data-chessscout-board="${boardId}"] svg marker[id^="${boardId}-arrowhead-0-"] polygon {
                        filter:
                          drop-shadow(0 0 2px rgba(34, 197, 94, ${glowStrong}))
                          drop-shadow(0 0 10px rgba(34, 197, 94, ${glowMid}))
                          drop-shadow(0 0 22px rgba(34, 197, 94, ${glowSoft}));
                      }
                    `}</style>
                  ) : null}

                  <Chessboard
                    options={{
                      id: boardId,
                      position: fen,
                      onPieceDrop: (args: any) => onPieceDrop(args, state),
                      boardOrientation: playerSide,
                      animationDurationInMs: 150,
                      showNotation: false,
                      allowDrawingArrows: false,
                      arrows: resolvedArrows,
                      squareStyles: resolvedSquareStyles,
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
                </div>
              </div>
            </div>

            {resolvedBelowBoard ? <div>{resolvedBelowBoard}</div> : null}
            {resolvedLeftPanel ? <div className="grid gap-4">{resolvedLeftPanel}</div> : null}
            {underBoard}
          </div>

          <div className="min-w-0">{children(state)}</div>
        </div>
      )}
    </div>
  );
}
