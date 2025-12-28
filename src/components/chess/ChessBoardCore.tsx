"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

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

export function ChessBoardCore({ initialFen, arrows, squareStyles, specialArrow, leftPanel, aboveBoard, belowBoard, onPieceDrop, underBoard, children }: Props) {
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

  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const [boardWidth, setBoardWidth] = useState<number>(400);
  const fen = game.fen();

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);

  function ensureAudioUnlocked() {
    if (audioUnlockedRef.current) return;
    if (typeof window === "undefined") return;

    const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new Ctx();
    }

    const ctx = audioCtxRef.current;
    if (!ctx) return;

    // Try to resume; if it works we consider audio unlocked.
    void ctx.resume().then(() => {
      audioUnlockedRef.current = true;
    });
  }

  function playMoveClick() {
    if (typeof window === "undefined") return;
    if (!audioUnlockedRef.current) return;

    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Short percussive click.
    osc.type = "square";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.03);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);

    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };
  }

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

    const unlock = () => ensureAudioUnlocked();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  function setPlayerSide(side: Side) {
    setPlayerSideState(side);
    try {
      window.localStorage.setItem(PLAYER_SIDE_STORAGE_KEY, side);
    } catch {
      // ignore
    }
  }

  const squareSize = Math.floor(boardWidth / 8);

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
      playMoveClick();
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
    <div className="grid gap-7 md:grid-cols-[420px_1fr] xl:grid-cols-[260px_420px_1fr]">
      <div className="hidden xl:flex xl:flex-col xl:gap-4">{resolvedLeftPanel}</div>
      <div className="flex flex-col gap-3">
        {resolvedAboveBoard ? <div>{resolvedAboveBoard}</div> : null}
        <div
          ref={boardContainerRef}
          data-chessscout-board={boardId}
          className="flex justify-center rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm"
        >
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

        {resolvedBelowBoard ? <div>{resolvedBelowBoard}</div> : null}

        {resolvedLeftPanel ? <div className="grid gap-4 xl:hidden">{resolvedLeftPanel}</div> : null}

        {underBoard}
      </div>

      <div className="flex flex-col gap-4">{children(state)}</div>
    </div>
  );
}
