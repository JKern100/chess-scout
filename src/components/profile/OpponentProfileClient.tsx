"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OpponentFiltersPanel } from "@/components/chess/OpponentFiltersPanel";
import { useOpponentFilters } from "@/components/chess/useOpponentFilters";

type ChessPlatform = "lichess" | "chesscom";

type Props = {
  platform: ChessPlatform;
  username: string;
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
  filters_json: any | null;
  profile_version?: number | null;
  profile_json?: OpponentProfileV2 | null;
  stats_json: OpponentProfileV1 | null;
  games_analyzed: number | null;
  generated_at: string | null;
  date_range_start?: string | null;
  date_range_end?: string | null;
  source_game_ids_hash?: string | null;
};

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

export function OpponentProfileClient({ platform, username }: Props) {
  const { speeds, setSpeeds, rated, setRated, datePreset, setDatePreset, fromDate, setFromDate, toDate, setToDate } = useOpponentFilters();

  const [profileRow, setProfileRow] = useState<OpponentProfileRow | null>(null);
  const [loadBusy, setLoadBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [generateBusy, setGenerateBusy] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoadBusy(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/opponents/${encodeURIComponent(platform)}/${encodeURIComponent(username)}/profile`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((json as any)?.error ?? "Failed to load profile"));
      setNeedsMigration(Boolean((json as any)?.needs_migration));
      setProfileRow(((json as any)?.opponent_profile as OpponentProfileRow | null) ?? null);
    } catch (e) {
      setProfileRow(null);
      setNeedsMigration(false);
      setLoadError(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setLoadBusy(false);
    }
  }, [platform, username]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

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

  const runGenerate = useCallback(async () => {
    if (generateBusy) return;
    setGenerateBusy(true);
    setActionMessage(null);
    try {
      const res = await fetch(
        `/api/opponents/${encodeURIComponent(platform)}/${encodeURIComponent(username)}/profile/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ speeds, rated, from: fromDate || null, to: toDate || null }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const needs = Boolean((json as any)?.needs_migration);
        setNeedsMigration(needs);
        throw new Error(String((json as any)?.error ?? "Failed to generate profile"));
      }
      setNeedsMigration(Boolean((json as any)?.needs_migration));
      setProfileRow(((json as any)?.opponent_profile as OpponentProfileRow | null) ?? null);

      const msgV1 = (json as any)?.opponent_profile?.stats_json?.message;
      const msgV2 = (json as any)?.opponent_profile?.profile_json?.message;
      const msgV3 = (json as any)?.opponent_profile?.profile_json?.v3?.message;
      const msg = typeof msgV3 === "string" && msgV3.trim() ? msgV3 : typeof msgV2 === "string" && msgV2.trim() ? msgV2 : msgV1;
      if (typeof msg === "string" && msg.trim()) setActionMessage(msg);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Failed to generate profile");
    } finally {
      setGenerateBusy(false);
    }
  }, [fromDate, generateBusy, platform, rated, speeds, toDate, username]);

  const onClickPrimary = useCallback(() => {
    if (generateBusy) return;
    setActionMessage(null);
    if (needsMigration) {
      setActionMessage("Opponent profile schema is missing v2 columns. Run scripts/supabase_opponent_profiles.sql in Supabase SQL editor.");
      return;
    }
    if (!hasProfile) {
      void runGenerate();
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

  const kpiRating = "—";

  const onOpenFilters = useCallback(() => {
    if (generateBusy) return;
    setFiltersOpen(true);
  }, [generateBusy]);

  const onCloseFilters = useCallback(() => {
    setFiltersOpen(false);
  }, []);

  const accent = "#EAB308";

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

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-6 text-neutral-900 md:px-6">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <div className="text-[10px] font-medium text-neutral-500">Opponent Profile</div>
            <div className="text-xl font-semibold tracking-tight text-neutral-900 md:text-2xl">
              {username}
            </div>
            <div className="text-xs text-neutral-600">{formatPlatformLabel(platform)}</div>
          </div>

          <button
            type="button"
            onClick={onOpenFilters}
            disabled={generateBusy}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-900 shadow-sm hover:bg-neutral-50 disabled:opacity-60"
          >
            {hasProfile ? "Regenerate Profile" : "Generate Profile"}
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-12">
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
          </div>

          <div className="md:col-span-2">
            <KpiCard label="Total Games" value={kpiTotalGames} />
          </div>
          <div className="md:col-span-2">
            <KpiCard label="Top Time Control" value={kpiTopTimeControl} />
          </div>
          <div className="md:col-span-2">
            <KpiCard label="Rating" value={kpiRating} />
          </div>

          <div className="md:col-span-12">
            <BentoCard title="Current Profile">
        {loadBusy ? (
          <div className="text-sm text-neutral-700">Loading…</div>
        ) : loadError ? (
          <div className="text-sm text-neutral-700">{loadError}</div>
        ) : needsMigration ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700 shadow-sm">
            Opponent profile schema is missing v1 columns. Run <span className="font-medium text-neutral-900">scripts/supabase_opponent_profiles.sql</span> in Supabase SQL editor.
          </div>
        ) : hasV2 && v2Profile && segment ? (
          <div className="grid gap-4">
            <div className="grid gap-1 text-xs text-neutral-700">
              <div>
                <span className="font-medium text-neutral-900">Profile version:</span> v2
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

            {hasV3 && v3Addon ? (
              <div className="grid gap-3">
                <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold text-neutral-700">Prep insights</div>
                  <div className="mt-2 text-sm text-neutral-900">{v3Addon.prep_summary}</div>
                  {v3Addon.message ? <div className="mt-2 text-xs text-neutral-600">{v3Addon.message}</div> : null}
                </div>

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
            No opponent profile generated yet.
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
                  <div className="text-sm font-semibold text-neutral-900">{hasProfile ? "Regenerate Profile" : "Generate Profile"}</div>
                  <div className="mt-1 text-[10px] text-neutral-500">Select filters, then run generation.</div>
                </div>
                <button
                  type="button"
                  onClick={onCloseFilters}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-900 shadow-sm hover:bg-neutral-50"
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
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-neutral-600">Filters selected: {currentFiltersSummary}</div>
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-xs font-semibold text-neutral-950 shadow-sm disabled:opacity-60"
                    style={{ backgroundColor: accent }}
                    onClick={onClickPrimary}
                    disabled={generateBusy || needsMigration}
                  >
                    {generateBusy ? "Generating…" : hasProfile ? "Regenerate" : "Generate"}
                  </button>
                </div>

                {actionMessage ? <div className="text-xs text-neutral-700">{actionMessage}</div> : null}
              </div>
            </div>
          </div>
        ) : null}

        {confirmOpen ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl">
              <div className="text-sm font-semibold text-neutral-900">Regenerate profile?</div>
              <div className="mt-2 text-xs leading-5 text-neutral-700">This will replace the existing profile for this opponent.</div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-900 shadow-sm hover:bg-neutral-50"
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
      </div>
    </div>
  );
}
