"use client";

import { Chess } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  GitBranch,
  Info,
  Loader2,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { getBestMoveForPlay, type EngineScore } from "@/lib/engine/engineService";
import { ChessBoardCore, type ChessBoardCoreState } from "./ChessBoardCore";
import { SimulationRightSidebar } from "./SimulationRightSidebar";
import { AnalysisBoard } from "./AnalysisBoard";
import { LichessBookTab } from "./LichessBookTab";
import { ScoutOverlay, ScoutPanelContent, type OpponentReplyForecast } from "./ScoutOverlay";
import { useScoutPrediction } from "@/lib/hooks/useScoutPrediction";
import { OpponentFiltersPanel } from "./OpponentFiltersPanel";
import { buildFiltersKey, DEFAULT_SPEEDS, getDateRangeFromPreset, useOpponentFilters } from "./useOpponentFilters";
import { StyleSpectrumBar, type StyleSpectrumData } from "@/components/profile/StyleSpectrumBar";
import { useImportsRealtime } from "@/lib/hooks/useImportsRealtime";
import { fetchLichessStats, type LichessExplorerMove, type ExplorerSource } from "@/lib/lichess/explorer";
import { useImportQueue } from "@/context/ImportQueueContext";
import { useActiveOpponent } from "@/context/ActiveOpponentContext";
import { sanToFigurine } from "@/components/chess/FigurineIcon";

type Props = {
  initialFen?: string;
};

type StoredStyleMarker = {
  marker_key: string;
  label: string;
  strength: "Strong" | "Medium" | "Light";
  tooltip: string;
  metrics_json?: any;
};

function spectrumPctFromDiffRatio(diffRatio: unknown) {
  const d = typeof diffRatio === "number" ? diffRatio : Number(diffRatio);
  if (!Number.isFinite(d)) return 50;
  const clamped = Math.max(-0.4, Math.min(0.4, d));
  return 50 + (clamped / 0.4) * 50;
}

type OpeningCategory = "Open" | "Semi-Open" | "Closed" | "Indian" | "Flank";

/** Classify opening category from the first two moves (same logic as styleMarkerService) */
function classifyOpeningCategory(moves: string[]): OpeningCategory {
  const normalize = (m: string | undefined) => m?.replace(/[+#!?]+$/, "").trim() ?? "";
  const m1 = normalize(moves[0]);
  const m2 = normalize(moves[1]);

  if (!m1) return "Open"; // Default

  // 1.e4
  if (m1 === "e4") {
    if (m2 === "e5") return "Open";
    return "Semi-Open"; // c5, e6, c6, d6, d5, Nf6, g6, etc.
  }

  // 1.d4
  if (m1 === "d4") {
    if (m2 === "d5") return "Closed";
    if (m2 === "Nf6") return "Indian";
    return "Closed"; // Default for other d4 responses
  }

  // Flank openings: c4, Nf3, g3, b3, f4, etc.
  if (["c4", "Nf3", "g3", "b3", "f4", "b4", "Nc3"].includes(m1)) {
    return "Flank";
  }

  return "Flank"; // Default for other first moves
}

/** Map axis key to context_matrix field name */
function getAxisFieldName(axisKey: string): "queen_trade" | "aggression" | "game_length" | "castling_timing" | "opposite_castling" {
  switch (axisKey) {
    case "queen_trade_rate": return "queen_trade";
    case "aggression_m15_avg": return "aggression";
    case "avg_game_length": return "game_length";
    case "avg_castle_ply": return "castling_timing";
    case "opposite_castle_rate": return "opposite_castling";
    default: return "aggression";
  }
}

function extractSpectrumData(
  marker: StoredStyleMarker | null,
  config: {
    valueKey: string;
    benchmarkKey: string;
    maxRaw: number;
    colorFilter?: "overall" | "white" | "black";
    categoryFilter?: string;
  }
): StyleSpectrumData | undefined {
  if (!marker?.metrics_json) return undefined;
  const m = marker.metrics_json as any;
  const colorFilter = config.colorFilter ?? "overall";
  const categoryFilter = config.categoryFilter ?? null;
  
  let opponentRaw: number | undefined;
  let benchmarkRaw: number | undefined;
  let sampleSize: number | undefined;
  let category: string | undefined = typeof m.category === "string" ? m.category : undefined;
  
  const contextual = m.contextual;
  const contextMatrix = contextual?.context_matrix?.matrix as Array<{
    category: string;
    color: "white" | "black";
    sample_size: number;
    queen_trade: { value: number; benchmark: number; sample_size: number };
    aggression: { value: number; benchmark: number; sample_size: number };
    game_length: { value: number; benchmark: number; sample_size: number };
    castling_timing: { value: number; benchmark: number; sample_size: number };
    opposite_castling: { value: number; benchmark: number; sample_size: number };
  }> | undefined;

  // Try to get value from Context Matrix if category+color specified
  if (contextMatrix && categoryFilter && colorFilter !== "overall") {
    const axisField = getAxisFieldName(config.valueKey);
    const entry = contextMatrix.find(
      (e) => e.category === categoryFilter && e.color === colorFilter
    );
    if (entry) {
      const axisData = entry[axisField];
      if (axisData) {
        opponentRaw = axisData.value;
        benchmarkRaw = axisData.benchmark;
        sampleSize = axisData.sample_size;
        category = categoryFilter;
      }
    }
  }
  
  // Try color-only filter from summary (no category filter)
  if (opponentRaw === undefined && contextual?.summary && colorFilter !== "overall" && !categoryFilter) {
    const colorData = contextual.summary[colorFilter];
    if (colorData && typeof colorData.value === "number") {
      opponentRaw = colorData.value;
      sampleSize = typeof colorData.sample_size === "number" ? colorData.sample_size : undefined;
    }
  }
  
  // Fall back to overall value
  if (opponentRaw === undefined) {
    opponentRaw = typeof m[config.valueKey] === "number" ? m[config.valueKey] : undefined;
  }
  if (benchmarkRaw === undefined) {
    benchmarkRaw = typeof m[config.benchmarkKey] === "number" ? m[config.benchmarkKey] : undefined;
  }
  
  if (opponentRaw === undefined || benchmarkRaw === undefined) return undefined;
  
  // Get available categories from contextual data
  const availableCategories = contextual?.available_categories ?? [];
  
  return { opponentRaw, benchmarkRaw, maxRaw: config.maxRaw, category, sampleSize, availableCategories, colorFilter };
}

type Mode = "simulation" | "analysis";

type Strategy = "proportional" | "random";

type AnalysisRightTab = "stats" | "filters" | "preferences" | "lichess" | "scout";

type SimulationRightTab = "filters" | "settings" | "scout";

type SavedLine = {
  id: string;
  starting_fen: string;
  moves_san: string[];
  final_fen: string;
  name: string;
  notes: string | null;
};

function MovesSoFarPanel(props: { state: ChessBoardCoreState; opponentUsername: string }) {
  const { state, opponentUsername } = props;

  const [saveLineOpen, setSaveLineOpen] = useState(false);
  const [saveLineName, setSaveLineName] = useState<string>("");
  const [saveLineNotes, setSaveLineNotes] = useState<string>("");
  const [saveLineBusy, setSaveLineBusy] = useState(false);
  const [saveLineToast, setSaveLineToast] = useState<string | null>(null);

  const allMoves = useMemo(() => {
    return [...state.moveHistory, ...state.redoMoves];
  }, [state.moveHistory, state.redoMoves]);

  const selectedPly = state.moveHistory.length - 1;

  function goToPly(ply: number) {
    const targetLen = ply + 1;
    const currentLen = state.moveHistory.length;
    const delta = targetLen - currentLen;
    if (delta === 0) return;
    if (delta > 0) state.redoPlies(delta);
    else state.undoPlies(-delta);
  }

  const canGoBack = state.moveHistory.length > 0;
  const canGoForward = state.redoMoves.length > 0;
  const canReset = state.moveHistory.length > 0 || state.redoMoves.length > 0;

  useEffect(() => {
    if (!saveLineToast) return;
    const t = window.setTimeout(() => setSaveLineToast(null), 2000);
    return () => window.clearTimeout(t);
  }, [saveLineToast]);

  function buildDefaultLineName() {
    const opp = opponentUsername.trim() ? opponentUsername.trim() : "Opponent";
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `vs ${opp} — ${yyyy}-${mm}-${dd}`;
  }

  async function submitSaveLine() {
    if (saveLineBusy) return;
    const name = saveLineName.trim();
    if (!name) return;

    const startingFen = state.fenHistory[0] ?? new Chess().fen();
    const movesSan = [...state.moveHistory];
    const finalFen = state.fen;

    setSaveLineBusy(true);
    try {
      const trimmedOpp = opponentUsername.trim();
      const res = await fetch("/api/saved-lines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "analysis",
          platform: trimmedOpp ? "lichess" : null,
          opponent_platform: trimmedOpp ? "lichess" : null,
          opponent_username: trimmedOpp ? trimmedOpp : null,
          starting_fen: startingFen,
          moves_san: movesSan,
          final_fen: finalFen,
          name,
          notes: saveLineNotes.trim() ? saveLineNotes : null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = String((json as any)?.error ?? "Could not save line");
        throw new Error(msg);
      }

      setSaveLineOpen(false);
      setSaveLineToast("Line saved!");
    } catch {
      setSaveLineToast("Could not save line");
    } finally {
      setSaveLineBusy(false);
    }
  }

  return (
    <>
      {saveLineOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => (saveLineBusy ? null : setSaveLineOpen(false))}
            aria-label="Close save line dialog"
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl">
            <div className="text-sm font-medium text-zinc-900">Save Line</div>

            <div className="mt-3 grid gap-3">
              <div className="grid gap-1">
                <label className="text-[10px] font-medium text-zinc-900">Line name</label>
                <input
                  className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] text-zinc-900 outline-none focus:border-zinc-400"
                  value={saveLineName}
                  onChange={(e) => setSaveLineName(e.target.value)}
                  placeholder="Line name"
                />
              </div>

              <div className="grid gap-1">
                <label className="text-[10px] font-medium text-zinc-900">Notes</label>
                <textarea
                  className="min-h-24 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[10px] text-zinc-900 outline-none focus:border-zinc-400"
                  value={saveLineNotes}
                  onChange={(e) => setSaveLineNotes(e.target.value)}
                  placeholder="Optional notes"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                onClick={() => setSaveLineOpen(false)}
                disabled={saveLineBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-3 text-[10px] font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                onClick={() => void submitSaveLine()}
                disabled={saveLineBusy || !saveLineName.trim()}
              >
                {saveLineBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="text-[10px] font-medium text-zinc-900">Moves so Far</div>
        <div className="mt-2 grid gap-2 text-[10px] text-zinc-700">
          <div className="flex items-center justify-center">
            <div className="flex w-full max-w-full items-center justify-center">
              <div className="flex w-full max-w-full items-center justify-between gap-1 overflow-hidden rounded-xl border border-zinc-200 bg-white px-1 py-1">
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                title="First move"
                disabled={!canGoBack}
                onClick={() => goToPly(-1)}
              >
                <ChevronsLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                title="Previous move"
                disabled={!canGoBack}
                onClick={() => state.undoPlies(1)}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                title="Next move"
                disabled={!canGoForward}
                onClick={() => state.redoPlies(1)}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                title="Last move"
                disabled={!canGoForward}
                onClick={() => goToPly(allMoves.length - 1)}
              >
                <ChevronsRight className="h-5 w-5" />
              </button>
              <div className="h-6 w-px shrink-0 bg-zinc-200" />
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                title="Reset"
                disabled={!canReset}
                onClick={() => state.reset()}
              >
                <RotateCcw className="h-5 w-5" />
              </button>
              </div>
            </div>
          </div>

          {allMoves.length ? (
            <div className="w-full min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="grid grid-cols-[44px_1fr_1fr] bg-zinc-50 text-[10px] font-medium text-zinc-500">
                <div className="px-2 py-1">#</div>
                <div className="px-2 py-1">White</div>
                <div className="px-2 py-1">Black</div>
              </div>

              {Array.from({ length: Math.ceil(allMoves.length / 2) }).map((_, rowIdx) => {
                const whitePly = rowIdx * 2;
                const blackPly = rowIdx * 2 + 1;
                const whiteMove = allMoves[whitePly] ?? null;
                const blackMove = allMoves[blackPly] ?? null;

                const whiteSelected = selectedPly === whitePly;
                const blackSelected = selectedPly === blackPly;

                return (
                  <div key={rowIdx} className="grid grid-cols-[44px_1fr_1fr] border-t border-zinc-200">
                    <div className="px-2 py-1 text-zinc-500">{rowIdx + 1}.</div>
                    <button
                      type="button"
                      className={`px-2 py-1 text-left font-medium ${
                        whiteSelected ? "bg-sky-100 text-sky-900" : "hover:bg-zinc-50"
                      }`}
                      disabled={!whiteMove}
                      onClick={() => (whiteMove ? goToPly(whitePly) : null)}
                    >
                      {whiteMove ? sanToFigurine(whiteMove, true) : ""}
                    </button>
                    <button
                      type="button"
                      className={`px-2 py-1 text-left font-medium ${
                        blackSelected ? "bg-sky-100 text-sky-900" : "hover:bg-zinc-50"
                      }`}
                      disabled={!blackMove}
                      onClick={() => (blackMove ? goToPly(blackPly) : null)}
                    >
                      {blackMove ? sanToFigurine(blackMove, false) : ""}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-zinc-600">No moves yet.</div>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-medium text-zinc-900 hover:bg-zinc-50"
              onClick={() => {
                setSaveLineName(buildDefaultLineName());
                setSaveLineNotes("");
                setSaveLineOpen(true);
              }}
            >
              Save Line
            </button>

            {saveLineToast ? <div className="text-[10px] text-zinc-600">{saveLineToast}</div> : null}
          </div>
        </div>
      </div>
    </>
  );
}

function SavedLineHydrator(props: {
  state: ChessBoardCoreState;
  savedLineId: string;
  enabled: boolean;
  onLoaded: (name: string) => void;
  onError: (msg: string) => void;
}) {
  const { state, savedLineId, enabled, onLoaded, onError } = props;
  const lastAppliedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (lastAppliedIdRef.current === savedLineId) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/saved-lines?id=${encodeURIComponent(savedLineId)}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String((json as any)?.error ?? "Failed to load saved line"));
        const sl = (json as any)?.saved_line as SavedLine | undefined;
        if (!sl || !sl.starting_fen) throw new Error("Saved line not found");
        if (cancelled) return;

        state.hydrateFromFenAndMoves(sl.starting_fen, Array.isArray(sl.moves_san) ? sl.moves_san : []);
        lastAppliedIdRef.current = savedLineId;
        onLoaded(sl.name);
      } catch (e) {
        if (cancelled) return;
        lastAppliedIdRef.current = savedLineId;
        onError(e instanceof Error ? e.message : "Failed to load saved line");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, savedLineId, state, onLoaded, onError]);

  return null;
}

type TimeControlCategory = "bullet" | "blitz" | "rapid" | "classical";

type TimeControlPreset = {
  key: string;
  label: string;
  baseMinutes: number;
  incrementSeconds: number;
  category: TimeControlCategory;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatEvalForDisplay(score: EngineScore | null) {
  if (!score) return "—";
  if (score.type === "mate") {
    const n = Math.trunc(score.value);
    if (!Number.isFinite(n)) return "—";
    return `#${n}`;
  }
  const cp = Number(score.value);
  if (!Number.isFinite(cp)) return "—";
  const pawns = cp / 100;
  const fixed = pawns.toFixed(1);
  if (Math.abs(pawns) < 0.05) return "0.0";
  return pawns > 0 ? `+${fixed}` : fixed;
}

function formatClock(ms: number) {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (safe < 60_000) {
    const tenths = Math.floor((safe % 1000) / 100);
    return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function randomInt(min: number, max: number) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function computeOpponentThinkDelayMs(category: TimeControlCategory, remainingMs: number) {
  // Training realism, not punishment: keep responsive.
  // Also never burn more than a small fraction of remaining time.
  const [baseMin, baseMax] =
    category === "bullet"
      ? [150, 400]
      : category === "blitz"
        ? [300, 900]
        : category === "rapid"
          ? [600, 1500]
          : [900, 2200];

  const raw = randomInt(baseMin, baseMax);
  const cap = Math.max(0, Math.min(remainingMs - 50, Math.floor(remainingMs * 0.25)));
  return Math.max(0, Math.min(raw, cap));
}

type Stats = {
  totalCountOpponent: number;
  totalCountAgainst: number;
  depthRemaining: number | null;
  movesOpponent: Array<{ uci: string; san: string | null; played_count: number; win: number; loss: number; draw: number }>;
  movesAgainst: Array<{ uci: string; san: string | null; played_count: number; win: number; loss: number; draw: number }>;
};

export function PlayBoardModes({ initialFen }: Props) {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("analysis");

  const savedLineId = searchParams.get("saved_line_id");
  const modeParam = searchParams.get("mode");

  const { activeOpponent, setActiveOpponent, availableOpponents: globalAvailableOpponents } = useActiveOpponent();
  const [opponentUsername, setOpponentUsernameLocal] = useState<string>("");
  const [availableOpponents, setAvailableOpponents] = useState<Array<{ platform: string; username: string }>>([]);
  const { imports } = useImportsRealtime();

  // Sync local opponent username with global active opponent
  useEffect(() => {
    if (activeOpponent?.username) {
      setOpponentUsernameLocal(activeOpponent.username);
    }
  }, [activeOpponent]);

  // When local opponent changes, update global context
  const setOpponentUsername = useCallback((username: string) => {
    setOpponentUsernameLocal(username);
    const opp = availableOpponents.find(o => o.username.toLowerCase() === username.toLowerCase());
    if (opp) {
      setActiveOpponent({ platform: opp.platform as "lichess" | "chesscom", username: opp.username });
    }
  }, [availableOpponents, setActiveOpponent]);
  const {
    isImporting: globalIsImporting,
    progress: globalProgress,
    currentOpponent: globalCurrentOpponent,
    progressByOpponent,
  } = useImportQueue();
  const {
    speeds: draftSpeeds,
    setSpeeds: setDraftSpeeds,
    rated: draftRated,
    setRated: setDraftRated,
    datePreset: draftDatePreset,
    setDatePreset: setDraftDatePreset,
    fromDate: draftFromDate,
    setFromDate: setDraftFromDate,
    toDate: draftToDate,
    setToDate: setDraftToDate,
    hydrated: draftFiltersHydrated,
  } = useOpponentFilters({ storageKey: "chessscout.analysisFiltersDraft", persist: true });

  const [analysisAppliedFilters, setAnalysisAppliedFilters] = useState<{
    speeds: typeof DEFAULT_SPEEDS;
    rated: "any" | "rated" | "casual";
    datePreset: "7d" | "30d" | "6m" | "18m" | "all" | "custom";
    fromDate: string;
    toDate: string;
  }>(() => {
    const now = new Date();
    const range = getDateRangeFromPreset("6m", now);
    return {
      speeds: DEFAULT_SPEEDS,
      rated: "any",
      datePreset: "6m",
      fromDate: range.from ?? "",
      toDate: range.to ?? "",
    };
  });

  const analysisAppliedFiltersKey = useMemo(() => {
    return buildFiltersKey({
      speeds: analysisAppliedFilters.speeds,
      rated: analysisAppliedFilters.rated,
      from: analysisAppliedFilters.fromDate,
      to: analysisAppliedFilters.toDate,
    });
  }, [analysisAppliedFilters]);

  const analysisDraftFiltersKey = useMemo(() => {
    return buildFiltersKey({ speeds: draftSpeeds, rated: draftRated, from: draftFromDate, to: draftToDate });
  }, [draftFromDate, draftRated, draftSpeeds, draftToDate]);

  const analysisDraftDirty = useMemo(() => {
    if (!draftFiltersHydrated) return false;
    return analysisDraftFiltersKey !== analysisAppliedFiltersKey;
  }, [analysisAppliedFiltersKey, analysisDraftFiltersKey, draftFiltersHydrated]);

  const [analysisFilterApply, setAnalysisFilterApply] = useState<{
    status: "applied" | "applying";
    key: string | null;
  }>({ status: "applied", key: null });

  const analysisHasAutoAppliedRef = useRef(false);

  const applyAnalysisFilters = useCallback(() => {
    const nextKey = buildFiltersKey({ speeds: draftSpeeds, rated: draftRated, from: draftFromDate, to: draftToDate });
    setAnalysisFilterApply({ status: "applying", key: nextKey });
    setAnalysisAppliedFilters({
      speeds: draftSpeeds,
      rated: draftRated,
      datePreset: draftDatePreset,
      fromDate: draftFromDate,
      toDate: draftToDate,
    });
    try {
      window.localStorage.setItem(
        "chessscout.analysisFiltersApplied",
        JSON.stringify({
          speeds: draftSpeeds,
          rated: draftRated,
          datePreset: draftDatePreset,
          from: draftFromDate,
          to: draftToDate,
        })
      );
    } catch {
      // ignore
    }
  }, [draftDatePreset, draftFromDate, draftRated, draftSpeeds, draftToDate]);

  useEffect(() => {
    if (!draftFiltersHydrated) return;
    if (analysisHasAutoAppliedRef.current) return;
    try {
      const raw = window.localStorage.getItem("chessscout.analysisFiltersApplied") ?? "";
      if (!raw) {
        // First visit: run once with defaults (all speeds + past 6 months)
        analysisHasAutoAppliedRef.current = true;
        applyAnalysisFilters();
        return;
      }
      const parsed = JSON.parse(raw) as any;
      const rawSpeeds = Array.isArray(parsed?.speeds) ? (parsed.speeds as any[]) : [];
      const nextSpeeds = rawSpeeds
        .map((s) => String(s))
        .filter((s) => ["bullet", "blitz", "rapid", "classical", "correspondence"].includes(s)) as any;
      const rawRated = String(parsed?.rated ?? "any");
      const storedFrom = typeof parsed?.from === "string" ? parsed.from : "";
      const storedTo = typeof parsed?.to === "string" ? parsed.to : "";
      const rawPreset = String(parsed?.datePreset ?? "");
      const preset =
        rawPreset === "7d" ||
        rawPreset === "30d" ||
        rawPreset === "6m" ||
        rawPreset === "18m" ||
        rawPreset === "all" ||
        rawPreset === "custom"
          ? rawPreset
          : "6m";

      const computed = preset === "custom" ? { from: storedFrom, to: storedTo } : getDateRangeFromPreset(preset as any, new Date());

      setAnalysisAppliedFilters({
        speeds: (nextSpeeds.length > 0 ? nextSpeeds : DEFAULT_SPEEDS) as any,
        rated: rawRated === "rated" ? "rated" : rawRated === "casual" ? "casual" : "any",
        datePreset: preset as any,
        fromDate: computed.from ?? "",
        toDate: computed.to ?? "",
      });
      analysisHasAutoAppliedRef.current = true;
    } catch {
      analysisHasAutoAppliedRef.current = true;
      applyAnalysisFilters();
    }
  }, [applyAnalysisFilters, draftFiltersHydrated]);
  const [generateStyleMarkers, setGenerateStyleMarkers] = useState(true);
  const [opponentMode, setOpponentMode] = useState<Strategy>("proportional");
  const [depthRemaining, setDepthRemaining] = useState<number | null>(null);
  const [lastOpponentMove, setLastOpponentMove] = useState<{ uci: string; san: string | null } | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [opponentCommentary, setOpponentCommentary] = useState<string | null>(null);

  const [savedLinePopup, setSavedLinePopup] = useState<{ savedLineId: string; message: string } | null>(null);
  const [ackedSavedLineId, setAckedSavedLineId] = useState<string | null>(null);

  const showSavedLinePopup = useCallback(
    (message: string) => {
      if (!savedLineId) return;
      if (ackedSavedLineId === savedLineId) return;
      setSavedLinePopup({ savedLineId, message });
    },
    [ackedSavedLineId, savedLineId]
  );

  const dismissSavedLinePopup = useCallback(() => {
    setSavedLinePopup(null);
    if (savedLineId) setAckedSavedLineId(savedLineId);
  }, [savedLineId]);

  const [simWarmStatus, setSimWarmStatus] = useState<"idle" | "warming" | "warm" | "error">("idle");
  const [simWarmMeta, setSimWarmMeta] = useState<{ status: string; buildMs: number; maxGames: number } | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [simGamesLeft, setSimGamesLeft] = useState<number | null>(null);

  const [engineTakeover, setEngineTakeover] = useState(false);
  const [engineTakeoverFlash, setEngineTakeoverFlash] = useState(false);
  const prevEngineTakeoverRef = useRef(false);

  // Scout Insights for out-of-history moves
  const [useScoutInsightsForOutOfHistory, setUseScoutInsightsForOutOfHistory] = useState(true);
  const [scoutInsightTakeover, setScoutInsightTakeover] = useState(false);
  const [scoutInsightTakeoverFlash, setScoutInsightTakeoverFlash] = useState(false);
  const prevScoutInsightTakeoverRef = useRef(false);

  // Simulation right sidebar state
  const [simRightTab, setSimRightTab] = useState<SimulationRightTab>("filters");
  const [opponentPlaysColor, setOpponentPlaysColor] = useState<"white" | "black">("black");

  // Sync opponentPlaysColor with stored playerSide on mount to avoid mismatch
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("chessscout_player_side");
      if (saved === "white" || saved === "black") {
        // If playerSide is white, opponent plays black; if playerSide is black, opponent plays white
        setOpponentPlaysColor(saved === "white" ? "black" : "white");
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const prev = prevEngineTakeoverRef.current;
    prevEngineTakeoverRef.current = engineTakeover;
    if (!prev && engineTakeover) {
      setEngineTakeoverFlash(true);
      const id = window.setTimeout(() => setEngineTakeoverFlash(false), 900);
      return () => window.clearTimeout(id);
    }
  }, [engineTakeover]);

  useEffect(() => {
    const prev = prevScoutInsightTakeoverRef.current;
    prevScoutInsightTakeoverRef.current = scoutInsightTakeover;
    if (!prev && scoutInsightTakeover) {
      setScoutInsightTakeoverFlash(true);
      const id = window.setTimeout(() => setScoutInsightTakeoverFlash(false), 900);
      return () => window.clearTimeout(id);
    }
  }, [scoutInsightTakeover]);

  useEffect(() => {
    if (modeParam === "analysis" || modeParam === "simulation") {
      setMode(modeParam);
    } else {
      setMode("analysis");
    }
  }, [modeParam]);

  // Sync available opponents from global context
  useEffect(() => {
    const out = globalAvailableOpponents.map((o) => ({
      platform: o.platform,
      username: o.username,
    }));
    setAvailableOpponents(out);
  }, [globalAvailableOpponents]);

  useEffect(() => {
    if (availableOpponents.length === 0) return;
    const current = opponentUsername.trim().toLowerCase();
    if (current && availableOpponents.some((o) => o.username.toLowerCase() === current)) return;
    setOpponentUsername(availableOpponents[0]?.username ?? "");
  }, [availableOpponents, opponentUsername]);

  const opponentImport = useMemo(() => {
    const u = opponentUsername.trim().toLowerCase();
    if (!u) return null;
    return (
      imports
        .filter((i) => i.target_type === "opponent" && i.platform === "lichess")
        .find((i) => i.username.trim().toLowerCase() === u) ?? null
    );
  }, [imports, opponentUsername]);

  const opponentImportedCount = useMemo(() => {
    const base = typeof opponentImport?.imported_count === "number" ? opponentImport.imported_count : 0;
    const u = opponentUsername.trim().toLowerCase();
    const key = u ? `lichess:${u}` : "";
    const live = globalIsImporting && key && globalCurrentOpponent === key ? Math.max(0, Number(globalProgress ?? 0)) : 0;
    const persisted = key ? Math.max(0, Number(progressByOpponent[key] ?? 0)) : 0;
    return Math.max(base, persisted, live);
  }, [globalCurrentOpponent, globalIsImporting, globalProgress, opponentImport?.imported_count, opponentUsername, progressByOpponent]);

  const analysisIsSyncingOpponent = useMemo(() => {
    const u = opponentUsername.trim().toLowerCase();
    const key = u ? `lichess:${u}` : "";
    return Boolean(globalIsImporting && key && globalCurrentOpponent === key);
  }, [globalCurrentOpponent, globalIsImporting, opponentUsername]);

  const archivingNote = useMemo(() => {
    if (!opponentImport) return null;
    if (!opponentImport.ready) return null;
    if (String(opponentImport.stage ?? "") !== "archiving") return null;
    return "Scouting 1,000 games (Archiving history...)";
  }, [opponentImport]);

  const timeControls: TimeControlPreset[] = useMemo(
    () => [
      { key: "1+0", label: "1+0", baseMinutes: 1, incrementSeconds: 0, category: "bullet" },
      { key: "2+1", label: "2+1", baseMinutes: 2, incrementSeconds: 1, category: "bullet" },
      { key: "3+0", label: "3+0", baseMinutes: 3, incrementSeconds: 0, category: "blitz" },
      { key: "3+2", label: "3+2", baseMinutes: 3, incrementSeconds: 2, category: "blitz" },
      { key: "5+0", label: "5+0", baseMinutes: 5, incrementSeconds: 0, category: "blitz" },
      { key: "5+3", label: "5+3", baseMinutes: 5, incrementSeconds: 3, category: "blitz" },
      { key: "10+0", label: "10+0", baseMinutes: 10, incrementSeconds: 0, category: "rapid" },
      { key: "10+5", label: "10+5", baseMinutes: 10, incrementSeconds: 5, category: "rapid" },
      { key: "15+10", label: "15+10", baseMinutes: 15, incrementSeconds: 10, category: "rapid" },
      { key: "30+0", label: "30+0", baseMinutes: 30, incrementSeconds: 0, category: "classical" },
      { key: "30+20", label: "30+20", baseMinutes: 30, incrementSeconds: 20, category: "classical" },
    ],
    []
  );

  const [clocksEnabled, setClocksEnabled] = useState(false);
  const [timeControlKey, setTimeControlKey] = useState<string>("3+2");
  const [clockRunning, setClockRunning] = useState(false);
  const [clockPaused, setClockPaused] = useState(false);
  const [clockExpired, setClockExpired] = useState(false);
  const [whiteMs, setWhiteMs] = useState<number>(3 * 60_000);
  const [blackMs, setBlackMs] = useState<number>(3 * 60_000);
  const [gameStarted, setGameStarted] = useState(false);
  const [firstMoveMade, setFirstMoveMade] = useState(false); // Track if white has made first move (for clock start)

  // Style analysis state
  const [scoutOverlayOpen, setScoutOverlayOpen] = useState(false);
  const {
    prediction: scoutPrediction,
    loading: scoutLoading,
    error: scoutError,
    mode: scoutMode,
    setMode: setScoutMode,
    predict: scoutPredict,
    predictOnce: scoutPredictOnce,
    clearPrediction: clearScoutPrediction,
  } = useScoutPrediction();

  const [scoutOpponentReplyByMove, setScoutOpponentReplyByMove] = useState<Record<string, OpponentReplyForecast> | null>(null);
  const [scoutOpponentReplyLoading, setScoutOpponentReplyLoading] = useState(false);
  const scoutOpponentReplyReqIdRef = useRef(0);
  const scoutBoardContextRef = useRef<{ fen: string; turn: "w" | "b"; playerSide: "white" | "black" } | null>(null);
  const analysisStyleMarkersRef = useRef<any>(undefined);

  const scoutAutoRefreshTimerRef = useRef<number | null>(null);

  
  const tickRef = useRef<{ lastTs: number | null }>({ lastTs: null });
  const simMetaRef = useRef<{ turn: "w" | "b"; isGameOver: boolean }>({ turn: "w", isGameOver: false });

  useEffect(() => {
    if (!scoutOverlayOpen) return;
    if (!scoutPrediction) return;
    const trimmedOpp = opponentUsername.trim();
    if (!trimmedOpp) return;

    const ctx = scoutBoardContextRef.current;
    if (!ctx) return;

    const turn = ctx.turn;
    const isPlayersTurn =
      (ctx.playerSide === "white" && turn === "w") || (ctx.playerSide === "black" && turn === "b");
    if (!isPlayersTurn) {
      setScoutOpponentReplyByMove(null);
      setScoutOpponentReplyLoading(false);
      return;
    }

    const reqId = (scoutOpponentReplyReqIdRef.current += 1);
    setScoutOpponentReplyLoading(true);
    setScoutOpponentReplyByMove(null);

    const TOP_N = 5;
    const candidates = scoutPrediction.candidates.slice(0, TOP_N);

    void (async () => {
      try {
        const out: Record<string, OpponentReplyForecast> = {};

        const styleMarkers = analysisStyleMarkersRef.current;

        for (const cand of candidates) {
          if (scoutOpponentReplyReqIdRef.current !== reqId) return;

          const uci = cand.move_uci;
          const from = uci.slice(0, 2);
          const to = uci.slice(2, 4);
          const promotion = uci.length > 4 ? uci.slice(4) : undefined;

          const next = new Chess(ctx.fen);
          const played = next.move({ from, to, promotion: (promotion as any) ?? undefined });
          if (!played) continue;

          const nextFen = next.fen();
          const fenParts = nextFen.split(" ");
          const fullmoveNumber = Number(fenParts[5] ?? "1");
          const nextTurn = (fenParts[1] === "b" ? "b" : "w") as "w" | "b";
          const opponentColor = ctx.playerSide === "white" ? "b" : "w";
          const isOpponentTurn = nextTurn === opponentColor;

          const replyPrediction = await scoutPredictOnce({
            fen: nextFen,
            opponentUsername: trimmedOpp,
            styleMarkers,
            isOpponentTurn,
            moveNumber: Number.isFinite(fullmoveNumber) ? fullmoveNumber : 1,
          });

          const replyMove = replyPrediction.selected_move;
          const replyCandidate = replyPrediction.candidates.find((c) => c.move === replyMove);

          out[cand.move] = {
            reply_move: replyMove,
            reply_prob: replyCandidate ? replyCandidate.final_prob : undefined,
            reply_reason: replyCandidate ? replyCandidate.reason : undefined,
          };

          if (scoutOpponentReplyReqIdRef.current === reqId) {
            setScoutOpponentReplyByMove((prev) => ({ ...(prev ?? {}), [cand.move]: out[cand.move]! }));
          }
        }
      } catch {
        // If forecasting fails, keep base overlay usable.
      } finally {
        if (scoutOpponentReplyReqIdRef.current === reqId) {
          setScoutOpponentReplyLoading(false);
        }
      }
    })();
  }, [
    opponentUsername,
    scoutOverlayOpen,
    scoutPrediction,
    scoutPredictOnce,
  ]);

  const runScoutPredictForContext = useCallback(
    async (ctx: { fen: string; turn: "w" | "b"; playerSide: "white" | "black" }) => {
      const trimmedOpp = opponentUsername.trim();
      if (!trimmedOpp) return;
      const fenParts = ctx.fen.split(" ");
      const fullmoveNumber = Number(fenParts[5] ?? "1");
      const opponentColor = ctx.playerSide === "white" ? "b" : "w";
      const isOpponentTurn = ctx.turn === opponentColor;
      const historyMoves = await fetchScoutHistoryMoves({ fen: ctx.fen, username: trimmedOpp }).catch(() => []);
      const styleMarkers = analysisStyleMarkersRef.current;

      await scoutPredict({
        fen: ctx.fen,
        opponentUsername: trimmedOpp,
        styleMarkers,
        historyMoves,
        isOpponentTurn,
        moveNumber: Number.isFinite(fullmoveNumber) ? fullmoveNumber : 1,
      });
    },
    [opponentUsername, scoutPredict]
  );

  const selectedTc = useMemo(() => {
    return timeControls.find((t) => t.key === timeControlKey) ?? timeControls[0];
  }, [timeControlKey, timeControls]);

  const incrementMs = selectedTc.incrementSeconds * 1000;

  const resetClocksToSelected = useCallback(() => {
    const startMs = selectedTc.baseMinutes * 60_000;
    setWhiteMs(startMs);
    setBlackMs(startMs);
    setClockRunning(false);
    setClockPaused(false);
    setClockExpired(false);
    setGameStarted(false);
    setFirstMoveMade(false);
    tickRef.current.lastTs = null;
  }, [selectedTc]);

  useEffect(() => {
    if (!clocksEnabled) {
      setClockRunning(false);
      setClockExpired(false);
      tickRef.current.lastTs = null;
      return;
    }
    resetClocksToSelected();
  }, [clocksEnabled, resetClocksToSelected]);

  useEffect(() => {
    if (!clocksEnabled) return;
    resetClocksToSelected();
  }, [timeControlKey, clocksEnabled, resetClocksToSelected]);

  useEffect(() => {
    if (mode !== "simulation") return;
    if (!clocksEnabled) return;
    if (!clockRunning) return;
    if (clockPaused) return;
    if (clockExpired) return;
    // Standard chess: clock doesn't start until white makes first move
    // After first move, clock ticks for whoever's turn it is
    if (!firstMoveMade) {
      tickRef.current.lastTs = null;
      return;
    }

    const id = window.setInterval(() => {
      if (simMetaRef.current.isGameOver) return;
      const now = Date.now();
      const last = tickRef.current.lastTs;
      tickRef.current.lastTs = now;
      if (last == null) return;
      const dt = Math.max(0, Math.min(2000, now - last));
      const turn = simMetaRef.current.turn;

      // Clock ticks for the player whose turn it is
      if (turn === "w") {
        setWhiteMs((prev) => {
          const next = prev - dt;
          if (next <= 0) {
            setClockExpired(true);
            setClockRunning(false);
            return 0;
          }
          return next;
        });
      } else {
        setBlackMs((prev) => {
          const next = prev - dt;
          if (next <= 0) {
            setClockExpired(true);
            setClockRunning(false);
            return 0;
          }
          return next;
        });
      }
    }, 100);

    return () => window.clearInterval(id);
  }, [mode, clocksEnabled, clockRunning, clockPaused, clockExpired, firstMoveMade]);

  const pauseClocks = useCallback(() => {
    if (!clocksEnabled) return;
    if (!clockRunning) return;
    if (clockExpired) return;
    setClockPaused(true);
  }, [clocksEnabled, clockRunning, clockExpired]);

  const resumeClocks = useCallback(() => {
    if (!clocksEnabled) return;
    if (!clockRunning) return;
    if (clockExpired) return;
    setClockPaused(false);
    tickRef.current.lastTs = Date.now();
  }, [clocksEnabled, clockRunning, clockExpired]);

  const stopClocks = useCallback(() => {
    if (!clocksEnabled) return;
    resetClocksToSelected();
  }, [clocksEnabled, resetClocksToSelected]);

  // Start game - used when opponent plays white (user clicks Play to begin)
  // Also used to resume after pause
  const startGame = useCallback(() => {
    if (gameStarted && !clockPaused) return; // Already running
    if (clockExpired) return;
    
    if (!gameStarted) {
      // Starting a new game
      setGameStarted(true);
      if (clocksEnabled) {
        setClockRunning(true);
        setClockPaused(false);
        tickRef.current.lastTs = Date.now();
      }
    } else if (clockPaused) {
      // Resuming from pause
      setClockPaused(false);
      tickRef.current.lastTs = Date.now();
    }
  }, [gameStarted, clockPaused, clockExpired, clocksEnabled]);

  // Auto-pause clocks when switching to Analysis mode
  useEffect(() => {
    if (mode === "analysis" && clocksEnabled && clockRunning && !clockPaused && gameStarted) {
      setClockPaused(true);
    }
  }, [mode, clocksEnabled, clockRunning, clockPaused, gameStarted]);

  const [analysisShowArrow, setAnalysisShowArrow] = useState(true);
  const [analysisShowEngineBest, setAnalysisShowEngineBest] = useState(false);
  const [analysisShowEval, setAnalysisShowEval] = useState(false);
  const [analysisShowEngineColumn, setAnalysisShowEngineColumn] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [analysisEngineBestUci, setAnalysisEngineBestUci] = useState<string | null>(null);
  const [analysisEngineBestSan, setAnalysisEngineBestSan] = useState<string | null>(null);
  const [analysisStats, setAnalysisStats] = useState<Stats | null>(null);
  const [analysisStatsBusy, setAnalysisStatsBusy] = useState(false);
  const [analysisRightTab, setAnalysisRightTab] = useState<AnalysisRightTab>("stats");

  const [analysisStatsReadyKey, setAnalysisStatsReadyKey] = useState<string | null>(null);

  const [lichessMoves, setLichessMoves] = useState<LichessExplorerMove[] | null>(null);
  const [lichessBusy, setLichessBusy] = useState(false);
  const [lichessError, setLichessError] = useState<string | null>(null);
  const lichessReqIdRef = useRef(0);
  const lichessDebounceRef = useRef<number | null>(null);
  const [lichessSource, setLichessSource] = useState<ExplorerSource>("lichess");
  const [lichessShowArrows, setLichessShowArrows] = useState(true);

  const [analysisEval, setAnalysisEval] = useState<EngineScore | null>(null);

  useEffect(() => {
    if (mode !== "analysis") {
      setAnalysisEval(null);
      return;
    }
    if (!analysisShowEval) {
      setAnalysisEval(null);
      return;
    }
  }, [mode, analysisShowEval]);

  const opponentSource: "history" | "scout" | "engine" = scoutInsightTakeover ? "scout" : engineTakeover ? "engine" : "history";

  const [sessionAxisMarkers, setSessionAxisMarkers] = useState<StoredStyleMarker[]>([]);
  const [sessionAxisMarkersBusy, setSessionAxisMarkersBusy] = useState(false);
  const [sessionAxisMarkersError, setSessionAxisMarkersError] = useState<string | null>(null);
  const [styleMarkerColorFilter, setStyleMarkerColorFilter] = useState<"overall" | "white" | "black">("overall");
  const [styleMarkerCategoryFilter, setStyleMarkerCategoryFilter] = useState<string | null>(null);
  const [styleMarkersHelpOpen, setStyleMarkersHelpOpen] = useState(false);

  const fetchSessionAxisMarkers = useCallback(
    async (username: string, sessionKey: string | null, cacheBust?: string) => {
      const trimmed = username.trim();
      if (!trimmed) {
        setSessionAxisMarkers([]);
        setSessionAxisMarkersError(null);
        return [] as StoredStyleMarker[];
      }

      try {
        setSessionAxisMarkersBusy(true);
        setSessionAxisMarkersError(null);
        const t = cacheBust ? `&t=${encodeURIComponent(cacheBust)}` : "";
        const sk = sessionKey ? `&session_key=${encodeURIComponent(sessionKey)}` : "";
        const res = await fetch(
          `/api/sim/session/markers?platform=lichess&username=${encodeURIComponent(trimmed)}${sk}${t}`,
          {
          cache: "no-store",
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String((json as any)?.error ?? "Failed to load session markers"));
        const rows = Array.isArray((json as any)?.markers) ? ((json as any).markers as StoredStyleMarker[]) : [];
        const cleaned = rows.filter(Boolean);
        setSessionAxisMarkers(cleaned);
        setSessionAxisMarkersReadyKey(sessionKey ?? null);
        return cleaned;
      } catch {
        setSessionAxisMarkers([]);
        setSessionAxisMarkersError("Failed to load session markers");
        return [] as StoredStyleMarker[];
      } finally {
        setSessionAxisMarkersBusy(false);
      }
    },
    []
  );

  const styleSessionKey = `${opponentUsername.trim().toLowerCase()}|${analysisAppliedFiltersKey}`;

  const [sessionAxisMarkersReadyKey, setSessionAxisMarkersReadyKey] = useState<string | null>(null);

  useEffect(() => {
    if (analysisStatsBusy) return;
    if (!analysisStats) return;
    setAnalysisStatsReadyKey(analysisAppliedFiltersKey);
  }, [analysisAppliedFiltersKey, analysisStats, analysisStatsBusy]);

  useEffect(() => {
    if (analysisDraftDirty) return;
    if (analysisFilterApply.status !== "applying") return;
    const key = analysisFilterApply.key;
    if (!key) return;
    if (analysisAppliedFiltersKey !== key) return;
    if (analysisStatsBusy) return;
    if (analysisStatsReadyKey !== key) return;
    if (generateStyleMarkers) {
      if (sessionAxisMarkersBusy) return;
      if (sessionAxisMarkersReadyKey !== styleSessionKey) return;
    }
    setAnalysisFilterApply({ status: "applied", key: null });
  }, [
    analysisAppliedFiltersKey,
    analysisDraftDirty,
    analysisFilterApply.key,
    analysisFilterApply.status,
    analysisStatsBusy,
    analysisStatsReadyKey,
    generateStyleMarkers,
    sessionAxisMarkersBusy,
    sessionAxisMarkersReadyKey,
    styleSessionKey,
  ]);

  // Convert session markers to style markers format for Scout predictions
  // Uses context-specific values based on detected opening category and opponent color
  const analysisStyleMarkers = useMemo(() => {
    if (!sessionAxisMarkers.length) return undefined;
    
    const markers: any = {
      aggression_index: 50,
      queen_trade_avoidance: 50,
      material_greed: 50,
      complexity_preference: 50,
      space_expansion: 50,
      blunder_rate: 5,
      time_pressure_weakness: 50,
    };

    // Get context matrix from any axis marker
    const sampleMarker = sessionAxisMarkers.find(m => m.metrics_json?.contextual?.context_matrix?.matrix);
    const contextMatrix = sampleMarker?.metrics_json?.contextual?.context_matrix?.matrix as Array<{
      category: string;
      color: "white" | "black";
      queen_trade: { value: number; benchmark: number; diff_ratio: number };
      aggression: { value: number; benchmark: number; diff_ratio: number };
    }> | undefined;

    // Helper to get diff_ratio from context matrix for a specific category+color+axis
    const getContextDiffRatio = (category: string, color: "white" | "black", axis: "queen_trade" | "aggression"): number | null => {
      if (!contextMatrix) return null;
      const entry = contextMatrix.find(e => e.category === category && e.color === color);
      if (!entry) return null;
      const axisData = entry[axis];
      if (!axisData || typeof axisData.diff_ratio !== "number") return null;
      return axisData.diff_ratio;
    };
    
    // Map session markers to style markers
    // For predictions, we use overall diff_ratio but context-aware values are stored for future use
    sessionAxisMarkers.forEach(m => {
      const metrics = m.metrics_json || {};
      if (m.marker_key === "axis_aggression") {
        markers.aggression_index = Math.max(0, Math.min(100, 50 + (metrics.diff_ratio || 0) * 100));
      } else if (m.marker_key === "axis_queen_trades") {
        markers.queen_trade_avoidance = Math.max(0, Math.min(100, 50 - (metrics.diff_ratio || 0) * 100));
      } else if (m.marker_key === "axis_material") {
        markers.material_greed = Math.max(0, Math.min(100, 50 + (metrics.diff_ratio || 0) * 100));
      } else if (m.marker_key === "axis_complexity") {
        markers.complexity_preference = Math.max(0, Math.min(100, 50 + (metrics.diff_ratio || 0) * 100));
      } else if (m.marker_key === "axis_space") {
        markers.space_expansion = Math.max(0, Math.min(100, 50 + (metrics.diff_ratio || 0) * 100));
      }
    });

    // Store context matrix for dynamic context-aware predictions
    markers._contextMatrix = contextMatrix;
    
    return markers;
  }, [sessionAxisMarkers]);

  useEffect(() => {
    analysisStyleMarkersRef.current = analysisStyleMarkers;
  }, [analysisStyleMarkers]);

  useEffect(() => {
    if (!generateStyleMarkers) return;
    void fetchSessionAxisMarkers(opponentUsername, styleSessionKey, String(Date.now()));
  }, [fetchSessionAxisMarkers, opponentUsername, analysisAppliedFiltersKey, styleSessionKey, generateStyleMarkers]);

  const axisQueen = sessionAxisMarkers.find((m) => m.marker_key === "axis_queen_trades") ?? null;
  const axisCastle = sessionAxisMarkers.find((m) => m.marker_key === "axis_castling_timing") ?? null;
  const axisAggro = sessionAxisMarkers.find((m) => m.marker_key === "axis_aggression") ?? null;
  const axisLength = sessionAxisMarkers.find((m) => m.marker_key === "axis_game_length") ?? null;
  const axisOppCastle = sessionAxisMarkers.find((m) => m.marker_key === "axis_opposite_castling") ?? null;

  const sessionMarkersUpdatedAt = useMemo(() => {
    const newest = sessionAxisMarkers
      .map((r) => Date.parse(String((r as any)?.created_at ?? "")))
      .filter((n) => Number.isFinite(n))
      .reduce((m, n) => Math.max(m, n), 0);
    return newest ? new Date(newest).toLocaleTimeString() : null;
  }, [sessionAxisMarkers]);

  const queenPct = spectrumPctFromDiffRatio(axisQueen?.metrics_json?.diff_ratio);
  const castlePct = spectrumPctFromDiffRatio(axisCastle?.metrics_json?.diff_ratio);
  const aggroPct = spectrumPctFromDiffRatio(axisAggro?.metrics_json?.diff_ratio);
  const lengthPct = spectrumPctFromDiffRatio(axisLength?.metrics_json?.diff_ratio);
  const oppCastlePct = spectrumPctFromDiffRatio(axisOppCastle?.metrics_json?.diff_ratio);

  const queenData = extractSpectrumData(axisQueen, { valueKey: "queen_trade_rate", benchmarkKey: "benchmark", maxRaw: 1.0, colorFilter: styleMarkerColorFilter, categoryFilter: styleMarkerCategoryFilter ?? undefined });
  const aggroData = extractSpectrumData(axisAggro, { valueKey: "aggression_m15_avg", benchmarkKey: "benchmark", maxRaw: 8.0, colorFilter: styleMarkerColorFilter, categoryFilter: styleMarkerCategoryFilter ?? undefined });
  const lengthData = extractSpectrumData(axisLength, { valueKey: "avg_game_length", benchmarkKey: "benchmark", maxRaw: 80.0, colorFilter: styleMarkerColorFilter, categoryFilter: styleMarkerCategoryFilter ?? undefined });
  const oppCastleData = extractSpectrumData(axisOppCastle, { valueKey: "opposite_castle_rate", benchmarkKey: "benchmark", maxRaw: 1.0, colorFilter: styleMarkerColorFilter, categoryFilter: styleMarkerCategoryFilter ?? undefined });
  const castleData = extractSpectrumData(axisCastle, { valueKey: "avg_castle_ply", benchmarkKey: "benchmark_ply", maxRaw: 40.0, colorFilter: styleMarkerColorFilter, categoryFilter: styleMarkerCategoryFilter ?? undefined });

  // Get available categories from any axis marker
  const styleMarkerAvailableCategories: string[] = axisAggro?.metrics_json?.contextual?.available_categories ?? [];

  const lastStyleSessionKeyRef = useRef<string | null>(null);
  const styleSessionInFlightRef = useRef(false);
  const styleSessionDebounceRef = useRef<number | null>(null);
  const lastStyleSessionErrorAtRef = useRef(0);

  useEffect(() => {
    if (!generateStyleMarkers) return;
    const trimmed = opponentUsername.trim();
    if (!trimmed) return;
    if (styleSessionInFlightRef.current) return;
    if (lastStyleSessionKeyRef.current === styleSessionKey) return;

    if (styleSessionDebounceRef.current != null) {
      window.clearTimeout(styleSessionDebounceRef.current);
    }

    styleSessionDebounceRef.current = window.setTimeout(() => {
      styleSessionDebounceRef.current = null;
      if (styleSessionInFlightRef.current) return;

      styleSessionInFlightRef.current = true;
      setSessionAxisMarkersBusy(true);
      setSessionAxisMarkersError(null);

      void (async () => {
        try {
          const startedAt = Date.now();
          const res = await fetch("/api/sim/session/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              platform: "lichess",
              username: trimmed,
              speeds: analysisAppliedFilters.speeds,
              rated: analysisAppliedFilters.rated,
              from: analysisAppliedFilters.fromDate || null,
              to: analysisAppliedFilters.toDate || null,
              enableStyleMarkers: true,
              session_key: styleSessionKey,
            }),
          });

          if (!res.ok) {
            let detail = "";
            const now = Date.now();
            if (now - lastStyleSessionErrorAtRef.current > 5000) {
              lastStyleSessionErrorAtRef.current = now;
              try {
                const text = await res.text();
                try {
                  const json = JSON.parse(text) as any;
                  detail = String(json?.error ?? json?.message ?? text);
                } catch {
                  detail = text;
                }
              } catch {
                detail = "";
              }
              console.warn("[PlayBoardModes] /api/sim/session/start failed", res.status, detail);
            }
            setSessionAxisMarkersError(detail || `Style marker regeneration failed (${res.status})`);
            // Do not advance the dedupe key on failure; allow retry.
            return;
          }

          // best-effort parse for diagnostics
          try {
            const json = (await res.json().catch(() => null)) as any;
            const n = Number(json?.games_analyzed ?? NaN);
            if (Number.isFinite(n)) {
              // If 0 games, the API clears SESSION axis markers.
              if (n === 0) setSessionAxisMarkersError("No games matched these filters.");
            }
          } catch {
            // ignore
          }

          lastStyleSessionKeyRef.current = styleSessionKey;

          // Poll briefly to avoid stale reads (writes can land slightly after the POST returns).
          let best = await fetchSessionAxisMarkers(trimmed, styleSessionKey, String(Date.now()));
          for (let i = 0; i < 4; i++) {
            const newest = best
              .map((r) => Date.parse(String((r as any)?.created_at ?? "")))
              .filter((n) => Number.isFinite(n))
              .reduce((m, n) => Math.max(m, n), 0);

            if (newest && newest >= startedAt - 500) break;
            await sleep(250);
            best = await fetchSessionAxisMarkers(trimmed, styleSessionKey, String(Date.now()));
          }
        } finally {
          styleSessionInFlightRef.current = false;
          setSessionAxisMarkersBusy(false);
        }
      })();
    }, 450);

    return () => {
      if (styleSessionDebounceRef.current != null) {
        window.clearTimeout(styleSessionDebounceRef.current);
        styleSessionDebounceRef.current = null;
      }
    };
  }, [
    fetchSessionAxisMarkers,
    analysisAppliedFilters.fromDate,
    analysisAppliedFilters.rated,
    analysisAppliedFilters.speeds,
    analysisAppliedFilters.toDate,
    generateStyleMarkers,
    opponentUsername,
    styleSessionKey,
  ]);

  function formatCompactCount(value: number | null) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(Math.round(n));
  }

  const opponentSourceIndicator = useMemo(() => {
    if (mode !== "simulation") return null;
    if (!opponentUsername.trim()) return null;

    const flash = (opponentSource === "engine" && engineTakeoverFlash) || (opponentSource === "scout" && scoutInsightTakeoverFlash);
    const baseClass = "inline-flex h-6 w-6 items-center justify-center rounded-md";
    const className = flash
      ? `${baseClass} ${opponentSource === "scout" ? "bg-purple-200 text-purple-900" : "bg-amber-200 text-amber-900"} animate-pulse`
      : `${baseClass} bg-zinc-200 text-zinc-700`;

    const title = opponentSource === "history" 
      ? "Opponent history — moves from opponent's game database" 
      : opponentSource === "scout" 
        ? "Scout Insights — AI-powered move prediction based on opponent's style" 
        : "Engine — computer-generated moves when out of history";

    return (
      <span className="inline-flex items-center gap-1">
        <span
          className={className}
          title={title}
          aria-label={title}
        >
          {opponentSource === "history" ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M12 2c-4.97 0-9 1.79-9 4v12c0 2.21 4.03 4 9 4s9-1.79 9-4V6c0-2.21-4.03-4-9-4zm0 2c3.87 0 7 .99 7 2s-3.13 2-7 2-7-.99-7-2 3.13-2 7-2zm0 16c-3.87 0-7-.99-7-2v-2.11C6.45 16.53 9.08 17 12 17s5.55-.47 7-1.11V18c0 1.01-3.13 2-7 2zm0-5c-3.87 0-7-.99-7-2v-2.11C6.45 11.53 9.08 12 12 12s5.55-.47 7-1.11V13c0 1.01-3.13 2-7 2z" />
            </svg>
          ) : opponentSource === "scout" ? (
            <Brain className="h-3.5 w-3.5" />
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 7.48a.5.5 0 0 0-.12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0 .12.64l1.92 3.32c.13.22.4.31.64.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.24.09.51 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z" />
            </svg>
          )}
        </span>

        {opponentSource === "history" && simGamesLeft != null ? (
          <span className="text-[10px] font-medium text-zinc-600" title="Games available at this position">
            {formatCompactCount(simGamesLeft)}
          </span>
        ) : null}
      </span>
    );
  }, [engineTakeoverFlash, mode, opponentSource, opponentUsername, scoutInsightTakeoverFlash, simGamesLeft]);

  const handleSetEngineBestMove = useCallback((next: { uci: string; san: string | null } | null) => {
    setAnalysisEngineBestUci(next?.uci ?? null);
    setAnalysisEngineBestSan(next?.san ?? null);
  }, []);

  async function requestOpponentMove(params: {
    fen: string;
    username: string;
    mode: Strategy;
    prefetch?: boolean;
    force_rpc?: boolean;
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
        speeds: analysisAppliedFilters.speeds,
        rated: analysisAppliedFilters.rated,
        from: analysisAppliedFilters.fromDate || null,
        to: analysisAppliedFilters.toDate || null,
        prefetch: params.prefetch ?? false,
        force_rpc: params.force_rpc ?? false,
      }),
    });

    let json: any = null;
    let text: string | null = null;
    try {
      json = await res.json();
    } catch {
      try {
        text = await res.text();
      } catch {
        text = null;
      }
    }

    if (!res.ok) {
      const message =
        (json && typeof json === "object" && json?.error ? String(json.error) : null) ??
        (text && text.trim() ? text.trim() : null) ??
        `Opponent simulation failed (${res.status})`;
      throw new Error(message);
    }

    return (json ?? {}) as any;
  }

  async function fetchScoutHistoryMoves(params: { fen: string; username: string }) {
    const json = await requestOpponentMove({ fen: params.fen, username: params.username, mode: opponentMode, force_rpc: false });
    const rows = Array.isArray(json?.moves) ? (json.moves as any[]) : [];
    const result = rows
      .map((m) => ({
        move_san: m?.san != null ? String(m.san) : "",
        frequency: Number(m?.played_count ?? 0),
      }))
      .filter((m) => m.move_san && Number.isFinite(m.frequency) && m.frequency > 0);
    
    // Debug: Log history moves being sent to Scout API
    const total = result.reduce((sum, m) => sum + m.frequency, 0);
    console.log("[ScoutHistory] FEN:", params.fen);
    console.log("[ScoutHistory] Moves:", result.map(m => `${m.move_san}:${m.frequency}`).join(", "));
    console.log("[ScoutHistory] Total N:", total);
    if (result.length > 0) {
      const topMove = result.reduce((a, b) => a.frequency > b.frequency ? a : b);
      console.log("[ScoutHistory] Top move:", topMove.move_san, "=", ((topMove.frequency / total) * 100).toFixed(1) + "%");
    }
    
    return result;
  }

  useEffect(() => {
    const trimmed = opponentUsername.trim();
    if (!trimmed) return;

    let cancelled = false;
    setSimWarmStatus("warming");
    setSimError(null);

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
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Opponent simulation failed";
        setSimError(msg);
        setSimWarmStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [opponentUsername, opponentMode, analysisAppliedFiltersKey]);

  async function playOpponentNow(state: ChessBoardCoreState, fenOverride?: string) {
    const trimmed = opponentUsername.trim();
    if (!trimmed) {
      state.setStatus("Enter an opponent username to simulate opponent moves.");
      return;
    }

    if (clocksEnabled && clockExpired) {
      state.setStatus("Time expired (training mode).");
      return;
    }

    if (clocksEnabled && clockPaused) {
      state.setStatus("Clocks paused.");
      return;
    }

    const shouldOpponentMove =
      (state.playerSide === "white" && state.game.turn() === "b") ||
      (state.playerSide === "black" && state.game.turn() === "w");
    if (!shouldOpponentMove) return;
    if (state.isGameOver) return;

    const fen = fenOverride ?? state.fen;
    
    // Check if this is the first move of the game (opponent plays white)
    const isFirstMoveOfGame = state.game.history().length === 0;

    setSimBusy(true);
    setSimError(null);
    try {
      const json = await requestOpponentMove({ fen, username: trimmed, mode: opponentMode });
      setSimGamesLeft(Number.isFinite(Number(json?.available_total_count)) ? Number(json.available_total_count) : null);
      setDepthRemaining(typeof json?.depth_remaining === "number" ? (json.depth_remaining as number) : null);

      const move = json?.move as any;
      if (!move?.uci) {
        setLastOpponentMove(null);
        setOpponentCommentary(null);
        setSimGamesLeft(0);

        // Try Scout Insights first if enabled
        if (useScoutInsightsForOutOfHistory) {
          try {
            const fenParts = fen.split(" ");
            const fullmoveNumber = Number(fenParts[5] ?? "1");
            const styleMarkers = analysisStyleMarkersRef.current;
            
            const scoutResult = await scoutPredictOnce({
              fen,
              opponentUsername: trimmed,
              isOpponentTurn: true,
              styleMarkers,
              moveNumber: Number.isFinite(fullmoveNumber) ? fullmoveNumber : 1,
            });

            if (scoutResult?.selected_move_uci) {
              const scoutUci = scoutResult.selected_move_uci;
              const reply = new Chess(fen);
              const from = scoutUci.slice(0, 2);
              const to = scoutUci.slice(2, 4);
              const promotion = scoutUci.length > 4 ? scoutUci.slice(4) : undefined;

              const played = reply.move({ from, to, promotion: (promotion as any) ?? undefined });
              if (played) {
                setScoutInsightTakeover(true);
                setEngineTakeover(false);

                if (clocksEnabled && clockRunning && !clockPaused && !clockExpired) {
                  const remaining = state.game.turn() === "w" ? whiteMs : blackMs;
                  const delayMs = computeOpponentThinkDelayMs(selectedTc.category, remaining);
                  if (delayMs > 0) await sleep(delayMs);
                  const inc = incrementMs;
                  if (inc > 0) {
                    if (state.game.turn() === "w") setWhiteMs((t) => t + inc);
                    else setBlackMs((t) => t + inc);
                  }
                }

                if (isFirstMoveOfGame) {
                  setFirstMoveMade(true);
                  if (clocksEnabled) {
                    tickRef.current.lastTs = Date.now();
                  }
                }

                setLastOpponentMove({ uci: scoutUci, san: played.san ?? null });
                setOpponentCommentary("Out of opponent history — Scout Insights is now predicting moves based on opponent's style.");
                state.setStatus(null);
                state.commitGame(reply, played.san ?? null);
                return;
              }
            }
          } catch {
            // Scout failed, fall back to engine
          }
        }

        // Fall back to engine
        setScoutInsightTakeover(false);
        setEngineTakeover(true);

        const bestUci = await getBestMoveForPlay(fen);
        if (!bestUci) {
          state.setStatus("Out of opponent history at this position, and engine could not find a move.");
          return;
        }

        const reply = new Chess(fen);
        const from = bestUci.slice(0, 2);
        const to = bestUci.slice(2, 4);
        const promotion = bestUci.length > 4 ? bestUci.slice(4) : undefined;

        const played = reply.move({ from, to, promotion: (promotion as any) ?? undefined });
        if (!played) {
          state.setStatus("Engine move was not legal in this position.");
          return;
        }

        if (clocksEnabled && clockRunning && !clockPaused && !clockExpired) {
          const remaining = state.game.turn() === "w" ? whiteMs : blackMs;
          const delayMs = computeOpponentThinkDelayMs(selectedTc.category, remaining);
          if (delayMs > 0) await sleep(delayMs);
          const inc = incrementMs;
          if (inc > 0) {
            if (state.game.turn() === "w") setWhiteMs((t) => t + inc);
            else setBlackMs((t) => t + inc);
          }
        }

        // If this was the first move, mark it and start clock for black
        if (isFirstMoveOfGame) {
          setFirstMoveMade(true);
          if (clocksEnabled) {
            tickRef.current.lastTs = Date.now();
          }
        }

        setLastOpponentMove({ uci: bestUci, san: played.san ?? null });
        setOpponentCommentary("Out of opponent history — engine is now playing for the opponent.");
        state.setStatus(null);
        state.commitGame(reply, played.san ?? null);
        return;
      }

      setScoutInsightTakeover(false);
      setEngineTakeover(false);

      const reply = new Chess(fen);
      const from = String(move.uci).slice(0, 2);
      const to = String(move.uci).slice(2, 4);
      const promotion = String(move.uci).length > 4 ? String(move.uci).slice(4) : undefined;

      const played = reply.move({ from, to, promotion: (promotion as any) ?? undefined });
      if (!played) {
        state.setStatus("Opponent move from history was not legal in this position.");
        return;
      }

      if (clocksEnabled && clockRunning && !clockPaused && !clockExpired) {
        const remaining = state.game.turn() === "w" ? whiteMs : blackMs;
        const delayMs = computeOpponentThinkDelayMs(selectedTc.category, remaining);
        if (delayMs > 0) await sleep(delayMs);
        const inc = incrementMs;
        if (inc > 0) {
          if (state.game.turn() === "w") setWhiteMs((t) => t + inc);
          else setBlackMs((t) => t + inc);
        }
      }

      // If this was the first move, mark it and start clock for black
      if (isFirstMoveOfGame) {
        setFirstMoveMade(true);
        if (clocksEnabled) {
          tickRef.current.lastTs = Date.now();
        }
      }

      setLastOpponentMove({ uci: String(move.uci), san: (move.san as string | null) ?? null });
      setOpponentCommentary(
        `${trimmed} plays ${(move.san as string | null) ?? move.uci}. Switch to Analysis Mode to explore alternatives.`
      );
      state.setStatus(null);
      state.commitGame(reply, played.san ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Opponent simulation failed";
      setSimError(msg);
      setSimGamesLeft(null);
      state.setStatus(
        msg.toLowerCase().includes("unauthorized")
          ? "You need to sign in to use opponent simulation. Go back to the home page and sign in first."
          : `Opponent simulation failed: ${msg}`
      );
    } finally {
      setSimBusy(false);
    }
  }

  function onPieceDrop(args: any, state: ChessBoardCoreState) {
    state.setStatus(null);

    const sourceSquare = args?.sourceSquare as string | undefined;
    const targetSquare = args?.targetSquare as string | null | undefined;
    if (!sourceSquare || !targetSquare) return false;

    if (mode === "analysis") {
      try {
        const next = new Chess(state.fen);
        const move = next.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
        if (!move) return false;
        state.commitGame(next, move.san ?? null);
        return true;
      } catch {
        return false;
      }
    }

    const isPlayersTurn =
      (state.playerSide === "white" && state.game.turn() === "w") ||
      (state.playerSide === "black" && state.game.turn() === "b");
    if (!isPlayersTurn) return false;

    if (clocksEnabled && clockExpired) {
      state.setStatus("Time expired (training mode).");
      return false;
    }

    // If opponent plays white and game not started, user must click Play first
    // If opponent plays black (user plays white), game starts on user's first move
    const opponentIsWhite = state.playerSide === "black";
    if (!gameStarted && opponentIsWhite) {
      state.setStatus("Press Play to start the game.");
      return false;
    }

    try {
      const next = new Chess(state.fen);
      const move = next.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      if (!move) return false;

      // If this is the first move of the game (white's first move), start the game and clocks
      const isFirstMove = state.game.history().length === 0;
      if (isFirstMove) {
        setGameStarted(true);
        setFirstMoveMade(true);
        if (clocksEnabled) {
          setClockRunning(true);
          tickRef.current.lastTs = Date.now();
        }
      }

      // Add increment for the player who just moved (only after first move)
      if (clocksEnabled && firstMoveMade && !clockExpired && incrementMs > 0) {
        if (state.game.turn() === "w") setWhiteMs((t) => t + incrementMs);
        else setBlackMs((t) => t + incrementMs);
      }

      state.commitGame(next, move.san ?? null);
      void playOpponentNow(state, next.fen());
      return true;
    } catch {
      return false;
    }
  }

  const onSimReset = useCallback(
    (state: ChessBoardCoreState) => {
      state.reset();
      if (clocksEnabled) resetClocksToSelected();
    },
    [clocksEnabled, resetClocksToSelected]
  );

  const onSimUndoPlies = useCallback(
    (state: ChessBoardCoreState, plies: number) => {
      state.undoPlies(plies);
      if (clocksEnabled) resetClocksToSelected();
    },
    [clocksEnabled, resetClocksToSelected]
  );

  const onSimRedoPlies = useCallback(
    (state: ChessBoardCoreState, plies: number) => {
      state.redoPlies(plies);
      if (clocksEnabled) resetClocksToSelected();
    },
    [clocksEnabled, resetClocksToSelected]
  );

  const analysisFiltersPanel = (
    <div className="grid gap-3">
      <OpponentFiltersPanel
        headerLeft="Filters"
        speeds={draftSpeeds}
        setSpeeds={setDraftSpeeds}
        rated={draftRated}
        setRated={setDraftRated}
        datePreset={draftDatePreset as any}
        setDatePreset={setDraftDatePreset as any}
        fromDate={draftFromDate}
        setFromDate={setDraftFromDate}
        toDate={draftToDate}
        setToDate={setDraftToDate}
        generateStyleMarkers={generateStyleMarkers}
        setGenerateStyleMarkers={setGenerateStyleMarkers}
        footerNote={archivingNote ? <span>{archivingNote}</span> : null}
        actions={
          <div className="flex items-center justify-between gap-3">
            {analysisDraftDirty ? (
              <div className="flex items-center gap-2 text-[10px] text-amber-600">
                <span className="inline-flex h-2 w-2 rounded-full bg-amber-500"></span>
                <span className="font-medium">Changes pending</span>
              </div>
            ) : analysisFilterApply.status === "applying" ? (
              <div className="flex items-center gap-2 text-[10px] text-sky-600">
                <span className="inline-flex h-2 w-2 rounded-full bg-sky-500"></span>
                <span className="font-medium">Filters being applied…</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[10px] text-emerald-600">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                <span className="font-medium">Filters applied</span>
              </div>
            )}
            <button
              type="button"
              onClick={applyAnalysisFilters}
              disabled={!analysisDraftDirty || analysisFilterApply.status === "applying"}
              className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-4 text-[11px] font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
            >
              {analysisFilterApply.status === "applying" ? "Applying…" : "Apply Filters"}
            </button>
          </div>
        }
      />

      {generateStyleMarkers && (
        <div className="relative min-w-0 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-medium text-zinc-900">Style Markers</div>
            <button
              type="button"
              onClick={() => setStyleMarkersHelpOpen(true)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-zinc-200 bg-white text-[10px] font-semibold text-zinc-600 hover:bg-zinc-50"
            >
              ?
            </button>
          </div>

          {/* Opening Category + Color Filters */}
          {styleMarkerAvailableCategories.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-zinc-500 mr-1">Opening:</span>
                <button
                  type="button"
                  onClick={() => setStyleMarkerCategoryFilter(null)}
                  className={`inline-flex h-5 items-center justify-center rounded px-1.5 text-[9px] font-medium transition-colors ${
                    styleMarkerCategoryFilter === null
                      ? "bg-blue-500 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  All
                </button>
                {styleMarkerAvailableCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setStyleMarkerCategoryFilter(cat)}
                    className={`inline-flex h-5 items-center justify-center rounded px-1.5 text-[9px] font-medium transition-colors ${
                      styleMarkerCategoryFilter === cat
                        ? "bg-blue-500 text-white"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-zinc-500 mr-1">Color:</span>
                {(["overall", "white", "black"] as const).map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setStyleMarkerColorFilter(color)}
                    className={`inline-flex h-5 items-center justify-center rounded px-1.5 text-[9px] font-medium transition-colors ${
                      styleMarkerColorFilter === color
                        ? "bg-yellow-500 text-white"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    }`}
                  >
                    {color === "overall" ? "Overall" : color === "white" ? "♔ White" : "♚ Black"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Current Context Label */}
          {(styleMarkerCategoryFilter || styleMarkerColorFilter !== "overall") && (
            <div className="mt-1.5 text-[9px] text-zinc-500">
              Showing: <span className="font-medium text-zinc-700">
                {styleMarkerCategoryFilter ?? "All openings"} × {styleMarkerColorFilter === "overall" ? "Both colors" : styleMarkerColorFilter === "white" ? "White" : "Black"}
              </span>
              {queenData?.sampleSize != null && (
                <span className="ml-1">({queenData.sampleSize} games)</span>
              )}
            </div>
          )}

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-500">
            <div className="truncate" title={styleSessionKey}>
              key: {analysisAppliedFiltersKey}
            </div>
            <div className="shrink-0">{sessionMarkersUpdatedAt ? `updated ${sessionMarkersUpdatedAt}` : ""}</div>
          </div>

          {sessionAxisMarkersError ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-900">
              {sessionAxisMarkersError}
            </div>
          ) : null}

          <div className={`mt-2 grid gap-3 ${sessionAxisMarkersBusy ? "opacity-70" : ""}`}>
            <StyleSpectrumBar
              title="Queen Trades"
              leftLabel="Keeps Queens"
              rightLabel="Trades Early"
              data={queenData}
              positionPct={queenPct}
              unit="%"
            />
            <StyleSpectrumBar
              title="Aggression"
              leftLabel="Positional"
              rightLabel="Aggressive"
              data={aggroData}
              positionPct={aggroPct}
              unit=" attacks"
            />
            <StyleSpectrumBar
              title="Game Length"
              leftLabel="Short Games"
              rightLabel="Long Games"
              data={lengthData}
              positionPct={lengthPct}
              unit=" moves"
            />
            <StyleSpectrumBar
              title="Opposite Castling"
              leftLabel="Same Side"
              rightLabel="Opposite Side"
              data={oppCastleData}
              positionPct={oppCastlePct}
              unit="%"
            />
            <StyleSpectrumBar
              title="Castling Timing"
              leftLabel="Early"
              rightLabel="Late"
              data={castleData}
              positionPct={castlePct}
              unit=" ply"
            />
          </div>

          {sessionAxisMarkersBusy ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-xl bg-white/80 px-4 py-2 text-sm font-bold text-zinc-800 animate-pulse" style={{ animationDuration: "1s" }}>
                Regenerating…
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Style Markers Help Modal */}
      {styleMarkersHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setStyleMarkersHelpOpen(false)}>
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-zinc-900">ChessScout Style Markers</h3>
              <button
                type="button"
                onClick={() => setStyleMarkersHelpOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
              >
                ✕
              </button>
            </div>
            
            <div className="prose prose-sm prose-zinc max-w-none text-[13px] leading-relaxed">
              <h4 className="text-sm font-semibold text-zinc-800 mt-0">What are Style Markers?</h4>
              <p className="text-zinc-600">
                Style Markers are behavioral fingerprints computed from your opponent's historical games. 
                They quantify <strong>how</strong> someone plays chess—not just their rating or results, 
                but their tendencies, preferences, and patterns.
              </p>

              <h4 className="text-sm font-semibold text-zinc-800 mt-4">How are they calculated?</h4>
              <p className="text-zinc-600">
                Each marker is computed by analyzing the opponent's games that match your current filters 
                (time control, rated/casual, date range):
              </p>
              <ul className="text-zinc-600 text-[12px] space-y-1 mt-2">
                <li><strong>Queen Trades:</strong> Percentage of games where both queens are off the board by move 20</li>
                <li><strong>Aggression:</strong> Average number of captures + checks in the first 15 moves</li>
                <li><strong>Game Length:</strong> Average game length in full moves (excludes very short games)</li>
                <li><strong>Opposite Castling:</strong> Percentage of games with opposite-side castling</li>
                <li><strong>Castling Timing:</strong> Average ply when opponent castles</li>
              </ul>

              <h4 className="text-sm font-semibold text-zinc-800 mt-4">Opening Category & Color Filters</h4>
              <p className="text-zinc-600">
                Style can vary dramatically based on opening type and color. Use the filters to see how your 
                opponent plays differently in:
              </p>
              <ul className="text-zinc-600 text-[12px] space-y-1 mt-2">
                <li><strong>Open:</strong> 1.e4 e5 — tactical, open lines</li>
                <li><strong>Semi-Open:</strong> 1.e4 (c5, e6, c6, d6, etc.) — asymmetric tension</li>
                <li><strong>Closed:</strong> 1.d4 d5 — positional, slow builds</li>
                <li><strong>Indian:</strong> 1.d4 Nf6 — hypermodern systems</li>
                <li><strong>Flank:</strong> 1.c4, 1.Nf3, 1.g3, etc. — flexible setups</li>
              </ul>

              <h4 className="text-sm font-semibold text-zinc-800 mt-4">How Scout Uses Style Markers</h4>
              <p className="text-zinc-600">
                The Scout prediction engine (🧠) combines three factors to predict opponent moves:
              </p>
              <ul className="text-zinc-600 text-[12px] space-y-1 mt-2">
                <li><strong>History (α):</strong> What moves has the opponent actually played in this position?</li>
                <li><strong>Engine (β):</strong> What are the objectively best moves according to Stockfish?</li>
                <li><strong>Style (γ):</strong> Which moves fit the opponent's behavioral profile?</li>
              </ul>
              <p className="text-zinc-600 mt-2">
                Weights shift by game phase: in the <strong>opening</strong>, history dominates (70%); 
                in the <strong>middlegame</strong>, style becomes crucial (50%); in the <strong>endgame</strong>, 
                engine accuracy takes over (80%).
              </p>

              <p className="text-zinc-600 mt-2">
                When it's <strong>not</strong> the opponent's turn, Scout switches into a planning mode:
                style is disabled (γ=0). Opening: α=0.8, β=0.2. Middlegame/Endgame: α=0.3, β=0.7.
              </p>

              <h4 className="text-sm font-semibold text-zinc-800 mt-4">Reading the Spectrum Bars</h4>
              <ul className="text-zinc-600 text-[12px] space-y-1 mt-2">
                <li><strong>Yellow dot:</strong> Opponent's actual value on an absolute 0–100% scale</li>
                <li><strong>Vertical tick:</strong> Global benchmark for comparison</li>
                <li><strong>Hover:</strong> Shows exact values and sample size</li>
              </ul>

              <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                <p className="text-[11px] text-blue-800 font-medium mb-1">💡 Pro Tip</p>
                <p className="text-[11px] text-blue-700">
                  If you're preparing against a specific opening (e.g., the Sicilian as White), 
                  filter to "Semi-Open × Black" to see exactly how aggressive they play in that context. 
                  Their style in the King's Indian might be completely different!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Filters are now in the right sidebar for both modes, so no underBoard content needed
  const underBoard = null;

  const underBoardWithToast = (
    <div className="grid gap-3">
      {savedLinePopup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg">
            <div className="text-sm font-medium text-zinc-900">Saved line loaded</div>
            <div className="mt-2 text-xs leading-5 text-zinc-700">{savedLinePopup.message}</div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={dismissSavedLinePopup}
                className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-4 text-xs font-medium text-white hover:bg-zinc-800"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {underBoard}
    </div>
  );

  return (
    <ChessBoardCore
      initialFen={initialFen}
      onFenChange={() => {
        const trimmedOpp = opponentUsername.trim();
        if (!trimmedOpp) return;

        const shouldAutoRefresh =
          scoutOverlayOpen || (mode === "analysis" ? analysisRightTab === "scout" : simRightTab === "scout");
        if (!shouldAutoRefresh) return;

        const ctx = scoutBoardContextRef.current;
        if (!ctx) return;

        if (scoutAutoRefreshTimerRef.current != null) {
          window.clearTimeout(scoutAutoRefreshTimerRef.current);
        }
        scoutAutoRefreshTimerRef.current = window.setTimeout(() => {
          const latest = scoutBoardContextRef.current;
          if (!latest) return;
          void runScoutPredictForContext(latest);
        }, 200);
      }}
      soundEnabled={soundEnabled}
      leftPanel={(state) => <MovesSoFarPanel state={state} opponentUsername={opponentUsername} />}
      aboveBoard={(state) => {
        if (mode === "analysis") {
          if (!analysisShowEval) return null;
          const text = formatEvalForDisplay(analysisEval);

          return (
            <div className="flex justify-end">
              <div className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-[12px] font-semibold text-zinc-900">
                <span className="font-mono tabular-nums">{text}</span>
              </div>
            </div>
          );
        }

        if (mode !== "simulation") return null;

        if (!clocksEnabled) {
          if (!opponentSourceIndicator) return null;
          return <div className="flex justify-start">{opponentSourceIndicator}</div>;
        }

        const playerColor = state.playerSide === "white" ? "w" : "b";
        const opponentColor = playerColor === "w" ? "b" : "w";
        const isActive = state.game.turn() === opponentColor && clockRunning && !clockPaused && !clockExpired;

        const oppMs = state.playerSide === "white" ? blackMs : whiteMs;
        const isLow = oppMs <= 10_000;

        return (
          <div
            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 font-mono text-2xl tabular-nums ${
              isActive
                ? isLow
                  ? "border-rose-300 bg-rose-600 text-white"
                  : "border-zinc-200 bg-zinc-900 text-white"
                : isLow
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-zinc-200 bg-zinc-100 text-zinc-700"
            }`}
          >
            <div className="flex items-center">
              {opponentSourceIndicator ? <span className="mr-2">{opponentSourceIndicator}</span> : null}
            </div>
            <div className="flex items-center justify-end">{formatClock(oppMs)}</div>
          </div>
        );
      }}
      belowBoard={(state) => {
        if (mode !== "simulation") return null;
        if (!clocksEnabled) return null;

        const playerColor = state.playerSide === "white" ? "w" : "b";
        const isActive = state.game.turn() === playerColor && clockRunning && !clockPaused && !clockExpired;

        const pMs = state.playerSide === "white" ? whiteMs : blackMs;
        const isLow = pMs <= 10_000;

        return (
          <div
            className={`flex items-center justify-end rounded-xl border px-3 py-2 font-mono text-2xl tabular-nums ${
              isActive
                ? isLow
                  ? "border-rose-300 bg-rose-600 text-white"
                  : "border-zinc-200 bg-zinc-900 text-white"
                : isLow
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-zinc-200 bg-zinc-100 text-zinc-700"
            }`}
          >
            {formatClock(pMs)}
          </div>
        );
      }}
      specialArrow={(state) => {
        if (mode !== "analysis") return null;
        if (!analysisShowArrow) return null;

        const engineUci = analysisShowEngineBest && analysisEngineBestUci ? String(analysisEngineBestUci) : null;
        if (!engineUci || engineUci.length < 4) return null;

        const trimmed = opponentUsername.trim();
        if (!trimmed) return null;
        if (!analysisStats) return null;

        const userColor = state.playerSide === "white" ? "w" : "b";
        const opponentColor = userColor === "w" ? "b" : "w";
        const isOppToMove = state.game.turn() === opponentColor;

        const total = isOppToMove ? analysisStats.totalCountOpponent : analysisStats.totalCountAgainst;
        if (!Number.isFinite(total) || total <= 0) return null;

        const moves = isOppToMove ? analysisStats.movesOpponent : analysisStats.movesAgainst;
        const top = (moves ?? []).slice(0, 8);
        if (top.length === 0) return null;

        const mostCommon = String(top[0]?.uci ?? "");
        if (!mostCommon || mostCommon !== engineUci) return null;

        const played = Number(top[0]?.played_count ?? 0);
        const freq = played > 0 ? played / total : 0;
        const intensity = Math.max(0, Math.min(1, freq));

        return { startSquare: engineUci.slice(0, 2), endSquare: engineUci.slice(2, 4), intensity };
      }}
      arrows={(state) => {
        if (mode !== "analysis") return [];
        const arrowsOut: any[] = [];

        const engineUci = analysisShowEngineBest && analysisEngineBestUci ? String(analysisEngineBestUci) : null;

        if (!analysisShowArrow) {
          if (engineUci && engineUci.length >= 4) {
            arrowsOut.push({
              startSquare: engineUci.slice(0, 2),
              endSquare: engineUci.slice(2, 4),
              color: "rgba(34, 197, 94, 0.9)",
            });
          }
          return arrowsOut;
        }
        const trimmed = opponentUsername.trim();
        if (!trimmed) return [];
        if (!analysisStats) return [];

        const TOP_N = 8;
        const MIN_OPACITY = 0.15;

        const userColor = state.playerSide === "white" ? "w" : "b";
        const opponentColor = userColor === "w" ? "b" : "w";
        const isOppToMove = state.game.turn() === opponentColor;

        const total = isOppToMove ? analysisStats.totalCountOpponent : analysisStats.totalCountAgainst;
        if (!Number.isFinite(total) || total <= 0) return [];

        const moves = isOppToMove ? analysisStats.movesOpponent : analysisStats.movesAgainst;
        const top = (moves ?? []).slice(0, TOP_N);
        if (top.length === 0) return [];

        const maxFreq = Math.max(
          ...top.map((m) => (Number(m.played_count ?? 0) > 0 ? Number(m.played_count ?? 0) / total : 0))
        );
        if (!Number.isFinite(maxFreq) || maxFreq <= 0) return [];

        const mostCommonUci = String(top[0]?.uci ?? "");

        // Combined case: engine best == most common opponent move.
        // Render exactly one arrow: opponent blue with opacity driven by opponent frequency.
        if (engineUci && engineUci.length >= 4) {
          if (engineUci === mostCommonUci) {
            // Combined case: keep normal/high opacity like other arrows.
            // Use the same normalization approach as the other candidate arrows (freq / maxFreq).
            const played = Number(top[0]?.played_count ?? 0);
            const freq = played > 0 ? played / total : 0;
            const opacity = Math.max(MIN_OPACITY, freq / maxFreq);
            arrowsOut.push({
              startSquare: engineUci.slice(0, 2),
              endSquare: engineUci.slice(2, 4),
              color: `rgba(37, 99, 235, ${opacity.toFixed(3)})`,
            });
          } else {
            arrowsOut.push({
              startSquare: engineUci.slice(0, 2),
              endSquare: engineUci.slice(2, 4),
              color: "rgba(34, 197, 94, 0.9)",
            });
          }
        }

        arrowsOut.push(
          ...top
            .map((m) => {
              const uci = String(m.uci ?? "");
              if (uci.length < 4) return null;
              if (engineUci && uci === engineUci) return null;
              const freq = Number(m.played_count ?? 0) / total;
              const opacity = Math.max(MIN_OPACITY, freq / maxFreq);

              return {
                startSquare: uci.slice(0, 2),
                endSquare: uci.slice(2, 4),
                color: `rgba(37, 99, 235, ${opacity.toFixed(3)})`,
              };
            })
            .filter(Boolean)
        );

        // Add Lichess Book arrows if enabled and on the lichess tab
        if (analysisRightTab === "lichess" && lichessShowArrows && lichessMoves && lichessMoves.length > 0) {
          const top3 = lichessMoves.slice(0, 3);
          const maxTotal = Math.max(...top3.map((m) => m.total));
          
          for (const m of top3) {
            const uci = m.uci;
            if (!uci || uci.length < 4) continue;
            // Scale opacity based on frequency (most popular = 0.9, less = more transparent)
            const opacity = maxTotal > 0 ? Math.max(0.3, (m.total / maxTotal) * 0.9) : 0.6;
            arrowsOut.push({
              startSquare: uci.slice(0, 2),
              endSquare: uci.slice(2, 4),
              color: `rgba(6, 182, 212, ${opacity.toFixed(2)})`, // Teal/Cyan color (#06b6d4)
            });
          }
        }

        const seen = new Set<string>();
        const deduped: any[] = [];
        for (const a of arrowsOut) {
          const start = String(a?.startSquare ?? "");
          const end = String(a?.endSquare ?? "");
          if (!start || !end) continue;
          const key = `${start}-${end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(a);
        }
        return deduped;
      }}
      underBoard={underBoardWithToast}
      onPieceDrop={onPieceDrop}
    >
      {(state) => {
        // Keep clock tick meta in sync with the authoritative board state.
        simMetaRef.current.turn = state.game.turn();
        simMetaRef.current.isGameOver = state.isGameOver;
        scoutBoardContextRef.current = { fen: state.fen, turn: state.game.turn(), playerSide: state.playerSide };

        const shouldHydrateSavedLine = Boolean(savedLineId && mode === "analysis");

        if (mode === "analysis") {
          return (
            <AnalysisRightSidebar
              state={state}
              savedLineId={savedLineId}
              shouldHydrateSavedLine={shouldHydrateSavedLine}
              showSavedLinePopup={showSavedLinePopup}
              analysisFiltersPanel={analysisFiltersPanel}
              opponentPlaysColor={opponentPlaysColor}
              setOpponentPlaysColor={(c) => {
                setOpponentPlaysColor(c);
                state.setPlayerSide(c === "white" ? "black" : "white");
              }}
              analysisRightTab={analysisRightTab}
              setAnalysisRightTab={setAnalysisRightTab}
              analysisFilterApplyStatus={analysisFilterApply.status}
              analysisShowArrow={analysisShowArrow}
              setAnalysisShowArrow={setAnalysisShowArrow}
              analysisShowEval={analysisShowEval}
              setAnalysisShowEval={setAnalysisShowEval}
              analysisShowEngineBest={analysisShowEngineBest}
              setAnalysisShowEngineBest={setAnalysisShowEngineBest}
              analysisShowEngineColumn={analysisShowEngineColumn}
              setAnalysisShowEngineColumn={setAnalysisShowEngineColumn}
              soundEnabled={soundEnabled}
              setSoundEnabled={setSoundEnabled}
              setAnalysisEval={setAnalysisEval}
              opponentUsername={opponentUsername}
              opponentImportedCount={opponentImportedCount}
              analysisIsSyncingOpponent={analysisIsSyncingOpponent}
              filtersKey={analysisAppliedFiltersKey}
              requestOpponentMove={requestOpponentMove}
              analysisEngineBestUci={analysisEngineBestUci}
              analysisEngineBestSan={analysisEngineBestSan}
              handleSetEngineBestMove={handleSetEngineBestMove}
              analysisStatsBusy={analysisStatsBusy}
              analysisStats={analysisStats}
              setAnalysisStats={setAnalysisStats}
              setAnalysisStatsBusy={setAnalysisStatsBusy}
              lichessMoves={lichessMoves}
              setLichessMoves={setLichessMoves}
              lichessBusy={lichessBusy}
              setLichessBusy={setLichessBusy}
              lichessError={lichessError}
              setLichessError={setLichessError}
              lichessReqIdRef={lichessReqIdRef}
              lichessDebounceRef={lichessDebounceRef}
              lichessSource={lichessSource}
              setLichessSource={setLichessSource}
              lichessShowArrows={lichessShowArrows}
              setLichessShowArrows={setLichessShowArrows}
              analysisStyleMarkers={analysisStyleMarkers}
              scoutEnabled={Boolean(opponentUsername.trim())}
              scoutPrediction={scoutPrediction}
              scoutLoading={scoutLoading}
              scoutError={scoutError}
              scoutMode={scoutMode}
              onScoutModeChange={setScoutMode}
              onScoutPredict={() => {
                const ctx = scoutBoardContextRef.current;
                if (!ctx) return;
                void runScoutPredictForContext(ctx);
              }}
              scoutOpponentReplyByMove={scoutOpponentReplyByMove}
              scoutOpponentReplyLoading={scoutOpponentReplyLoading}
              filterFrom={analysisAppliedFilters.fromDate || null}
              filterTo={analysisAppliedFilters.toDate || null}
              filterSpeeds={analysisAppliedFilters.speeds}
              filterRated={analysisAppliedFilters.rated}
            />
          );
        }

        return (
          <SimulationAutoTrigger
            state={state}
            opponentUsername={opponentUsername}
            opponentMode={opponentMode}
            filtersKey={analysisAppliedFiltersKey}
            simBusy={simBusy}
            clocksEnabled={clocksEnabled}
            clockPaused={clockPaused}
            clockExpired={clockExpired}
            gameStarted={gameStarted}
            onOpponentMoveNow={() => {
              void playOpponentNow(state);
            }}
          >
            <SimulationRightSidebar
              state={state}
              activeTab={simRightTab}
              setActiveTab={setSimRightTab}
              filtersPanel={analysisFiltersPanel}
              opponentPlaysColor={opponentPlaysColor}
              setOpponentPlaysColor={(c) => {
                setOpponentPlaysColor(c);
                state.setPlayerSide(c === "white" ? "black" : "white");
              }}
              mode={opponentMode}
              setMode={setOpponentMode}
              clocksEnabled={clocksEnabled}
              setClocksEnabled={setClocksEnabled}
              timeControls={timeControls}
              timeControlKey={timeControlKey}
              setTimeControlKey={setTimeControlKey}
              clockRunning={clockRunning}
              clockPaused={clockPaused}
              clockExpired={clockExpired}
              gameStarted={gameStarted}
              onStartGame={startGame}
              onClockPause={pauseClocks}
              onClockResume={resumeClocks}
              onClockStop={stopClocks}
              engineTakeover={engineTakeover}
              scoutInsightTakeover={scoutInsightTakeover}
              simWarmStatus={simWarmStatus}
              simWarmMeta={simWarmMeta}
              depthRemaining={depthRemaining}
              lastOpponentMove={lastOpponentMove}
              opponentCommentary={opponentCommentary}
              simBusy={simBusy}
              useScoutInsightsForOutOfHistory={useScoutInsightsForOutOfHistory}
              setUseScoutInsightsForOutOfHistory={setUseScoutInsightsForOutOfHistory}
              scoutEnabled={Boolean(opponentUsername.trim())}
              opponentUsername={opponentUsername}
              scoutPrediction={scoutPrediction}
              scoutLoading={scoutLoading}
              scoutError={scoutError}
              scoutMode={scoutMode}
              onScoutModeChange={setScoutMode}
              onScoutPredict={() => {
                const ctx = scoutBoardContextRef.current;
                if (!ctx) return;
                void runScoutPredictForContext(ctx);
              }}
              scoutOpponentReplyByMove={scoutOpponentReplyByMove}
              scoutOpponentReplyLoading={scoutOpponentReplyLoading}
            />
          </SimulationAutoTrigger>
        );
      }}
    </ChessBoardCore>
  );
}

function AnalysisRightSidebar(props: {
  state: ChessBoardCoreState;
  savedLineId: string | null;
  shouldHydrateSavedLine: boolean;
  showSavedLinePopup: (msg: string) => void;
  analysisFiltersPanel: React.ReactNode;
  opponentPlaysColor: "white" | "black";
  setOpponentPlaysColor: (c: "white" | "black") => void;
  analysisRightTab: AnalysisRightTab;
  setAnalysisRightTab: (t: AnalysisRightTab) => void;
  analysisFilterApplyStatus: "applied" | "applying";
  analysisShowArrow: boolean;
  setAnalysisShowArrow: (v: boolean) => void;
  analysisShowEval: boolean;
  setAnalysisShowEval: (v: boolean) => void;
  analysisShowEngineBest: boolean;
  setAnalysisShowEngineBest: (v: boolean) => void;
  analysisShowEngineColumn: boolean;
  setAnalysisShowEngineColumn: (v: boolean) => void;
  soundEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;
  setAnalysisEval: (s: EngineScore | null) => void;
  opponentUsername: string;
  opponentImportedCount: number;
  analysisIsSyncingOpponent: boolean;
  filtersKey: string;
  requestOpponentMove: (params: { fen: string; username: string; mode: Strategy; prefetch?: boolean }) => Promise<any>;
  analysisEngineBestUci: string | null;
  analysisEngineBestSan: string | null;
  handleSetEngineBestMove: (m: { uci: string; san: string | null } | null) => void;
  analysisStatsBusy: boolean;
  analysisStats: Stats | null;
  setAnalysisStats: (s: Stats | null) => void;
  setAnalysisStatsBusy: (v: boolean) => void;
  lichessMoves: LichessExplorerMove[] | null;
  setLichessMoves: (m: LichessExplorerMove[] | null) => void;
  lichessBusy: boolean;
  setLichessBusy: (v: boolean) => void;
  lichessError: string | null;
  setLichessError: (v: string | null) => void;
  lichessReqIdRef: React.MutableRefObject<number>;
  lichessDebounceRef: React.MutableRefObject<number | null>;
  lichessSource: ExplorerSource;
  setLichessSource: (s: ExplorerSource) => void;
  lichessShowArrows: boolean;
  setLichessShowArrows: (v: boolean) => void;
  analysisStyleMarkers?: any;
  scoutEnabled?: boolean;
  scoutPrediction?: any;
  scoutLoading?: boolean;
  scoutError?: string | null;
  scoutMode?: "pure_history" | "hybrid";
  onScoutModeChange?: (mode: "pure_history" | "hybrid") => void;
  onScoutPredict?: () => void;
  scoutOpponentReplyByMove?: Record<string, any> | null;
  scoutOpponentReplyLoading?: boolean;
  // Date filter refinement props (Phase 1b)
  filterFrom?: string | null;
  filterTo?: string | null;
  filterSpeeds?: string[] | null;
  filterRated?: 'any' | 'rated' | 'casual';
}) {
  const {
    state,
    savedLineId,
    shouldHydrateSavedLine,
    showSavedLinePopup,
    analysisFiltersPanel,
    opponentPlaysColor,
    setOpponentPlaysColor,
    analysisRightTab,
    setAnalysisRightTab,
    analysisFilterApplyStatus,
    analysisShowArrow,
    setAnalysisShowArrow,
    analysisShowEval,
    setAnalysisShowEval,
    analysisShowEngineBest,
    setAnalysisShowEngineBest,
    analysisShowEngineColumn,
    setAnalysisShowEngineColumn,
    soundEnabled,
    setSoundEnabled,
    setAnalysisEval,
    opponentUsername,
    opponentImportedCount,
    analysisIsSyncingOpponent,
    filtersKey,
    requestOpponentMove,
    analysisEngineBestUci,
    analysisEngineBestSan,
    handleSetEngineBestMove,
    analysisStatsBusy,
    analysisStats,
    setAnalysisStats,
    setAnalysisStatsBusy,
    lichessMoves,
    setLichessMoves,
    lichessBusy,
    setLichessBusy,
    lichessError,
    setLichessError,
    lichessReqIdRef,
    lichessDebounceRef,
    lichessSource,
    setLichessSource,
    lichessShowArrows,
    setLichessShowArrows,
    analysisStyleMarkers,
    scoutEnabled = false,
    scoutPrediction,
    scoutLoading,
    scoutError,
    scoutMode,
    onScoutModeChange,
    onScoutPredict,
    scoutOpponentReplyByMove,
    scoutOpponentReplyLoading,
    filterFrom,
    filterTo,
    filterSpeeds,
    filterRated,
  } = props;

  const active = analysisRightTab;
  const [showCandidatesHelp, setShowCandidatesHelp] = useState(false);

  useEffect(() => {
    if (active !== "lichess") return;

    if (lichessDebounceRef.current != null) {
      window.clearTimeout(lichessDebounceRef.current);
    }

    const reqId = (lichessReqIdRef.current += 1);

    lichessDebounceRef.current = window.setTimeout(() => {
      lichessDebounceRef.current = null;
      setLichessBusy(true);
      setLichessError(null);

      void (async () => {
        try {
          const moves = await fetchLichessStats(state.fen, "standard", lichessSource);
          if (lichessReqIdRef.current !== reqId) return;
          setLichessMoves(moves);
          setLichessBusy(false);
        } catch (e) {
          if (lichessReqIdRef.current !== reqId) return;
          const msg = e instanceof Error ? e.message : "Failed to load Lichess explorer";
          setLichessError(msg);
          setLichessBusy(false);
        }
      })();
    }, 300);

    return () => {
      if (lichessDebounceRef.current != null) {
        window.clearTimeout(lichessDebounceRef.current);
        lichessDebounceRef.current = null;
      }
    };
  }, [active, state.fen, lichessSource, lichessDebounceRef, lichessReqIdRef, setLichessBusy, setLichessError, setLichessMoves]);

  return (
    <>
      {savedLineId ? (
        <SavedLineHydrator
          state={state}
          savedLineId={savedLineId}
          enabled={shouldHydrateSavedLine}
          onLoaded={(name) => showSavedLinePopup(`Loaded from Saved Line: ${name}`)}
          onError={(msg) => showSavedLinePopup(msg)}
        />
      ) : null}
      <div className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex min-w-0 items-center justify-between border-b border-zinc-200 px-2 py-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-50 ${
                active === "filters" ? "bg-zinc-100 text-zinc-900" : "text-zinc-600"
              }`}
              title="Filters"
              onClick={() => setAnalysisRightTab("filters")}
            >
              <Filter className="h-5 w-5" />
            </button>
            <button
              type="button"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-50 ${
                active === "preferences" ? "bg-zinc-100 text-zinc-900" : "text-zinc-600"
              }`}
              title="Preferences"
              onClick={() => setAnalysisRightTab("preferences")}
            >
              <SlidersHorizontal className="h-5 w-5" />
            </button>
            <button
              type="button"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-50 ${
                active === "stats" ? "bg-zinc-100 text-zinc-900" : "text-zinc-600"
              }`}
              title="Candidates"
              onClick={() => setAnalysisRightTab("stats")}
            >
              <GitBranch className="h-5 w-5" />
            </button>
            <button
              type="button"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-50 ${
                active === "lichess" ? "bg-zinc-100 text-zinc-900" : "text-zinc-600"
              }`}
              title="Lichess Book"
              onClick={() => setAnalysisRightTab("lichess")}
            >
              <BookOpen className="h-5 w-5" />
            </button>
            {scoutEnabled ? (
              <button
                type="button"
                className={`inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-50 ${
                  active === "scout" ? "bg-zinc-100 text-zinc-900" : "text-zinc-600"
                }`}
                title="Scout Insights"
                onClick={() => {
                  setAnalysisRightTab("scout");
                  if (onScoutPredict) onScoutPredict();
                }}
              >
                <Brain className="h-5 w-5" />
              </button>
            ) : null}
          </div>
          {active === "stats" && (
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700"
              title="Help"
              onClick={() => setShowCandidatesHelp(!showCandidatesHelp)}
            >
              <Info className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="min-w-0 overflow-auto p-3">
          {showCandidatesHelp && active === "stats" && (
            <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] leading-relaxed text-blue-900">
              <div className="mb-2 flex items-center gap-2">
                <Info className="h-4 w-4 flex-shrink-0" />
                <div className="font-semibold">Style-Adjusted Analysis</div>
              </div>
              <div className="space-y-2">
                <p>
                  <strong>Engine Evaluations:</strong> When "Show engine eval column" is enabled, you'll see <strong>two evaluations</strong> for each move:
                </p>
                <ul className="ml-4 space-y-1 list-disc">
                  <li><strong>Top number (black):</strong> Raw Stockfish evaluation</li>
                  <li><strong>Bottom number (amber):</strong> Style-adjusted evaluation based on opponent's playing style</li>
                </ul>
                <p>
                  <strong>Style Markers:</strong> The adjustment is calculated using the opponent's style profile from the Style Spectrum:
                </p>
                <ul className="ml-4 space-y-1 list-disc">
                  <li><strong className="text-red-600">Aggression</strong> — Boosts moves that attack, check, or pressure the king</li>
                  <li><strong className="text-orange-600">Trade Penalty</strong> — Penalizes queen trades for players who avoid them</li>
                  <li><strong className="text-yellow-600">Material Greed</strong> — Boosts captures and material gains</li>
                  <li><strong className="text-purple-600">Complexity</strong> — Boosts moves that increase tension and complications</li>
                  <li><strong className="text-blue-600">Space Expansion</strong> — Boosts pawn advances and territorial control</li>
                </ul>
                <p>
                  <strong>Style Badges:</strong> Moves that strongly match the opponent's style show colored badges below the W/D/L bar with the style bonus percentage.
                </p>
                <p className="text-[10px] italic text-blue-700">
                  Note: Style adjustments only appear when opponent has loaded style markers and moves trigger specific patterns (captures, checks, trades, etc.)
                </p>
              </div>
            </div>
          )}
          {active === "filters" ? (
            <div className="grid gap-3">
              <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
                <div className="grid gap-2">
                  <div className="text-[10px] font-medium text-zinc-900">Opponent Plays</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={`inline-flex h-8 flex-1 items-center justify-center rounded-lg text-[10px] font-medium transition-colors ${
                        opponentPlaysColor === "white"
                          ? "bg-zinc-900 text-white"
                          : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                      onClick={() => setOpponentPlaysColor("white")}
                    >
                      ♔ White
                    </button>
                    <button
                      type="button"
                      className={`inline-flex h-8 flex-1 items-center justify-center rounded-lg text-[10px] font-medium transition-colors ${
                        opponentPlaysColor === "black"
                          ? "bg-zinc-900 text-white"
                          : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                      onClick={() => setOpponentPlaysColor("black")}
                    >
                      ♚ Black
                    </button>
                  </div>
                  <div className="text-[9px] text-zinc-500">
                    You play as {opponentPlaysColor === "white" ? "Black" : "White"}
                  </div>
                </div>
              </div>

              {analysisFiltersPanel}
            </div>
          ) : active === "preferences" ? (
            <div className="grid gap-2 text-[10px] text-zinc-700">
              <div className="text-[10px] font-medium text-zinc-900">Preferences</div>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={analysisShowArrow} onChange={(e) => setAnalysisShowArrow(e.target.checked)} />
                Show arrows
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={analysisShowEval} onChange={(e) => setAnalysisShowEval(e.target.checked)} />
                Show eval
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={analysisShowEngineBest}
                  onChange={(e) => setAnalysisShowEngineBest(e.target.checked)}
                />
                Display engine’s best move
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={analysisShowEngineColumn}
                  onChange={(e) => setAnalysisShowEngineColumn(e.target.checked)}
                />
                Show engine eval column
              </label>

              <div className="pt-1 text-[10px] font-medium text-zinc-900">Audio</div>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} />
                {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                Enable sounds
              </label>
            </div>
          ) : null}

          <div className={active === "stats" ? "" : "hidden"}>
            <AnalysisBoard
              state={state}
              opponentUsername={opponentUsername}
              opponentImportedCount={opponentImportedCount}
              isSyncing={analysisIsSyncingOpponent}
              filtersKey={filtersKey}
              requestOpponentMove={requestOpponentMove}
              showArrow={analysisShowArrow}
              onShowArrowChange={setAnalysisShowArrow}
              showEval={analysisShowEval}
              onEvalChange={setAnalysisEval}
              showEngineBest={analysisShowEngineBest}
              engineBestMove={analysisEngineBestUci ? { uci: analysisEngineBestUci, san: analysisEngineBestSan } : null}
              setEngineBestMove={handleSetEngineBestMove}
              opponentStatsBusy={analysisStatsBusy}
              opponentStats={analysisStats}
              setOpponentStats={setAnalysisStats}
              setOpponentStatsBusy={setAnalysisStatsBusy}
              enabled={active === "stats" || analysisFilterApplyStatus === "applying"}
              showEngineColumn={analysisShowEngineColumn}
              styleMarkers={analysisStyleMarkers}
              platform="lichess"
              filterFrom={filterFrom}
              filterTo={filterTo}
              filterSpeeds={filterSpeeds}
              filterRated={filterRated}
            />
          </div>

          <div className={active === "lichess" ? "" : "hidden"}>
            <LichessBookTab
              moves={lichessMoves}
              busy={lichessBusy}
              error={lichessError}
              source={lichessSource}
              onSourceChange={setLichessSource}
              showArrows={lichessShowArrows}
              onShowArrowsChange={setLichessShowArrows}
              isWhiteToMove={state.game.turn() === "w"}
              onMoveClick={(san, uci) => {
                if (!san && !uci) return;
                try {
                  const next = new Chess(state.fen);
                  const move = uci && uci.length >= 4
                    ? next.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined })
                    : next.move(san);
                  if (!move) return;
                  state.commitGame(next, move.san ?? null);
                } catch {
                  // Move was not legal in this position
                }
              }}
              onRetry={() => {
                const reqId = (lichessReqIdRef.current += 1);
                setLichessBusy(true);
                setLichessError(null);
                void (async () => {
                  try {
                    const moves = await fetchLichessStats(state.fen, "standard", lichessSource);
                    if (lichessReqIdRef.current !== reqId) return;
                    setLichessMoves(moves);
                    setLichessBusy(false);
                  } catch (e) {
                    if (lichessReqIdRef.current !== reqId) return;
                    const msg = e instanceof Error ? e.message : "Failed to load Lichess explorer";
                    setLichessError(msg);
                    setLichessBusy(false);
                  }
                })();
              }}
            />
          </div>

          {/* Scout Insights Tab */}
          <div className={active === "scout" ? "" : "hidden"}>
            <ScoutPanelContent
              prediction={scoutPrediction}
              loading={scoutLoading}
              error={scoutError}
              mode={scoutMode}
              onModeChange={onScoutModeChange}
              opponentUsername={opponentUsername}
              opponentReplyByMove={scoutOpponentReplyByMove}
              opponentReplyLoading={scoutOpponentReplyLoading}
              onRefresh={onScoutPredict}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function SimulationAutoTrigger(props: {
  state: ChessBoardCoreState;
  opponentUsername: string;
  opponentMode: Strategy;
  filtersKey: string;
  simBusy: boolean;
  clocksEnabled: boolean;
  clockPaused: boolean;
  clockExpired: boolean;
  gameStarted: boolean;
  onOpponentMoveNow: () => void;
  children: React.ReactNode;
}) {
  const {
    state,
    opponentUsername,
    opponentMode,
    filtersKey,
    simBusy,
    clocksEnabled,
    clockPaused,
    clockExpired,
    gameStarted,
    onOpponentMoveNow,
    children,
  } = props;

  const lastAutoKeyRef = useRef<string | null>(null);

  const turn = state.game.turn();
  const isPlayersTurn =
    (state.playerSide === "white" && turn === "w") || (state.playerSide === "black" && turn === "b");
  const isOpponentsTurn = !isPlayersTurn;

  // Determine if opponent is white (user plays black)
  const opponentIsWhite = state.playerSide === "black";

  useEffect(() => {
    if (state.isGameOver) return;
    if (simBusy) return;
    if (!opponentUsername.trim()) return;
    if (!isOpponentsTurn) return;

    // If opponent is white, game must be started via Play button (regardless of clocks)
    if (opponentIsWhite && !gameStarted) return;

    // If clocks are enabled and running, check pause/expired
    if (clocksEnabled && gameStarted) {
      if (clockExpired) return;
      if (clockPaused) return;
    }

    const key = `${state.fen}|${turn}|${opponentUsername}|${opponentMode}|${filtersKey}|${gameStarted}`;
    if (lastAutoKeyRef.current === key) return;
    lastAutoKeyRef.current = key;

    onOpponentMoveNow();
  }, [
    state.fen,
    state.isGameOver,
    simBusy,
    opponentUsername,
    filtersKey,
    clocksEnabled,
    clockPaused,
    clockExpired,
    gameStarted,
    isOpponentsTurn,
    opponentIsWhite,
    turn,
    opponentMode,
    onOpponentMoveNow,
  ]);

  return <>{children}</>;
}
