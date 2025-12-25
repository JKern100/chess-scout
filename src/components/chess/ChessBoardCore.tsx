"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

export type Side = "white" | "black";

export type ChessBoardCoreState = {
  game: Chess;
  fen: string;
  fenHistory: string[];
  redoFens: string[];
  playerSide: Side;
  setPlayerSide: (side: Side) => void;
  status: string | null;
  setStatus: (s: string | null) => void;
  isGameOver: boolean;
  outcome: string | null;
  squareSize: number;
  boardWidth: number;
  commitGame: (next: Chess) => void;
  reset: () => void;
  undoPlies: (count: number) => void;
  redoPlies: (count: number) => void;
  loadGameFromFen: (fen: string) => Chess | null;
};

type Props = {
  initialFen?: string;
  arrows?: any[] | ((state: ChessBoardCoreState) => any[]);
  onPieceDrop: (args: any, state: ChessBoardCoreState) => boolean;
  underBoard?: React.ReactNode;
  children: (state: ChessBoardCoreState) => React.ReactNode;
};

const PLAYER_SIDE_STORAGE_KEY = "chessscout_player_side";

export function ChessBoardCore({ initialFen, arrows, onPieceDrop, underBoard, children }: Props) {
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
  const [playerSide, setPlayerSideState] = useState<Side>("white");
  const [status, setStatus] = useState<string | null>(null);

  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const [boardWidth, setBoardWidth] = useState<number>(400);
  const fen = game.fen();

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
    redoFens,
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
  };

  const resolvedArrows = typeof arrows === "function" ? arrows(state) : (arrows ?? []);

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
              onPieceDrop: (args: any) => onPieceDrop(args, state),
              boardOrientation: playerSide,
              animationDurationInMs: 150,
              showNotation: false,
              allowDrawingArrows: false,
              arrows: resolvedArrows as any,
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

        {underBoard}
      </div>

      <div className="flex flex-col gap-4">{children(state)}</div>
    </div>
  );
}
