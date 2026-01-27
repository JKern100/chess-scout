"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OpponentFiltersPanel } from "@/components/chess/OpponentFiltersPanel";
import { useOpponentFilters } from "@/components/chess/useOpponentFilters";
import { StyleSpectrumBar, StyleSpectrumData } from "@/components/profile/StyleSpectrumBar";
import { GenerationProgressModal } from "@/components/profile/GenerationProgressModal";
import { trackActivity } from "@/lib/trackActivity";
import ReactMarkdown from "react-markdown";
import { Download, Mail } from "lucide-react";

type ChessPlatform = "lichess" | "chesscom";

type Props = {
  platform: ChessPlatform;
  username: string;
  isSelfAnalysis?: boolean;
};

type OpeningSnapshot = {
  top: Array<{ move: string; count: number; pct: number }>;
  total: number;
  concentration_pct: number;
};

type V2OpeningRow = {
  eco: string | null;
  name: string;
  games: number;
  pct: number;
};

type V2BranchNode = {
  ply: number;
  prefix: string[];
  total: number;
  next: Array<{ move: string; games: number; pct: number }>;
};

type OpponentProfileV2 = {
  profile_version: 2;
  generated_at: string;
  filters_used: any;
  games_analyzed: number;
  date_range_start: string | null;
  date_range_end: string | null;
  source_game_ids_hash: string;
  segments: Record<
    string,
    {
      dataset: {
        games_analyzed: number;
        date_range_start: string | null;
        date_range_end: string | null;
        speeds: Record<string, number>;
        colors: { white: number; black: number };
        dominant_speed: string | null;
      };
      openings: {
        as_white: V2OpeningRow[];
        as_black_vs_e4: V2OpeningRow[];
        as_black_vs_d4: V2OpeningRow[];
        as_black_vs_c4?: V2OpeningRow[];
        as_black_vs_nf3?: V2OpeningRow[];
        sample_warning: string | null;
      };
      repertoire: {
        vs_e4: { nodes: V2BranchNode[] };
        vs_d4: { nodes: V2BranchNode[] };
      };
      style: {
        castling: {
          kingside: number;
          queenside: number;
          none: number;
          avg_castle_move: number | null;
        };
        queen_trade_by_20: { traded: number; not_traded: number; pct: number };
        pawn_storm_after_castle: { kingside_pct: number; queenside_pct: number };
        aggression: {
          avg_pawns_advanced_by_10: number;
          avg_captures_by_15: number;
          avg_checks_by_15: number;
        };
      };
      results: {
        overall: { win: number; draw: number; loss: number; total: number };
        by_color: {
          as_white: { win: number; draw: number; loss: number; total: number };
          as_black: { win: number; draw: number; loss: number; total: number };
        };
      };
    }
  >;
  engineInsights: null;
  v3?: {
    contexts: {
      as_white: {
        concentration: { top_line_pct: number; top_3_pct: number; label: string };
        entry_point: {
          decisive_move_san: string | null;
          decisive_move_annotated: string | null;
          avg_move_number: number | null;
          decisive_move_pct: number | null;
          threshold: number;
        };
        deviation_habit: {
          early_deviation_rate: number | null;
          label: string;
          measured_over_games: number;
          prefix_ply: number;
          diverge_before_ply: number;
        };
      };
      as_black_vs_e4: {
        concentration: { top_line_pct: number; top_3_pct: number; label: string };
        entry_point: {
          decisive_move_san: string | null;
          decisive_move_annotated: string | null;
          avg_move_number: number | null;
          decisive_move_pct: number | null;
          threshold: number;
        };
        deviation_habit: {
          early_deviation_rate: number | null;
          label: string;
          measured_over_games: number;
          prefix_ply: number;
          diverge_before_ply: number;
        };
      };
      as_black_vs_d4: {
        concentration: { top_line_pct: number; top_3_pct: number; label: string };
        entry_point: {
          decisive_move_san: string | null;
          decisive_move_annotated: string | null;
          avg_move_number: number | null;
          decisive_move_pct: number | null;
          threshold: number;
        };
        deviation_habit: {
          early_deviation_rate: number | null;
          label: string;
          measured_over_games: number;
          prefix_ply: number;
          diverge_before_ply: number;
        };
      };
    };
    structure_profile: {
      castling_side_label: string;
      early_queen_trades_label: string;
      opposite_castling_label: string;
      castling: { kingside: number; queenside: number; none: number };
      queen_trade_by_20_pct: number;
      opposite_castling_pct: number;
    };
    prep_summary: string;
    message?: string;
  };
  message?: string;
};

type V2SegmentProfile = OpponentProfileV2["segments"][string];

type V3Context = NonNullable<OpponentProfileV2["v3"]>["contexts"]["as_white"];

type OpponentProfileV1 = {
  generated_at: string;
  games_analyzed: number;
  dataset: {
    date_min: string | null;
    date_max: string | null;
    time_controls: Record<string, number>;
    colors: { white: number; black: number };
  };
  openings: {
    as_white_first_move: OpeningSnapshot;
    as_black_vs_e4: OpeningSnapshot;
    as_black_vs_d4: OpeningSnapshot;
  };
  tendencies: {
    castling: {
      kingside: number;
      queenside: number;
      none: number;
      avg_castle_move: number | null;
    };
    early_queen_trade_by_20: {
      traded: number;
      not_traded: number;
      pct: number;
    };
  };
  results: {
    win: number;
    loss: number;
    draw: number;
    by_speed?: Record<string, { win: number; loss: number; draw: number; total: number }>;
  };
  message?: string;
};

type OpponentProfileRow = {
  id: string;
  platform: ChessPlatform;
  username: string;
  ratings?: Record<string, number> | null;
  filters_json: any | null;
  profile_version?: number | null;
  profile_json?: OpponentProfileV2 | null;
  stats_json: OpponentProfileV1 | null;
  games_analyzed: number | null;
  generated_at: string | null;
  date_range_start?: string | null;
  date_range_end?: string | null;
  source_game_ids_hash?: string | null;
  ai_quick_summary?: string | null;
  ai_comprehensive_report?: string | null;
  ai_narrative_generated_at?: string | null;
  ai_subject_type?: "self" | "opponent" | null;
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

/** Extract absolute spectrum data from stored style marker metrics_json */
function extractSpectrumData(marker: StoredStyleMarker | null, config: {
  valueKey: string;
  benchmarkKey: string;
  maxRaw: number;
  countKey?: string;
  totalKey?: string;
  colorFilter?: "overall" | "white" | "black";
  categoryFilter?: string;
}): StyleSpectrumData | undefined {
  if (!marker?.metrics_json) return undefined;
  const m = marker.metrics_json;
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
  
  const numerator = config.countKey && typeof m[config.countKey] === "number" ? m[config.countKey] : undefined;
  if (sampleSize === undefined) {
    sampleSize = config.totalKey && typeof m[config.totalKey] === "number" ? m[config.totalKey] : undefined;
  }
  
  // Get alerts and available categories
  const alerts = contextual?.alerts ?? [];
  const availableCategories = contextual?.available_categories ?? [];
  
  return {
    opponentRaw,
    benchmarkRaw,
    maxRaw: config.maxRaw,
    category,
    numerator,
    sampleSize,
    alerts,
    colorFilter,
    availableCategories,
  };
}

function formatPlatformLabel(platform: ChessPlatform) {
  return platform === "lichess" ? "Lichess" : "Chess.com";
}

function formatFiltersSummary(params: {
  speeds: string[];
  rated: string;
  fromDate: string;
  toDate: string;
}) {
  const speeds = params.speeds.length > 0 ? params.speeds.join(" + ") : "Any";
  const rated = params.rated === "any" ? "All" : params.rated === "rated" ? "Rated" : "Casual";
  const range = params.fromDate || params.toDate ? `${params.fromDate || "…"} → ${params.toDate || "…"}` : "All time";
  return `${speeds}, ${rated}, ${range}`;
}

function formatDateTime(iso: string) {
  const ts = new Date(iso);
  if (!Number.isFinite(ts.getTime())) return iso;
  return ts.toLocaleString();
}

function filterPctAtLeastOne<T extends { pct: number }>(rows: T[]) {
  return rows.filter((r): r is T => r.pct >= 1);
}

function makeBranchKey(prefix: string[]) {
  return prefix.join("|");
}

function BentoCard(props: { title?: string; children: React.ReactNode; className?: string; headerRight?: React.ReactNode }) {
  const { title, children, className, headerRight } = props;
  return (
    <section
      className={
        "rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-sm " +
        (className ?? "")
      }
    >
      {title || headerRight ? (
        <div className="flex items-center justify-between gap-4">
          {title ? <div className="text-xs font-semibold tracking-wide text-neutral-700">{title}</div> : <div />}
          {headerRight ? <div>{headerRight}</div> : null}
        </div>
      ) : null}
      <div className={title || headerRight ? "mt-3" : ""}>{children}</div>
    </section>
  );
}

function KpiCard(props: { label: string; value: string; sub?: string }) {
  const { label, value, sub } = props;
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="text-[10px] font-medium text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-neutral-900">{value}</div>
      {sub ? <div className="mt-1 text-[10px] text-neutral-500">{sub}</div> : null}
    </div>
  );
}

function SegmentedBar(props: {
  segments: Array<{ label: string; value: number }>;
  total: number;
  accentHex?: string;
}) {
  const { segments, total, accentHex } = props;
  const accent = accentHex ?? "#FFFF00";
  const safeTotal = total > 0 ? total : 1;
  return (
    <div className="grid gap-2">
      <div className="flex w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
        {segments.map((s) => {
          const pct = Math.max(0, Math.min(100, (s.value / safeTotal) * 100));
          return (
            <div
              key={s.label}
              className="h-2"
              style={{ width: `${pct}%`, backgroundColor: s.value > 0 ? accent : "rgba(0,0,0,0.06)" }}
              title={`${s.label}: ${pct.toFixed(0)}%`}
            />
          );
        })}
      </div>
      <div className="grid gap-1 text-[10px] text-neutral-600 md:grid-cols-3">
        {segments.map((s) => {
          const pct = Math.max(0, Math.min(100, (s.value / safeTotal) * 100));
          return (
            <div key={s.label} className="flex items-center justify-between gap-2">
              <span className="truncate">{s.label}</span>
              <span className="font-medium text-neutral-900">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RepertoireTree(params: { nodes: V2BranchNode[]; maxDepth: number; opponentLabel: string }) {
  const { nodes, maxDepth, opponentLabel } = params;

  const byPrefix = useMemo(() => {
    const m = new Map<string, V2BranchNode>();
    for (const n of nodes) m.set(makeBranchKey(n.prefix), n);
    return m;
  }, [nodes]);

  const renderPrefix = (prefix: string[], depth: number) => {
    const node = byPrefix.get(makeBranchKey(prefix));
    if (!node) return null;
    if (depth >= maxDepth) return null;

    const next = filterPctAtLeastOne(node.next);
    if (next.length === 0) return null;

    return (
      <div className={depth === 0 ? "mt-2" : "mt-1"}>
        <div className="grid gap-1">
          {next.map((m) => {
            const childPrefix = [...prefix, m.move];
            const hasChild = byPrefix.has(makeBranchKey(childPrefix));
            const ply = childPrefix.length;
            const who = ply % 2 === 1 ? "white" : opponentLabel;
            return (
              <div key={makeBranchKey(childPrefix)} className="relative pl-4">
                <div className="absolute bottom-0 left-1 top-0 w-px bg-neutral-200" />
                <div className="absolute left-1 top-2 h-px w-3 bg-neutral-200" />
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-neutral-900">
                    {m.move} <span className="text-neutral-600">({who})</span>
                  </span>
                  <span className="text-neutral-600">{m.pct.toFixed(0)}% ({m.games})</span>
                </div>
                {hasChild ? <div className="ml-2">{renderPrefix(childPrefix, depth + 1)}</div> : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return <div className="text-xs text-neutral-700">{renderPrefix([], 0)}</div>;
}

export function OpponentProfileClient({ platform, username, isSelfAnalysis = false }: Props) {
  const { speeds, setSpeeds, rated, setRated, datePreset, setDatePreset, fromDate, setFromDate, toDate, setToDate } = useOpponentFilters();

  const [profileRow, setProfileRow] = useState<OpponentProfileRow | null>(null);
  const [storedStyleMarkers, setStoredStyleMarkers] = useState<StoredStyleMarker[]>([]);
  const [loadBusy, setLoadBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [generateBusy, setGenerateBusy] = useState(false);

  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [progressStatus, setProgressStatus] = useState<"idle" | "generating" | "completed" | "cancelled" | "error">("idle");
  const [progressError, setProgressError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<number>(1);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchProfile = useCallback(async () => {
    setLoadBusy(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/opponents/${encodeURIComponent(platform)}/${encodeURIComponent(username)}/profile`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((json as any)?.error ?? "Failed to load report"));
      setNeedsMigration(Boolean((json as any)?.needs_migration));
      setProfileRow(((json as any)?.opponent_profile as OpponentProfileRow | null) ?? null);
      const profileMarkers = Array.isArray((json as any)?.style_markers)
        ? (((json as any).style_markers as StoredStyleMarker[]) ?? []).filter(Boolean)
        : [];
      // Keep PROFILE archetypes available for display; SESSION markers are fetched separately for filter-scoped axes.
      setStoredStyleMarkers(profileMarkers);
    } catch (e) {
      setProfileRow(null);
      setNeedsMigration(false);
      setLoadError(e instanceof Error ? e.message : "Failed to load report");
    } finally {
      setLoadBusy(false);
    }
  }, [platform, username]);

  // Build session key from current filters (same format as Analysis page)
  const sessionKey = useMemo(() => {
    const speedsPart = speeds.length > 0 ? speeds.slice().sort().join(",") : "any";
    const ratedPart = rated;
    const fromPart = fromDate || "";
    const toPart = toDate || "";
    return `${speedsPart}|${ratedPart}|${fromPart}|${toPart}`;
  }, [speeds, rated, fromDate, toDate]);

  // Fetch SESSION markers (same as Analysis page uses)
  // Returns true if markers were found, false otherwise
  const fetchSessionMarkers = useCallback(async (sk: string): Promise<boolean> => {
    try {
      const res = await fetch(
        `/api/sim/session/markers?platform=${encodeURIComponent(platform)}&username=${encodeURIComponent(username)}&session_key=${encodeURIComponent(sk)}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return false;
      const rows = Array.isArray((json as any)?.markers) ? ((json as any).markers as StoredStyleMarker[]) : [];
      const filtered = rows.filter(Boolean);
      setStoredStyleMarkers((prev) => {
        const keep = (prev ?? []).filter(
          (m) => typeof m?.marker_key === "string" && m.marker_key.startsWith("archetype_")
        );
        const byKey = new Map<string, StoredStyleMarker>();
        for (const m of keep) {
          if (m?.marker_key) byKey.set(m.marker_key, m);
        }
        // Prefer SESSION markers for axes (they are filter-scoped)
        for (const m of filtered) {
          if (m?.marker_key) byKey.set(m.marker_key, m);
        }
        return Array.from(byKey.values());
      });
      return filtered.length > 0;
    } catch {
      // Silent fail - markers will just not display
      return false;
    }
  }, [platform, username]);

  // Compute SESSION markers (triggers /api/sim/session/start)
  const computeSessionMarkers = useCallback(async (sk: string) => {
    try {
      await fetch("/api/sim/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform,
          username,
          speeds,
          rated,
          from: fromDate || null,
          to: toDate || null,
          enableStyleMarkers: true,
          session_key: sk,
        }),
      });
    } catch {
      // Silent fail
    }
  }, [platform, username, speeds, rated, fromDate, toDate]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  // Also fetch SESSION markers on mount and when filters change
  // If no markers exist, compute them and then re-fetch
  useEffect(() => {
    let cancelled = false;
    
    async function loadOrComputeMarkers() {
      const hasMarkers = await fetchSessionMarkers(sessionKey);
      if (cancelled) return;
      
      // If no markers were found, compute them and then re-fetch
      if (!hasMarkers) {
        await computeSessionMarkers(sessionKey);
        if (cancelled) return;
        // Wait a bit for computation to complete, then re-fetch
        await new Promise((r) => setTimeout(r, 1500));
        if (cancelled) return;
        await fetchSessionMarkers(sessionKey);
      }
    }
    
    void loadOrComputeMarkers();
    
    return () => {
      cancelled = true;
    };
  }, [fetchSessionMarkers, computeSessionMarkers, sessionKey]);

  const currentFiltersSummary = useMemo(() => {
    return formatFiltersSummary({ speeds, rated, fromDate, toDate });
  }, [fromDate, rated, speeds, toDate]);

  const v2Profile = (profileRow?.profile_json as OpponentProfileV2 | null | undefined) ?? null;
  const hasV2 = Boolean(v2Profile && v2Profile.profile_version === 2);
  const v3Addon = v2Profile?.v3 ?? null;
  const hasV3 = Boolean(v3Addon);
  const hasProfile = Boolean(hasV2 || profileRow?.stats_json);

  const [segmentKey, setSegmentKey] = useState<string>("all");
  const segment = useMemo(() => {
    if (!hasV2 || !v2Profile) return null;
    const segs = v2Profile.segments ?? {};
    return (segs[segmentKey] ?? segs.all ?? null) as V2SegmentProfile | null;
  }, [hasV2, segmentKey, v2Profile]);

  const availableSegments = useMemo(() => {
    if (!hasV2 || !v2Profile) return ["all"];
    const keys = Object.keys(v2Profile.segments ?? {});
    const ordered = ["all", "blitz", "rapid", "bullet", "classical"].filter((k) => keys.includes(k));
    return ordered.length > 0 ? ordered : ["all"];
  }, [hasV2, v2Profile]);

  const [openingsOpen, setOpeningsOpen] = useState(true);
  const [repertoireOpen, setRepertoireOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [datasetOpen, setDatasetOpen] = useState(false);
  const [styleMarkersOpen, setStyleMarkersOpen] = useState(true);
  const [styleMarkersHelpOpen, setStyleMarkersHelpOpen] = useState(false);
  const [generateStyleMarkers, setGenerateStyleMarkers] = useState(true);
  const [narrativeMode, setNarrativeMode] = useState<"quick" | "comprehensive">("quick");
  const [narrativeOpen, setNarrativeOpen] = useState(true);
  const [styleMarkerColorFilter, setStyleMarkerColorFilter] = useState<"overall" | "white" | "black">("overall");
  const [styleMarkerCategoryFilter, setStyleMarkerCategoryFilter] = useState<string | null>(null);

  const runGenerate = useCallback(async () => {
    if (generateBusy) return;
    console.log("[OpponentProfileClient] Starting regeneration for", { platform, username });

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setGenerateBusy(true);
    setActionMessage(null);
    setConfirmOpen(false); // Close confirm dialog when progress modal opens
    setFiltersOpen(false); // Close filters panel too
    setProgressModalOpen(true);
    setProgressStatus("generating");
    setProgressError(null);
    setProgressStep(1); // Start at step 1: Loading game data

    let progressInterval: NodeJS.Timeout | null = null;
    
    try {
      const url = `/api/opponents/${encodeURIComponent(platform)}/${encodeURIComponent(username)}/profile/generate`;
      console.log("[OpponentProfileClient] Sending POST to:", url);
      
      // Step 1: Loading game data - starting request
      setProgressStep(1);
      
      // Use a progress simulation that advances while waiting for the backend
      // The backend does: load games -> parse -> classify openings -> analyze style -> compute patterns -> calc stats -> style markers -> AI narrative
      progressInterval = setInterval(() => {
        setProgressStep((prev) => {
          // Advance through steps 1-7, then stay at 8 (Finalizing) until complete
          if (prev < 8) return prev + 1;
          return 8;
        });
      }, 2500); // Advance every 2.5 seconds
      
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          speeds,
          rated,
          from: fromDate || null,
          to: toDate || null,
          enable_style_markers: generateStyleMarkers,
          enable_ai_narrative: true,
          subject_type: isSelfAnalysis ? "self" : "opponent",
        }),
        signal: controller.signal,
      });
      
      clearInterval(progressInterval);
      
      // Step 8: Finalizing report - processing response
      setProgressStep(8);
      
      console.log("[OpponentProfileClient] Response status:", res.status);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const needs = Boolean((json as any)?.needs_migration);
        setNeedsMigration(needs);
        throw new Error(String((json as any)?.error ?? "Failed to generate report"));
      }
      setNeedsMigration(Boolean((json as any)?.needs_migration));
      setProfileRow(((json as any)?.opponent_profile as OpponentProfileRow | null) ?? null);

      // Compute SESSION markers with current filters (same data source as Analysis page)
      // This ensures Profile and Analysis pages show identical style marker values
      if (generateStyleMarkers) {
        await computeSessionMarkers(sessionKey);
        await fetchSessionMarkers(sessionKey);
      }

      const v2Games = Number((json as any)?.opponent_profile?.profile_json?.games_analyzed ?? NaN);

      const msgV2 = (json as any)?.opponent_profile?.profile_json?.message;
      const msgV3 = (json as any)?.opponent_profile?.profile_json?.v3?.message;
      const msgV1 = (json as any)?.opponent_profile?.stats_json?.message;
      const msgBase = typeof msgV3 === "string" && msgV3.trim() ? msgV3 : typeof msgV2 === "string" && msgV2.trim() ? msgV2 : null;
      const msg = msgBase ?? (Number.isFinite(v2Games) && v2Games === 0 ? msgV1 : null);

      const debugCounts =
        (json as any)?.debug_counts ??
        (json as any)?.opponent_profile?.profile_json?.debug_counts ??
        (json as any)?.opponent_profile?.profile_json?.debugCounts ??
        null;

      if (debugCounts && typeof debugCounts === "object") {
        const debugText = JSON.stringify(debugCounts);
        setActionMessage(`${typeof msg === "string" && msg.trim() ? msg.trim() : "No games matched the selected filters."}\n\nDebug: ${debugText}`);
      } else if (Number.isFinite(v2Games) && v2Games === 0) {
        if (typeof msg === "string" && msg.trim()) setActionMessage(msg);
        else setActionMessage("No games matched the selected filters.");
      } else if (typeof msg === "string" && msg.trim()) {
        setActionMessage(msg);
      } else {
        setActionMessage(null);
      }

      setProgressStatus("completed");
      
      // Re-open modal to show completion (even if user dismissed to browse)
      setProgressModalOpen(true);
      
      // Track report generation for admin metrics
      void trackActivity("report_generated", { platform, username });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setProgressStatus("cancelled");
      } else {
        const errorMsg = e instanceof Error ? e.message : "Failed to generate report";
        setActionMessage(errorMsg);
        setProgressStatus("error");
        setProgressError(errorMsg);
        setProgressModalOpen(true);
      }
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setGenerateBusy(false);
      abortControllerRef.current = null;
    }
  }, [computeSessionMarkers, fetchSessionMarkers, fromDate, generateBusy, generateStyleMarkers, isSelfAnalysis, platform, rated, sessionKey, speeds, toDate, username]);

  const handleCancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const handleDismissProgressModal = useCallback(() => {
    setProgressModalOpen(false);
    if (progressStatus === "completed" || progressStatus === "cancelled" || progressStatus === "error") {
      setProgressStatus("idle");
      setProgressError(null);
    }
  }, [progressStatus]);

  const handleDownloadPdf = useCallback(async () => {
    const content = narrativeMode === "quick" 
      ? profileRow?.ai_quick_summary 
      : profileRow?.ai_comprehensive_report;
    
    if (!content) return;

    // Dynamically import html2pdf to avoid SSR issues
    const html2pdf = (await import("html2pdf.js")).default;
    
    // Create a styled HTML document for the PDF
    const reportTitle = narrativeMode === "quick" ? "Quick Analysis" : "Comprehensive Report";
    const subjectLabel = profileRow?.ai_subject_type === "self" ? "Self-Review" : "Opponent Scout";
    
    const htmlContent = `
      <div style="font-family: 'Segoe UI', system-ui, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #3b82f6;">
          <h1 style="font-size: 28px; font-weight: bold; color: #1e40af; margin: 0 0 8px 0;">♟ ChessScout</h1>
          <p style="font-size: 14px; color: #64748b; margin: 0;">AI-Powered Chess Analysis</p>
        </div>
        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 20px; font-weight: 600; color: #1e293b; margin: 0 0 8px 0;">${reportTitle}: ${username}</h2>
          <div style="display: flex; gap: 16px; font-size: 12px; color: #64748b;">
            <span style="background: #eff6ff; color: #1d4ed8; padding: 4px 12px; border-radius: 12px;">${subjectLabel}</span>
            <span>Platform: ${platform}</span>
            ${profileRow?.ai_narrative_generated_at ? `<span>Generated: ${new Date(profileRow.ai_narrative_generated_at).toLocaleDateString()}</span>` : ""}
          </div>
        </div>
        <div style="font-size: 14px; line-height: 1.7; color: #334155;">
          ${content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                   .replace(/\*([^*]+)\*/g, '<em>$1</em>')
                   .replace(/^### (.+)$/gm, '<h4 style="font-size: 14px; font-weight: 600; margin: 16px 0 8px 0; color: #1e293b;">$1</h4>')
                   .replace(/^## (.+)$/gm, '<h3 style="font-size: 16px; font-weight: 600; margin: 20px 0 12px 0; color: #1e293b;">$1</h3>')
                   .replace(/^# (.+)$/gm, '<h2 style="font-size: 18px; font-weight: 600; margin: 24px 0 14px 0; color: #1e293b;">$1</h2>')
                   .replace(/^\* (.+)$/gm, '<li style="margin: 4px 0 4px 20px;">$1</li>')
                   .replace(/^- (.+)$/gm, '<li style="margin: 4px 0 4px 20px;">$1</li>')
                   .replace(/^\d+\. (.+)$/gm, '<li style="margin: 4px 0 4px 20px;">$1</li>')
                   .replace(/\n\n/g, '</p><p style="margin: 12px 0;">')
                   .replace(/\n/g, '<br>')}
        </div>
        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8;">
          Generated by ChessScout • ${new Date().toLocaleDateString()}
        </div>
      </div>
    `;

    const element = document.createElement("div");
    element.innerHTML = htmlContent;

    const opt = {
      margin: 10,
      filename: `ChessScout_${username}_${narrativeMode}_${new Date().toISOString().split("T")[0]}.pdf`,
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm" as const, format: "a4" as const, orientation: "portrait" as const },
    };

    await html2pdf().set(opt).from(element).save();
  }, [narrativeMode, platform, profileRow, username]);

  const handleShareEmail = useCallback(() => {
    const content = narrativeMode === "quick" 
      ? profileRow?.ai_quick_summary 
      : profileRow?.ai_comprehensive_report;
    
    if (!content) return;

    const reportTitle = narrativeMode === "quick" ? "Quick Analysis" : "Comprehensive Report";
    const subjectLabel = profileRow?.ai_subject_type === "self" ? "Self-Review" : "Opponent Scout";
    
    const subject = encodeURIComponent(`ChessScout ${subjectLabel}: ${username} - ${reportTitle}`);
    const body = encodeURIComponent(
      `ChessScout AI Coach Analysis\n` +
      `================================\n\n` +
      `Player: ${username}\n` +
      `Platform: ${platform}\n` +
      `Report Type: ${reportTitle} (${subjectLabel})\n` +
      `${profileRow?.ai_narrative_generated_at ? `Generated: ${new Date(profileRow.ai_narrative_generated_at).toLocaleDateString()}\n` : ""}` +
      `\n================================\n\n` +
      `${content}\n\n` +
      `--------------------------------\n` +
      `Generated by ChessScout`
    );

    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }, [narrativeMode, platform, profileRow, username]);

  const onClickPrimary = useCallback(() => {
    if (generateBusy) return;
    setActionMessage(null);
    if (needsMigration) {
      setActionMessage("Scout report schema is missing v2 columns. Run scripts/supabase_opponent_profiles.sql in Supabase SQL editor.");
      return;
    }
    if (!hasProfile) {
      setFiltersOpen(true);
      return;
    }
    setConfirmOpen(true);
  }, [generateBusy, hasProfile, needsMigration, runGenerate]);

  const confirmRegenerate = useCallback(() => {
    setConfirmOpen(false);
    void runGenerate();
  }, [runGenerate]);

  const stats = profileRow?.stats_json ?? null;

  const kpiTotalGames = hasV2 && v2Profile ? String(v2Profile.games_analyzed) : stats ? String(stats.games_analyzed) : "—";

  const kpiTopTimeControl = useMemo(() => {
    if (hasV2 && segment) {
      const entries = Object.entries(segment.dataset.speeds ?? {}) as Array<[string, any]>;
      if (entries.length === 0) return "—";
      let best: { k: string; v: number } | null = null;
      for (const [k, v] of entries) {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) continue;
        if (!best || n > best.v) best = { k, v: n };
      }
      return best ? best.k : "—";
    }
    if (stats?.dataset?.time_controls) {
      const entries = Object.entries(stats.dataset.time_controls) as Array<[string, any]>;
      if (entries.length === 0) return "—";
      let best: { k: string; v: number } | null = null;
      for (const [k, v] of entries) {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) continue;
        if (!best || n > best.v) best = { k, v: n };
      }
      return best ? best.k : "—";
    }
    return "—";
  }, [hasV2, segment, stats]);

  const kpiRating = useMemo(() => {
    const ratings = profileRow?.ratings;
    if (!ratings || typeof ratings !== "object") return "—";
    
    const dominantSpeed = segment?.dataset?.dominant_speed ?? kpiTopTimeControl;
    if (dominantSpeed && dominantSpeed !== "—" && ratings[dominantSpeed]) {
      return `${ratings[dominantSpeed]} (${dominantSpeed})`;
    }
    
    const speedPriority = ["blitz", "rapid", "bullet", "classical"];
    for (const speed of speedPriority) {
      if (ratings[speed]) {
        return `${ratings[speed]} (${speed})`;
      }
    }
    
    const firstRating = Object.entries(ratings)[0];
    if (firstRating) {
      return `${firstRating[1]} (${firstRating[0]})`;
    }
    
    return "—";
  }, [profileRow?.ratings, segment?.dataset?.dominant_speed, kpiTopTimeControl]);

  const onOpenFilters = useCallback(() => {
    if (generateBusy) return;
    setFiltersOpen(true);
  }, [generateBusy]);

  const onCloseFilters = useCallback(() => {
    setFiltersOpen(false);
  }, []);

  const accent = "#EAB308";

  const axisQueen = storedStyleMarkers.find((m) => m.marker_key === "axis_queen_trades") ?? null;
  const axisCastle = storedStyleMarkers.find((m) => m.marker_key === "axis_castling_timing") ?? null;
  const axisAggro = storedStyleMarkers.find((m) => m.marker_key === "axis_aggression") ?? null;
  const axisLength = storedStyleMarkers.find((m) => m.marker_key === "axis_game_length") ?? null;
  const axisOppCastle = storedStyleMarkers.find((m) => m.marker_key === "axis_opposite_castling") ?? null;

  // Legacy fallback percentages (diff_ratio based)
  const queenPct = spectrumPctFromDiffRatio(axisQueen?.metrics_json?.diff_ratio);
  const castlePct = spectrumPctFromDiffRatio(axisCastle?.metrics_json?.diff_ratio);
  const aggroPct = spectrumPctFromDiffRatio(axisAggro?.metrics_json?.diff_ratio);
  const lengthPct = spectrumPctFromDiffRatio(axisLength?.metrics_json?.diff_ratio);
  const oppCastlePct = spectrumPctFromDiffRatio(axisOppCastle?.metrics_json?.diff_ratio);

  // Absolute spectrum data (new mode with benchmark tick + tooltip)
  const queenData = extractSpectrumData(axisQueen, {
    valueKey: "queen_trade_rate",
    benchmarkKey: "benchmark",
    maxRaw: 1.0,
    colorFilter: styleMarkerColorFilter,
    categoryFilter: styleMarkerCategoryFilter ?? undefined,
  });
  const aggroData = extractSpectrumData(axisAggro, {
    valueKey: "aggression_m15_avg",
    benchmarkKey: "benchmark",
    maxRaw: 8.0,
    colorFilter: styleMarkerColorFilter,
    categoryFilter: styleMarkerCategoryFilter ?? undefined,
  });
  const lengthData = extractSpectrumData(axisLength, {
    valueKey: "avg_game_length",
    benchmarkKey: "benchmark",
    maxRaw: 80.0, // Scale: 0-80 moves
    colorFilter: styleMarkerColorFilter,
    categoryFilter: styleMarkerCategoryFilter ?? undefined,
  });
  const oppCastleData = extractSpectrumData(axisOppCastle, {
    valueKey: "opposite_castle_rate",
    benchmarkKey: "benchmark",
    maxRaw: 1.0,
    colorFilter: styleMarkerColorFilter,
    categoryFilter: styleMarkerCategoryFilter ?? undefined,
  });
  const castleData = extractSpectrumData(axisCastle, {
    valueKey: "avg_castle_ply",
    benchmarkKey: "benchmark_ply",
    maxRaw: 40.0, // Scale: 0-40 plies (move 20)
    colorFilter: styleMarkerColorFilter,
    categoryFilter: styleMarkerCategoryFilter ?? undefined,
  });

  // Get alerts, available categories, and narratives from any axis marker
  const styleMarkerAlerts = axisAggro?.metrics_json?.contextual?.alerts ?? [];
  const styleMarkerAvailableCategories: string[] = axisAggro?.metrics_json?.contextual?.available_categories ?? [];
  const styleMarkerNarratives: Array<{
    axis: string;
    category: string;
    color: string;
    deviation_type: string;
    ratio: number;
    narrative: string;
  }> =
    axisAggro?.metrics_json?.contextual?.narratives ??
    axisAggro?.metrics_json?.contextual?.pro_scout_matrix?.narratives ??
    axisAggro?.metrics_json?.contextual?.context_matrix?.narratives ??
    [];

  // Filter narratives by current context selection
  const filteredNarratives = styleMarkerNarratives.filter((n) => {
    if (styleMarkerCategoryFilter && n.category !== styleMarkerCategoryFilter && n.category !== "overall") return false;
    if (styleMarkerColorFilter !== "overall" && n.color !== styleMarkerColorFilter && n.color !== "overall") return false;
    return true;
  });

  // Extract engine metrics for Engine Grade badge
  const engineMetrics = axisAggro?.metrics_json?.contextual?.engine_metrics ?? null;
  const engineGrade: "S" | "A" | "B" | "C" | null = engineMetrics?.engine_grade ?? null;
  const engineAcpl: number | null = engineMetrics?.acpl?.overall ?? null;
  const analyzedGames: number = engineMetrics?.analyzed_games?.total ?? 0;

  function OpeningBarList(props: { rows: V2OpeningRow[]; title: string; sampleWarning?: string | null; ctx?: V3Context | null }) {
    const { rows, title, sampleWarning, ctx } = props;
    const filtered = filterPctAtLeastOne(rows);
    const maxPct = filtered.reduce((m, r) => Math.max(m, r.pct), 0) || 1;
    return (
      <BentoCard title={title}>
        {ctx ? (
          <div className="grid gap-1">
            <div className="text-[10px] text-neutral-600">
              <span className="font-medium text-neutral-900">Repertoire:</span> {ctx.concentration.label}
            </div>
            <div className="text-[10px] text-neutral-600">
              <span className="font-medium text-neutral-900">Deviation habit:</span> {ctx.deviation_habit.label}
              {ctx.deviation_habit.early_deviation_rate == null
                ? ""
                : ` — ${(ctx.deviation_habit.early_deviation_rate * 100).toFixed(0)}%`}
            </div>
          </div>
        ) : null}
        {sampleWarning ? <div className="text-[10px] text-neutral-500">{sampleWarning}</div> : null}
        <div className="mt-3 grid gap-2">
          {filtered.length === 0 ? (
            <div className="text-xs text-neutral-500">No samples.</div>
          ) : (
            filtered.map((r) => {
              const width = Math.max(2, Math.min(100, (r.pct / maxPct) * 100));
              return (
                <div key={`${r.eco ?? ""}|${r.name}`} className="grid gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-neutral-900">{r.name}</div>
                      {r.eco ? <div className="text-[10px] text-neutral-500">{r.eco}</div> : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs font-semibold text-neutral-900">{r.pct.toFixed(0)}%</div>
                      <div className="text-[10px] text-neutral-500">{r.games} games</div>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-xl bg-neutral-100">
                    <div className="h-2 rounded-xl" style={{ width: `${width}%`, backgroundColor: accent }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </BentoCard>
    );
  }

  const isGeneratingInBackground = generateBusy && !progressModalOpen;

  return (
    <div className="text-neutral-900">
      <div className="mx-auto w-full max-w-6xl">
        {/* Background generation indicator */}
        {isGeneratingInBackground && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
              <span className="text-sm font-medium text-yellow-800">Generating report in background...</span>
            </div>
            <button
              type="button"
              onClick={() => setProgressModalOpen(true)}
              className="text-xs font-medium text-yellow-700 hover:text-yellow-900 underline"
            >
              View Progress
            </button>
          </div>
        )}

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onOpenFilters}
            disabled={generateBusy}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold shadow-sm transition-colors ${
              generateBusy
                ? "border-yellow-300 bg-yellow-50 text-yellow-700 cursor-not-allowed"
                : "border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50"
            }`}
          >
            {generateBusy && <div className="h-3 w-3 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />}
            {generateBusy ? "Generating..." : hasProfile ? "Regenerate Report" : "Generate Report"}
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-12">
          <div className="md:col-span-6">
            <BentoCard
              className="h-full"
              headerRight={
                <span className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-neutral-700">
                  {formatPlatformLabel(platform)}
                </span>
              }
            >
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-lg font-semibold text-neutral-900">
                  {username.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-neutral-900">{username}</div>
                  <div className="mt-1 text-xs text-neutral-600">Scouting snapshot</div>
                </div>
              </div>
            </BentoCard>

            {styleMarkersHelpOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setStyleMarkersHelpOpen(false)}>
                <div
                  className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-zinc-900">ChessScout Style Markers</h3>
                    <button
                      type="button"
                      onClick={() => setStyleMarkersHelpOpen(false)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                    >
                      ✕
                    </button>
                  </div>

                  <article className="prose prose-sm max-w-none text-zinc-700">
                    <h3 className="text-base font-semibold text-zinc-800">Style Markers</h3>
                    <p>
                      Style Markers are behavioral fingerprints computed from your opponent&apos;s historical games.
                      They describe <strong>how</strong> someone tends to play (not just their rating).
                    </p>

                    <h4 className="mt-4 text-sm font-semibold text-zinc-800">What each marker measures</h4>
                    <ul className="text-xs">
                      <li><strong>Queen Trades</strong>: % of games with both queens off the board by move 20</li>
                      <li><strong>Aggression</strong>: captures + checks in the first 15 moves</li>
                      <li><strong>Game Length</strong>: average game length in full moves</li>
                      <li><strong>Opposite Castling</strong>: % of games with opposite-side castling</li>
                      <li><strong>Castling Timing</strong>: average ply when the opponent castles</li>
                    </ul>

                    <h4 className="mt-4 text-sm font-semibold text-zinc-800">Opening & color context</h4>
                    <p className="text-xs">
                      Style often changes with opening type and side. Once markers are generated, you can filter by:
                    </p>
                    <ul className="text-xs">
                      <li><strong>Open</strong>: 1.e4 e5 — tactical, open lines</li>
                      <li><strong>Semi-Open</strong>: 1.e4 (c5, e6, c6, d6, etc.) — asymmetric tension</li>
                      <li><strong>Closed</strong>: 1.d4 d5 — positional, slow builds</li>
                      <li><strong>Indian</strong>: 1.d4 Nf6 — hypermodern systems</li>
                      <li><strong>Flank</strong>: 1.c4, 1.Nf3, 1.g3, etc. — flexible setups</li>
                    </ul>

                    <h4 className="mt-4 text-sm font-semibold text-zinc-800">How to read the spectrum</h4>
                    <ul className="text-xs">
                      <li><strong>Yellow dot</strong>: opponent&apos;s measured value</li>
                      <li><strong>Tick mark</strong>: benchmark for comparison</li>
                      <li><strong>Hover</strong>: exact values + sample size</li>
                    </ul>

                    <h4 className="mt-4 text-sm font-semibold text-zinc-800">How Scout uses Style Markers</h4>
                    <p className="text-xs">
                      Scout combines three signals: <strong>History</strong> (what they played here), <strong>Engine</strong> (best moves),
                      and <strong>Style</strong> (what fits their profile). The weights shift by phase: opening (history-heavy),
                      middlegame (style becomes more important), endgame (engine accuracy dominates).
                    </p>

                    <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 p-3">
                      <div className="text-[11px] font-medium text-amber-800">Performance note</div>
                      <div className="mt-1 text-[11px] text-amber-700">
                        Generating style markers requires extra computation and can add a small delay to filter changes.
                        Turn it off if you don&apos;t need behavior-based analysis.
                      </div>
                    </div>
                  </article>
                </div>
              </div>
            ) : null}
          </div>

          <div className="md:col-span-2">
            <KpiCard label="Games analyzed" value={kpiTotalGames} />
          </div>
          <div className="md:col-span-2">
            <KpiCard label="Top Time Control" value={kpiTopTimeControl} />
          </div>
          <div className="md:col-span-2">
            <KpiCard label="Rating" value={kpiRating} />
          </div>

          <div className="md:col-span-12">
            <BentoCard title="Current Report">
        {loadBusy ? (
          <div className="text-sm text-neutral-700">Loading…</div>
        ) : loadError ? (
          <div className="text-sm text-neutral-700">{loadError}</div>
        ) : needsMigration ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700 shadow-sm">
            Scout report schema is missing v1 columns. Run <span className="font-medium text-neutral-900">scripts/supabase_opponent_profiles.sql</span> in Supabase SQL editor.
          </div>
        ) : hasV2 && v2Profile && segment ? (
          <div className="grid gap-4">
            <div className="grid gap-1 text-xs text-neutral-700">
              <div>
                <span className="font-medium text-neutral-900">Report version:</span> v2
              </div>
              <div>
                <span className="font-medium text-neutral-900">Last generated:</span> {formatDateTime(v2Profile.generated_at)}
              </div>
              <div>
                <span className="font-medium text-neutral-900">Games analyzed:</span> {v2Profile.games_analyzed}
              </div>
              {v2Profile.date_range_start || v2Profile.date_range_end ? (
                <div>
                  <span className="font-medium text-neutral-900">Date range used:</span>{" "}
                  {v2Profile.date_range_start ? formatDateTime(v2Profile.date_range_start) : "…"} →{" "}
                  {v2Profile.date_range_end ? formatDateTime(v2Profile.date_range_end) : "…"}
                </div>
              ) : null}
              <div>
                <span className="font-medium text-neutral-900">Filters used:</span> {currentFiltersSummary}
              </div>
            </div>

            {/* AI Coach Analysis Section - Always visible */}
            <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-blue-800">AI Coach Analysis</span>
                  {profileRow?.ai_subject_type && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                      {profileRow.ai_subject_type === "self" ? "Self-Review" : "Opponent Scout"}
                    </span>
                  )}
                </div>
                {(profileRow?.ai_quick_summary || profileRow?.ai_comprehensive_report) && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white p-0.5">
                      <button
                        type="button"
                        onClick={() => setNarrativeMode("quick")}
                        className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                          narrativeMode === "quick"
                            ? "bg-blue-600 text-white"
                            : "text-blue-700 hover:bg-blue-50"
                        }`}
                      >
                        Quick
                      </button>
                      <button
                        type="button"
                        onClick={() => setNarrativeMode("comprehensive")}
                        className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                          narrativeMode === "comprehensive"
                            ? "bg-blue-600 text-white"
                            : "text-blue-700 hover:bg-blue-50"
                        }`}
                      >
                        Full Report
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNarrativeOpen((v) => !v)}
                      className="inline-flex h-7 items-center justify-center rounded-lg border border-blue-200 bg-white px-2 text-[10px] font-medium text-blue-700 hover:bg-blue-50"
                    >
                      {narrativeOpen ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadPdf()}
                      className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-white px-2 text-[10px] font-medium text-blue-700 hover:bg-blue-50"
                      title="Download as PDF"
                    >
                      <Download className="h-3 w-3" />
                      PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => handleShareEmail()}
                      className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-white px-2 text-[10px] font-medium text-blue-700 hover:bg-blue-50"
                      title="Share via Email"
                    >
                      <Mail className="h-3 w-3" />
                      Email
                    </button>
                  </div>
                )}
              </div>
              {(profileRow?.ai_quick_summary || profileRow?.ai_comprehensive_report) ? (
                narrativeOpen && (
                  <div className="mt-3">
                    {narrativeMode === "quick" ? (
                      <div className="prose prose-sm prose-neutral max-w-none text-sm leading-relaxed text-neutral-800 [&>p]:my-2 [&>ul]:my-2 [&>ul]:ml-4 [&>ul]:list-disc [&>ol]:my-2 [&>ol]:ml-4 [&>ol]:list-decimal [&>strong]:font-semibold [&>h1]:text-base [&>h1]:font-bold [&>h1]:mt-3 [&>h2]:text-sm [&>h2]:font-semibold [&>h2]:mt-2 [&>h3]:text-xs [&>h3]:font-semibold [&>h3]:mt-2">
                        <ReactMarkdown>{profileRow.ai_quick_summary ?? ""}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="prose prose-sm prose-neutral max-w-none text-sm leading-relaxed text-neutral-800 [&>p]:my-2 [&>ul]:my-2 [&>ul]:ml-4 [&>ul]:list-disc [&>ol]:my-2 [&>ol]:ml-4 [&>ol]:list-decimal [&>strong]:font-semibold [&>h1]:text-base [&>h1]:font-bold [&>h1]:mt-4 [&>h2]:text-sm [&>h2]:font-semibold [&>h2]:mt-3 [&>h3]:text-xs [&>h3]:font-semibold [&>h3]:mt-2 [&>li]:my-1">
                        <ReactMarkdown>{profileRow.ai_comprehensive_report ?? ""}</ReactMarkdown>
                      </div>
                    )}
                    {profileRow.ai_narrative_generated_at && (
                      <div className="mt-3 text-[10px] text-blue-600">
                        Generated: {formatDateTime(profileRow.ai_narrative_generated_at)}
                      </div>
                    )}
                  </div>
                )
              ) : (
                <div className="mt-3 text-sm text-blue-700/70">
                  AI analysis will be generated when you regenerate this profile.
                </div>
              )}
            </div>

            {hasV3 && v3Addon ? (
              <div className="grid gap-3">

                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    { title: "As White", ctx: v3Addon.contexts.as_white },
                    { title: "As Black vs 1.e4", ctx: v3Addon.contexts.as_black_vs_e4 },
                    { title: "As Black vs 1.d4", ctx: v3Addon.contexts.as_black_vs_d4 },
                  ].map(({ title, ctx }) => (
                    <div key={title} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                      <div className="text-xs font-semibold text-neutral-700">{title}</div>
                      <div className="mt-2 grid gap-2 text-xs text-neutral-700">
                        <div>
                          <div className="text-[10px] font-medium text-neutral-500">Repertoire concentration</div>
                          <div className="mt-1">
                            <span className="font-medium text-neutral-900">{ctx.concentration.label}</span>
                          </div>
                          <div className="mt-1 text-[10px] text-neutral-500">
                            Top line: {ctx.concentration.top_line_pct.toFixed(1)}% · Top 3: {ctx.concentration.top_3_pct.toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-medium text-neutral-500">Entry point</div>
                          <div className="mt-1">
                            {ctx.entry_point.decisive_move_annotated ? (
                              <span className="font-medium text-neutral-900">
                                {ctx.entry_point.decisive_move_annotated}
                                {typeof ctx.entry_point.decisive_move_pct === "number"
                                  ? ` (${ctx.entry_point.decisive_move_pct.toFixed(0)}%)`
                                  : ""}
                              </span>
                            ) : (
                              <span className="text-neutral-500">No clear commitment ≤ move 5.</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-medium text-neutral-500">Deviation habit</div>
                          <div className="mt-1">
                            <span className="font-medium text-neutral-900">{ctx.deviation_habit.label}</span>
                          </div>
                          <div className="mt-1 text-[10px] text-neutral-500">
                            {ctx.deviation_habit.early_deviation_rate == null
                              ? `Insufficient sample.`
                              : `Early deviation rate: ${(ctx.deviation_habit.early_deviation_rate * 100).toFixed(0)}% (n=${ctx.deviation_habit.measured_over_games})`}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold text-neutral-700">Structure profile</div>
                  <div className="mt-2 grid gap-2 text-xs text-neutral-700 md:grid-cols-3">
                    <div>
                      <div className="text-[10px] font-medium text-neutral-500">Castling</div>
                      <div className="mt-1 font-medium text-neutral-900">{v3Addon.structure_profile.castling_side_label}</div>
                      <div className="mt-1 text-[10px] text-neutral-500">
                        O-O: {v3Addon.structure_profile.castling.kingside} · O-O-O: {v3Addon.structure_profile.castling.queenside} · None: {v3Addon.structure_profile.castling.none}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-neutral-500">Queen trades by move 20</div>
                      <div className="mt-1 font-medium text-neutral-900">{v3Addon.structure_profile.early_queen_trades_label}</div>
                      <div className="mt-1 text-[10px] text-neutral-500">Rate: {v3Addon.structure_profile.queen_trade_by_20_pct.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-neutral-500">Opposite-side castling</div>
                      <div className="mt-1 font-medium text-neutral-900">{v3Addon.structure_profile.opposite_castling_label}</div>
                      <div className="mt-1 text-[10px] text-neutral-500">Rate: {v3Addon.structure_profile.opposite_castling_pct.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {availableSegments.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSegmentKey(k)}
                  className={
                    k === segmentKey
                      ? "h-8 rounded-xl border border-neutral-200 bg-neutral-900 px-3 text-[10px] font-semibold text-white shadow-sm"
                      : "h-8 rounded-xl border border-neutral-200 bg-white px-3 text-[10px] font-semibold text-neutral-900 shadow-sm hover:bg-neutral-50"
                  }
                >
                  {k === "all" ? "All" : k}
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <OpeningBarList
                title="As White"
                rows={segment.openings.as_white}
                sampleWarning={segment.openings.sample_warning}
                ctx={v3Addon?.contexts.as_white ?? null}
              />
              <OpeningBarList
                title="As Black vs 1.e4"
                rows={segment.openings.as_black_vs_e4}
                sampleWarning={segment.openings.sample_warning}
                ctx={v3Addon?.contexts.as_black_vs_e4 ?? null}
              />
              <OpeningBarList
                title="As Black vs 1.d4"
                rows={segment.openings.as_black_vs_d4}
                sampleWarning={segment.openings.sample_warning}
                ctx={v3Addon?.contexts.as_black_vs_d4 ?? null}
              />
            </div>


            <div className="grid gap-4 md:grid-cols-2">
              <BentoCard title="Defense Tree vs 1.e4">
                {(segment.repertoire.vs_e4.nodes as V2BranchNode[]).length === 0 ? (
                  <div className="text-xs text-neutral-500">No samples.</div>
                ) : (
                  <div className="text-xs text-neutral-700">
                    <RepertoireTree nodes={segment.repertoire.vs_e4.nodes as V2BranchNode[]} maxDepth={4} opponentLabel={username} />
                  </div>
                )}
              </BentoCard>
              <BentoCard title="Defense Tree vs 1.d4">
                {(segment.repertoire.vs_d4.nodes as V2BranchNode[]).length === 0 ? (
                  <div className="text-xs text-neutral-500">No samples.</div>
                ) : (
                  <div className="text-xs text-neutral-700">
                    <RepertoireTree nodes={segment.repertoire.vs_d4.nodes as V2BranchNode[]} maxDepth={4} opponentLabel={username} />
                  </div>
                )}
              </BentoCard>
            </div>
            <BentoCard
              title={"Style Markers"}
              headerRight={
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStyleMarkersHelpOpen(true)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-neutral-200 bg-white text-[10px] font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
                    aria-label="Style markers help"
                  >
                    ?
                  </button>
                  <button
                    type="button"
                    onClick={() => setStyleMarkersOpen((v) => !v)}
                    className="inline-flex h-8 items-center justify-center rounded-xl border border-neutral-200 bg-white px-3 text-[10px] font-semibold text-neutral-900 shadow-sm hover:bg-neutral-50"
                  >
                    {styleMarkersOpen ? "Hide" : "Show"}
                  </button>
                </div>
              }
            >
              {styleMarkersOpen ? (
                <div className="grid gap-4">
                  {/* Context Toggles: Category + Color */}
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Category Pills */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-neutral-500">Opening:</span>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => setStyleMarkerCategoryFilter(null)}
                          title="All openings: aggregate across every opening family in the dataset."
                          className={`inline-flex h-6 items-center justify-center rounded-lg px-2 text-[10px] font-medium transition-colors ${
                            styleMarkerCategoryFilter === null
                              ? "bg-blue-500 text-white shadow-sm"
                              : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                          }`}
                        >
                          All
                        </button>
                        {styleMarkerAvailableCategories.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setStyleMarkerCategoryFilter(cat)}
                            title={
                              cat === "Open"
                                ? "Open Games: 1.e4 e5 (symmetrical king-pawn). Often tactical and open lines."
                                : cat === "Semi-Open"
                                ? "Semi-Open Games: 1.e4 with Black replying NOT 1...e5 (e.g., Sicilian, French, Caro-Kann)."
                                : cat === "Closed"
                                ? "Closed Games: 1.d4 d5 (Queen's Pawn with ...d5). Often slower, structured play."
                                : cat === "Indian"
                                ? "Indian Defenses: 1.d4 with Black replying NOT 1...d5 (e.g., King's Indian, Nimzo, Grünfeld)."
                                : cat === "Flank"
                                ? "Flank Openings: 1.c4 or 1.Nf3 (English/Reti structures). Often flexible transpositions."
                                : "Opening category"
                            }
                            className={`inline-flex h-6 items-center justify-center rounded-lg px-2 text-[10px] font-medium transition-colors ${
                              styleMarkerCategoryFilter === cat
                                ? "bg-blue-500 text-white shadow-sm"
                                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Color Pills */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-neutral-500">Color:</span>
                      <div className="flex gap-1">
                        {(["overall", "white", "black"] as const).map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setStyleMarkerColorFilter(color)}
                            className={`inline-flex h-6 items-center justify-center rounded-lg px-2 text-[10px] font-medium transition-colors ${
                              styleMarkerColorFilter === color
                                ? "bg-yellow-500 text-white shadow-sm"
                                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                            }`}
                          >
                            {color === "overall" ? "Overall" : color === "white" ? "♔ White" : "♚ Black"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Current Context Label */}
                  {(styleMarkerCategoryFilter || styleMarkerColorFilter !== "overall") && (
                    <div className="text-[10px] text-neutral-500">
                      Showing: <span className="font-medium text-neutral-700">
                        {styleMarkerCategoryFilter ?? "All openings"} × {styleMarkerColorFilter === "overall" ? "Both colors" : styleMarkerColorFilter === "white" ? "White" : "Black"}
                      </span>
                      {queenData?.sampleSize != null && (
                        <span className="ml-1">({queenData.sampleSize} games)</span>
                      )}
                    </div>
                  )}

                  {/* Engine Grade Badge + Scout's Alert Badge */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Engine Grade Badge */}
                    {engineGrade && (
                      <div
                        title={`Engine Grade based on Average Centipawn Loss (ACPL: ${engineAcpl ?? "N/A"}). S: <30, A: 30-50, B: 50-80, C: >80. Based on ${analyzedGames} analyzed games.`}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 border ${
                          engineGrade === "S"
                            ? "bg-purple-100 border-purple-300 text-purple-800"
                            : engineGrade === "A"
                            ? "bg-green-100 border-green-300 text-green-800"
                            : engineGrade === "B"
                            ? "bg-yellow-100 border-yellow-300 text-yellow-800"
                            : "bg-red-100 border-red-300 text-red-800"
                        }`}
                      >
                        <span className="text-xs font-bold">{engineGrade}</span>
                        <span className="text-[10px] font-medium">
                          Engine Grade
                          {engineAcpl != null && <span className="ml-1 opacity-75">({engineAcpl} ACPL)</span>}
                        </span>
                      </div>
                    )}
                    {/* Scout's Alert Badges */}
                    {styleMarkerAlerts.map((alert: { type: string; message: string }, idx: number) => (
                      <div
                        key={idx}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1"
                      >
                        <span className="text-amber-600 text-xs">⚠️</span>
                        <span className="text-[10px] font-medium text-amber-800">{alert.message}</span>
                      </div>
                    ))}
                  </div>

                  {/* Style Archetype Badges */}
                  {(() => {
                    const archetypeMarkers = storedStyleMarkers.filter((m) => m.marker_key.startsWith("archetype_"));
                    const primaryArchetypes = archetypeMarkers.filter((m) => m.metrics_json?.isPrimary === true);
                    const secondaryArchetypes = archetypeMarkers.filter((m) => m.metrics_json?.isPrimary === false);
                    const tier = primaryArchetypes[0]?.metrics_json?.tier ?? "basic";
                    
                    if (archetypeMarkers.length === 0) return null;
                    
                    return (
                      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-semibold text-neutral-700">Playing Style</span>
                          <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-medium ${
                            tier === "advanced" 
                              ? "bg-purple-100 text-purple-700 border border-purple-200" 
                              : "bg-neutral-100 text-neutral-600 border border-neutral-200"
                          }`}>
                            {tier === "advanced" ? "⚡ Advanced" : "Basic"}
                          </span>
                        </div>
                        
                        {/* Primary Styles */}
                        {primaryArchetypes.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {primaryArchetypes.map((m) => (
                              <div
                                key={m.marker_key}
                                title={`${m.metrics_json?.description ?? ""}\n\nPreparation: ${m.tooltip}`}
                                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 border ${
                                  m.strength === "Strong"
                                    ? "bg-yellow-100 border-yellow-300 text-yellow-800"
                                    : m.strength === "Medium"
                                    ? "bg-amber-50 border-amber-200 text-amber-700"
                                    : "bg-neutral-100 border-neutral-200 text-neutral-700"
                                }`}
                              >
                                <span className="text-xs font-semibold">{m.label}</span>
                                {m.metrics_json?.confidence != null && (
                                  <span className="text-[9px] opacity-70">
                                    {Math.round(m.metrics_json.confidence * 100)}%
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {/* Secondary Styles */}
                        {secondaryArchetypes.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            <span className="text-[9px] text-neutral-500 mr-1">Also:</span>
                            {secondaryArchetypes.map((m) => (
                              <div
                                key={m.marker_key}
                                title={`${m.metrics_json?.description ?? ""}\n\nPreparation: ${m.tooltip}`}
                                className="inline-flex items-center gap-1 rounded-md bg-neutral-100 border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600"
                              >
                                {m.label}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="grid gap-3">
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
                </div>
              ) : null}
            </BentoCard>


            <div className="grid gap-4 md:grid-cols-2">
              <BentoCard title="Castling Preference">
                <SegmentedBar
                  segments={[
                    { label: "Kingside", value: segment.style.castling.kingside },
                    { label: "Queenside", value: segment.style.castling.queenside },
                    { label: "None", value: segment.style.castling.none },
                  ]}
                  total={segment.style.castling.kingside + segment.style.castling.queenside + segment.style.castling.none}
                  accentHex={accent}
                />
                <div className="mt-2 text-[10px] text-neutral-600">
                  Avg castle move: <span className="font-medium text-neutral-900">{segment.style.castling.avg_castle_move ?? "—"}</span>
                </div>
              </BentoCard>
              <BentoCard title="Queen Trade Tendency">
                <SegmentedBar
                  segments={[
                    { label: "Early", value: segment.style.queen_trade_by_20.traded },
                    { label: "Middle", value: 0 },
                    { label: "Avoids", value: segment.style.queen_trade_by_20.not_traded },
                  ]}
                  total={segment.style.queen_trade_by_20.traded + segment.style.queen_trade_by_20.not_traded}
                  accentHex={accent}
                />
                <div className="mt-2 text-[10px] text-neutral-600">
                  Traded by move 20: <span className="font-medium text-neutral-900">{segment.style.queen_trade_by_20.pct.toFixed(0)}%</span>
                  <span className="ml-2 text-neutral-500">
                    ({segment.style.queen_trade_by_20.traded} traded · {segment.style.queen_trade_by_20.not_traded} not traded)
                  </span>
                </div>
              </BentoCard>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <BentoCard title="Pawn Storms after Castling">
                <SegmentedBar
                  segments={[
                    { label: "After O-O", value: Math.round(segment.style.pawn_storm_after_castle.kingside_pct * 100) },
                    { label: "After O-O-O", value: Math.round(segment.style.pawn_storm_after_castle.queenside_pct * 100) },
                    { label: "Other", value: 0 },
                  ]}
                  total={100}
                  accentHex={accent}
                />
                <div className="mt-2 text-[10px] text-neutral-600">
                  Kingside: <span className="font-medium text-neutral-900">{(segment.style.pawn_storm_after_castle.kingside_pct * 100).toFixed(0)}%</span> ·
                  Queenside: <span className="font-medium text-neutral-900">{(segment.style.pawn_storm_after_castle.queenside_pct * 100).toFixed(0)}%</span>
                </div>
              </BentoCard>
              <BentoCard title="Aggression">
                <div className="grid gap-1 text-xs text-neutral-700">
                  <div>
                    <span className="font-medium text-neutral-900">Pawns advanced by move 10:</span> {segment.style.aggression.avg_pawns_advanced_by_10.toFixed(1)}
                  </div>
                  <div>
                    <span className="font-medium text-neutral-900">Captures by move 15:</span> {segment.style.aggression.avg_captures_by_15.toFixed(1)}
                  </div>
                  <div>
                    <span className="font-medium text-neutral-900">Checks by move 15:</span> {segment.style.aggression.avg_checks_by_15.toFixed(1)}
                  </div>
                </div>
              </BentoCard>
            </div>


            <div className="grid gap-4 md:grid-cols-2">
              <BentoCard title="Results">
                <div className="text-xs text-neutral-700">
                  <span className="font-medium text-neutral-900">W / D / L:</span> {segment.results.overall.win} / {segment.results.overall.draw} / {segment.results.overall.loss} ({segment.results.overall.total})
                </div>
              </BentoCard>
              <BentoCard title="Results by Color">
                <div className="grid gap-1 text-xs text-neutral-700">
                  <div>
                    <span className="font-medium text-neutral-900">As White:</span> {segment.results.by_color.as_white.win} / {segment.results.by_color.as_white.draw} / {segment.results.by_color.as_white.loss} ({segment.results.by_color.as_white.total})
                  </div>
                  <div>
                    <span className="font-medium text-neutral-900">As Black:</span> {segment.results.by_color.as_black.win} / {segment.results.by_color.as_black.draw} / {segment.results.by_color.as_black.loss} ({segment.results.by_color.as_black.total})
                  </div>
                </div>
              </BentoCard>
            </div>


            <BentoCard title="Summary">
              <div className="grid gap-1 text-xs text-neutral-700">
                <div>
                  <span className="font-medium text-neutral-900">Games analyzed:</span> {v2Profile.games_analyzed}
                </div>
                {v2Profile.date_range_start || v2Profile.date_range_end ? (
                  <div>
                    <span className="font-medium text-neutral-900">Date range:</span>{" "}
                    {v2Profile.date_range_start ? formatDateTime(v2Profile.date_range_start) : "…"} →{" "}
                    {v2Profile.date_range_end ? formatDateTime(v2Profile.date_range_end) : "…"}
                  </div>
                ) : null}
                <div>
                  <span className="font-medium text-neutral-900">Filters:</span> {currentFiltersSummary}
                </div>
              </div>
              {v2Profile.message ? <div className="mt-3 text-xs text-neutral-600">{v2Profile.message}</div> : null}
            </BentoCard>
          </div>
        ) : stats ? (
          <div className="grid gap-4">
            <div className="grid gap-1 text-xs text-neutral-700">
              <div>
                <span className="font-medium text-neutral-900">Last generated:</span>{" "}
                {stats.generated_at ? formatDateTime(stats.generated_at) : ""}
              </div>
              <div>
                <span className="font-medium text-neutral-900">Games analyzed:</span> {stats.games_analyzed}
              </div>
              {stats.dataset?.date_min || stats.dataset?.date_max ? (
                <div>
                  <span className="font-medium text-neutral-900">Date range used:</span>{" "}
                  {stats.dataset?.date_min ? formatDateTime(stats.dataset.date_min) : "…"} →{" "}
                  {stats.dataset?.date_max ? formatDateTime(stats.dataset.date_max) : "…"}
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <BentoCard title="Dataset Summary">
                <div className="grid gap-1 text-xs text-neutral-700">
                  <div>
                    <span className="font-medium text-neutral-900">As White:</span> {stats.dataset?.colors?.white ?? 0}
                  </div>
                  <div>
                    <span className="font-medium text-neutral-900">As Black:</span> {stats.dataset?.colors?.black ?? 0}
                  </div>
                  <div className="mt-1">
                    <span className="font-medium text-neutral-900">Time controls:</span>
                    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                      {Object.entries(stats.dataset?.time_controls ?? {}).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="text-neutral-600">{k}</span>
                          <span className="font-medium text-neutral-900">{v as any}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </BentoCard>

              <BentoCard title="Results">
                <div className="grid gap-1 text-xs text-neutral-700">
                  <div>
                    <span className="font-medium text-neutral-900">W / D / L:</span> {stats.results.win} / {stats.results.draw} / {stats.results.loss}
                  </div>
                  {stats.results.by_speed ? (
                    <div className="mt-2 grid gap-1">
                      <div className="text-[10px] font-medium text-neutral-500">By time control (min sample)</div>
                      {Object.entries(stats.results.by_speed).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="text-neutral-600">{k}</span>
                          <span className="font-medium text-neutral-900">
                            {(v as any).win}/{(v as any).draw}/{(v as any).loss} ({(v as any).total})
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </BentoCard>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                { title: "Opponent as White (1st move)", snap: stats.openings.as_white_first_move },
                { title: "Opponent as Black vs 1.e4", snap: stats.openings.as_black_vs_e4 },
                { title: "Opponent as Black vs 1.d4", snap: stats.openings.as_black_vs_d4 },
              ].map(({ title, snap }) => (
                <BentoCard key={title} title={title}>
                  <div className="grid gap-2">
                    {snap.total === 0 ? (
                      <div className="text-xs text-neutral-500">No samples.</div>
                    ) : (
                      <>
                        {filterPctAtLeastOne(snap.top).map((m) => (
                          <div key={m.move} className="flex items-center justify-between gap-3">
                            <span className="text-xs font-medium text-neutral-900">{m.move}</span>
                            <span className="text-xs text-neutral-700">{m.pct.toFixed(0)}%</span>
                          </div>
                        ))}
                        <div className="text-[10px] text-neutral-500">Top-choice concentration: {snap.concentration_pct.toFixed(0)}%</div>
                      </>
                    )}
                  </div>
                </BentoCard>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <BentoCard title="Castling Preference">
                <SegmentedBar
                  segments={[
                    { label: "Kingside", value: stats.tendencies.castling.kingside },
                    { label: "Queenside", value: stats.tendencies.castling.queenside },
                    { label: "None", value: stats.tendencies.castling.none },
                  ]}
                  total={stats.tendencies.castling.kingside + stats.tendencies.castling.queenside + stats.tendencies.castling.none}
                  accentHex={accent}
                />
                <div className="mt-2 text-[10px] text-neutral-600">
                  Avg castle move: <span className="font-medium text-neutral-900">{stats.tendencies.castling.avg_castle_move ?? "—"}</span>
                </div>
              </BentoCard>

              <BentoCard title="Queen Trade Tendency">
                <SegmentedBar
                  segments={[
                    { label: "Early", value: stats.tendencies.early_queen_trade_by_20.traded },
                    { label: "Middle", value: 0 },
                    { label: "Avoids", value: stats.tendencies.early_queen_trade_by_20.not_traded },
                  ]}
                  total={stats.tendencies.early_queen_trade_by_20.traded + stats.tendencies.early_queen_trade_by_20.not_traded}
                  accentHex={accent}
                />
                <div className="mt-2 text-[10px] text-neutral-600">
                  Traded by move 20: <span className="font-medium text-neutral-900">{stats.tendencies.early_queen_trade_by_20.pct.toFixed(0)}%</span>
                  <span className="ml-2 text-neutral-500">
                    ({stats.tendencies.early_queen_trade_by_20.traded} traded · {stats.tendencies.early_queen_trade_by_20.not_traded} not traded)
                  </span>
                </div>
              </BentoCard>
            </div>

            <BentoCard title="Summary">
              <div className="grid gap-1 text-xs text-neutral-700">
                <div>
                  <span className="font-medium text-neutral-900">Games analyzed:</span> {stats.games_analyzed}
                </div>
                {stats.dataset?.date_min || stats.dataset?.date_max ? (
                  <div>
                    <span className="font-medium text-neutral-900">Date range:</span>{" "}
                    {stats.dataset?.date_min ? formatDateTime(stats.dataset.date_min) : "…"} →{" "}
                    {stats.dataset?.date_max ? formatDateTime(stats.dataset.date_max) : "…"}
                  </div>
                ) : null}
              </div>
              {stats.message ? <div className="mt-3 text-xs text-neutral-600">{stats.message}</div> : null}
            </BentoCard>
          </div>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700 shadow-sm">
            No scout report generated yet.
          </div>
        )}
            </BentoCard>
          </div>
        </div>

        {filtersOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
            <div className="w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-neutral-900">{hasProfile ? "Regenerate Report" : "Generate Report"}</div>
                  <div className="mt-1 text-[10px] text-neutral-500">Select filters, then run generation.</div>
                </div>
                <button
                  type="button"
                  onClick={onCloseFilters}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-neutral-200 px-3 text-xs font-semibold text-neutral-900 shadow-sm"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid gap-3">
                <OpponentFiltersPanel
                  headerLeft={undefined}
                  speeds={speeds}
                  setSpeeds={setSpeeds}
                  rated={rated}
                  setRated={setRated}
                  datePreset={datePreset}
                  setDatePreset={setDatePreset}
                  fromDate={fromDate}
                  setFromDate={setFromDate}
                  toDate={toDate}
                  setToDate={setToDate}
                  generateStyleMarkers={generateStyleMarkers}
                  setGenerateStyleMarkers={setGenerateStyleMarkers}
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-neutral-600">Filters selected: {currentFiltersSummary}</div>
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-xs font-semibold text-neutral-950 shadow-sm disabled:opacity-60"
                    style={{ backgroundColor: accent }}
                    onClick={() => {
                      void runGenerate();
                    }}
                    disabled={generateBusy || needsMigration}
                  >
                    {generateBusy ? "Generating…" : hasProfile ? "Regenerate" : "Generate"}
                  </button>
                </div>

                {actionMessage ? <div className="whitespace-pre-wrap break-words text-xs text-neutral-700">{actionMessage}</div> : null}
              </div>
            </div>
          </div>
        ) : null}

        {confirmOpen ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-neutral-200 p-4 shadow-2xl">
              <div className="text-sm font-semibold text-neutral-900">Regenerate report?</div>
              <div className="mt-2 text-xs leading-5 text-neutral-700">This will replace the existing report for this opponent.</div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-neutral-200 px-3 text-xs font-semibold text-neutral-900 shadow-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmRegenerate}
                  className="inline-flex h-9 items-center justify-center rounded-xl px-4 text-xs font-semibold text-neutral-950 shadow-sm"
                  style={{ backgroundColor: accent }}
                >
                  Regenerate
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <GenerationProgressModal
          isOpen={progressModalOpen}
          onCancel={handleCancelGeneration}
          onDismiss={handleDismissProgressModal}
          status={progressStatus}
          errorMessage={progressError}
          currentStepOverride={progressStep}
        />
      </div>
    </div>
  );
}
