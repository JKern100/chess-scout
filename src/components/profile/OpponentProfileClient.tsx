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
  message?: string;
};

type V2SegmentProfile = OpponentProfileV2["segments"][string];

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

export function OpponentProfileClient({ platform, username }: Props) {
  const { speeds, setSpeeds, rated, setRated, fromDate, setFromDate, toDate, setToDate } = useOpponentFilters();

  const [profileRow, setProfileRow] = useState<OpponentProfileRow | null>(null);
  const [loadBusy, setLoadBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
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

      const msg = (json as any)?.opponent_profile?.stats_json?.message;
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

  return (
    <div className="grid gap-6">
      <div>
        <div className="text-xs font-medium text-zinc-600">Opponent Profile</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          Opponent Profile for {username} ({formatPlatformLabel(platform)})
        </h1>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-lg font-medium text-zinc-900">Current Profile</div>
        {loadBusy ? (
          <div className="mt-3 text-sm text-zinc-600">Loading…</div>
        ) : loadError ? (
          <div className="mt-3 text-sm text-zinc-600">{loadError}</div>
        ) : needsMigration ? (
          <div className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
            Opponent profile schema is missing v1 columns. Run <span className="font-medium text-zinc-900">scripts/supabase_opponent_profiles.sql</span> in Supabase SQL editor.
          </div>
        ) : hasV2 && v2Profile && segment ? (
          <div className="mt-4 grid gap-4">
            <div className="grid gap-1 text-sm text-zinc-700">
              <div>
                <span className="font-medium text-zinc-900">Profile version:</span> v2
              </div>
              <div>
                <span className="font-medium text-zinc-900">Last generated:</span> {formatDateTime(v2Profile.generated_at)}
              </div>
              <div>
                <span className="font-medium text-zinc-900">Games analyzed:</span> {v2Profile.games_analyzed}
              </div>
              {v2Profile.date_range_start || v2Profile.date_range_end ? (
                <div>
                  <span className="font-medium text-zinc-900">Date range used:</span>{" "}
                  {v2Profile.date_range_start ? formatDateTime(v2Profile.date_range_start) : "…"} →{" "}
                  {v2Profile.date_range_end ? formatDateTime(v2Profile.date_range_end) : "…"}
                </div>
              ) : null}
              <div>
                <span className="font-medium text-zinc-900">Filters used:</span> {currentFiltersSummary}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {availableSegments.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSegmentKey(k)}
                  className={
                    k === segmentKey
                      ? "h-8 rounded-xl bg-zinc-900 px-3 text-[10px] font-medium text-white"
                      : "h-8 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-medium text-zinc-900 hover:bg-zinc-50"
                  }
                >
                  {k === "all" ? "All" : k}
                </button>
              ))}
            </div>

            <div className="grid gap-3">
              <button
                type="button"
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-left"
                onClick={() => setOpeningsOpen((v) => !v)}
              >
                <div className="text-xs font-semibold text-zinc-700">Openings</div>
                <div className="text-[10px] text-zinc-600">{openingsOpen ? "Hide" : "Show"}</div>
              </button>
              {openingsOpen ? (
                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    { title: "Top openings as White", rows: segment.openings.as_white },
                    { title: "Top defenses vs 1.e4", rows: segment.openings.as_black_vs_e4 },
                    { title: "Top defenses vs 1.d4", rows: segment.openings.as_black_vs_d4 },
                  ].map(({ title, rows }) => (
                    <div key={title} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                      <div className="text-xs font-semibold text-zinc-700">{title}</div>
                      {segment.openings.sample_warning ? (
                        <div className="mt-1 text-[10px] text-zinc-600">{segment.openings.sample_warning}</div>
                      ) : null}
                      <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                        {filterPctAtLeastOne(rows).length === 0 ? (
                          <div className="text-zinc-600">No samples.</div>
                        ) : (
                          filterPctAtLeastOne(rows).map((r) => (
                            <div key={`${r.eco ?? ""}|${r.name}`} className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate font-medium text-zinc-900">{r.name}</div>
                                {r.eco ? <div className="text-[10px] text-zinc-600">{r.eco}</div> : null}
                              </div>
                              <div className="text-right">
                                <div className="font-medium text-zinc-900">{r.pct.toFixed(0)}%</div>
                                <div className="text-[10px] text-zinc-600">{r.games}</div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-left"
                onClick={() => setRepertoireOpen((v) => !v)}
              >
                <div className="text-xs font-semibold text-zinc-700">Repertoire branches</div>
                <div className="text-[10px] text-zinc-600">{repertoireOpen ? "Hide" : "Show"}</div>
              </button>
              {repertoireOpen ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    { title: "Vs 1.e4", nodes: segment.repertoire.vs_e4.nodes as V2BranchNode[] },
                    { title: "Vs 1.d4", nodes: segment.repertoire.vs_d4.nodes as V2BranchNode[] },
                  ].map(({ title, nodes }) => (
                    <div key={title} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                      <div className="text-xs font-semibold text-zinc-700">{title}</div>
                      <div className="mt-2 grid gap-2 text-xs text-zinc-700">
                        {nodes.length === 0 ? (
                          <div className="text-zinc-600">No samples.</div>
                        ) : (
                          nodes.slice(0, 6).map((n) => (
                            <div key={`${title}-${n.ply}-${n.prefix.join(" ")}`}>
                              <div className="text-[10px] text-zinc-600">After {n.prefix.join(" ") || "(start)"}</div>
                              <div className="mt-1 grid gap-1">
                                {filterPctAtLeastOne(n.next).map((m) => (
                                  <div key={m.move} className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-zinc-900">{m.move}</span>
                                    <span className="text-zinc-600">{m.pct.toFixed(0)}% ({m.games})</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-left"
                onClick={() => setStyleOpen((v) => !v)}
              >
                <div className="text-xs font-semibold text-zinc-700">Style signals</div>
                <div className="text-[10px] text-zinc-600">{styleOpen ? "Hide" : "Show"}</div>
              </button>
              {styleOpen ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-xs font-semibold text-zinc-700">Castling</div>
                    <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                      <div>
                        <span className="font-medium text-zinc-900">Kingside:</span> {segment.style.castling.kingside}
                      </div>
                      <div>
                        <span className="font-medium text-zinc-900">Queenside:</span> {segment.style.castling.queenside}
                      </div>
                      <div>
                        <span className="font-medium text-zinc-900">None:</span> {segment.style.castling.none}
                      </div>
                      <div>
                        <span className="font-medium text-zinc-900">Avg castle move:</span> {segment.style.castling.avg_castle_move ?? "—"}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-xs font-semibold text-zinc-700">Queen trades (by move 20)</div>
                    <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                      <div>
                        <span className="font-medium text-zinc-900">Rate:</span> {segment.style.queen_trade_by_20.pct.toFixed(0)}%
                      </div>
                      <div>
                        <span className="font-medium text-zinc-900">Traded:</span> {segment.style.queen_trade_by_20.traded}
                      </div>
                      <div>
                        <span className="font-medium text-zinc-900">Not traded:</span> {segment.style.queen_trade_by_20.not_traded}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-xs font-semibold text-zinc-700">Pawn storms after castling</div>
                    <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                      <div>
                        <span className="font-medium text-zinc-900">After O-O:</span> {segment.style.pawn_storm_after_castle.kingside_pct.toFixed(0)}%
                      </div>
                      <div>
                        <span className="font-medium text-zinc-900">After O-O-O:</span> {segment.style.pawn_storm_after_castle.queenside_pct.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-xs font-semibold text-zinc-700">Aggression</div>
                    <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                      <div>
                        <span className="font-medium text-zinc-900">Pawns advanced by move 10:</span>{" "}
                        {segment.style.aggression.avg_pawns_advanced_by_10}
                      </div>
                      <div>
                        <span className="font-medium text-zinc-900">Captures by move 15:</span> {segment.style.aggression.avg_captures_by_15}
                      </div>
                      <div>
                        <span className="font-medium text-zinc-900">Checks by move 15:</span> {segment.style.aggression.avg_checks_by_15}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-left"
                onClick={() => setResultsOpen((v) => !v)}
              >
                <div className="text-xs font-semibold text-zinc-700">Results</div>
                <div className="text-[10px] text-zinc-600">{resultsOpen ? "Hide" : "Show"}</div>
              </button>
              {resultsOpen ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-xs font-semibold text-zinc-700">Overall</div>
                    <div className="mt-2 text-xs text-zinc-700">
                      <span className="font-medium text-zinc-900">W / D / L:</span> {segment.results.overall.win} / {segment.results.overall.draw} / {segment.results.overall.loss} ({segment.results.overall.total})
                    </div>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-xs font-semibold text-zinc-700">By color</div>
                    <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                      <div>
                        <span className="font-medium text-zinc-900">As White:</span> {segment.results.by_color.as_white.win} / {segment.results.by_color.as_white.draw} / {segment.results.by_color.as_white.loss} ({segment.results.by_color.as_white.total})
                      </div>
                      <div>
                        <span className="font-medium text-zinc-900">As Black:</span> {segment.results.by_color.as_black.win} / {segment.results.by_color.as_black.draw} / {segment.results.by_color.as_black.loss} ({segment.results.by_color.as_black.total})
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-left"
                onClick={() => setDatasetOpen((v) => !v)}
              >
                <div className="text-xs font-semibold text-zinc-700">Raw dataset summary</div>
                <div className="text-[10px] text-zinc-600">{datasetOpen ? "Hide" : "Show"}</div>
              </button>
              {datasetOpen ? (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-xs font-semibold text-zinc-700">Dataset</div>
                  <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                    <div>
                      <span className="font-medium text-zinc-900">As White:</span> {segment.dataset.colors.white}
                    </div>
                    <div>
                      <span className="font-medium text-zinc-900">As Black:</span> {segment.dataset.colors.black}
                    </div>
                    <div>
                      <span className="font-medium text-zinc-900">Dominant speed:</span> {segment.dataset.dominant_speed ?? "—"}
                    </div>
                    <div className="mt-1">
                      <span className="font-medium text-zinc-900">Time controls:</span>
                      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                        {Object.entries(segment.dataset.speeds ?? {}).map(([k, v]: any) => (
                          <div key={k} className="flex items-center justify-between gap-2">
                            <span className="text-zinc-600">{k}</span>
                            <span className="font-medium text-zinc-900">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {v2Profile.message ? <div className="text-xs text-zinc-600">{v2Profile.message}</div> : null}
          </div>
        ) : stats ? (
          <div className="mt-4 grid gap-4">
            <div className="grid gap-1 text-sm text-zinc-700">
              <div>
                <span className="font-medium text-zinc-900">Last generated:</span>{" "}
                {stats.generated_at ? formatDateTime(stats.generated_at) : ""}
              </div>
              <div>
                <span className="font-medium text-zinc-900">Games analyzed:</span> {stats.games_analyzed}
              </div>
              {stats.dataset?.date_min || stats.dataset?.date_max ? (
                <div>
                  <span className="font-medium text-zinc-900">Date range used:</span>{" "}
                  {stats.dataset?.date_min ? formatDateTime(stats.dataset.date_min) : "…"} →{" "}
                  {stats.dataset?.date_max ? formatDateTime(stats.dataset.date_max) : "…"}
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-xs font-semibold text-zinc-700">Dataset Summary</div>
                <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                  <div>
                    <span className="font-medium text-zinc-900">As White:</span> {stats.dataset?.colors?.white ?? 0}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">As Black:</span> {stats.dataset?.colors?.black ?? 0}
                  </div>
                  <div className="mt-1">
                    <span className="font-medium text-zinc-900">Time controls:</span>
                    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                      {Object.entries(stats.dataset?.time_controls ?? {}).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="text-zinc-600">{k}</span>
                          <span className="font-medium text-zinc-900">{v as any}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-xs font-semibold text-zinc-700">Results</div>
                <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                  <div>
                    <span className="font-medium text-zinc-900">W / D / L:</span> {stats.results.win} / {stats.results.draw} / {stats.results.loss}
                  </div>
                  {stats.results.by_speed ? (
                    <div className="mt-2 grid gap-1">
                      <div className="text-[10px] font-medium text-zinc-600">By time control (min sample)</div>
                      {Object.entries(stats.results.by_speed).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="text-zinc-600">{k}</span>
                          <span className="font-medium text-zinc-900">
                            {(v as any).win}/{(v as any).draw}/{(v as any).loss} ({(v as any).total})
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {[
                { title: "Opponent as White (1st move)", snap: stats.openings.as_white_first_move },
                { title: "Opponent as Black vs 1.e4", snap: stats.openings.as_black_vs_e4 },
                { title: "Opponent as Black vs 1.d4", snap: stats.openings.as_black_vs_d4 },
              ].map(({ title, snap }) => (
                <div key={title} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-xs font-semibold text-zinc-700">{title}</div>
                  <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                    {snap.total === 0 ? (
                      <div className="text-zinc-600">No samples.</div>
                    ) : (
                      <>
                        {filterPctAtLeastOne(snap.top).map((m) => (
                          <div key={m.move} className="flex items-center justify-between gap-2">
                            <span className="font-medium text-zinc-900">{m.move}</span>
                            <span className="text-zinc-600">{m.pct.toFixed(0)}%</span>
                          </div>
                        ))}
                        <div className="mt-2 text-[10px] text-zinc-600">
                          Top-choice concentration: {snap.concentration_pct.toFixed(0)}%
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-xs font-semibold text-zinc-700">Castling tendency</div>
                <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                  <div>
                    <span className="font-medium text-zinc-900">Kingside:</span> {stats.tendencies.castling.kingside}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">Queenside:</span> {stats.tendencies.castling.queenside}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">No castling:</span> {stats.tendencies.castling.none}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">Avg castle move:</span>{" "}
                    {stats.tendencies.castling.avg_castle_move ?? "—"}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-xs font-semibold text-zinc-700">Early queen trades (by move 20)</div>
                <div className="mt-2 grid gap-1 text-xs text-zinc-700">
                  <div>
                    <span className="font-medium text-zinc-900">Traded:</span> {stats.tendencies.early_queen_trade_by_20.traded}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">Not traded:</span> {stats.tendencies.early_queen_trade_by_20.not_traded}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">Rate:</span> {stats.tendencies.early_queen_trade_by_20.pct.toFixed(0)}%
                  </div>
                </div>
              </div>
            </div>

            {stats.message ? <div className="text-xs text-zinc-600">{stats.message}</div> : null}
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
            No opponent profile generated yet.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-lg font-medium text-zinc-900">Generate / Regenerate Profile</div>
        <div className="mt-4 grid gap-3">
          <OpponentFiltersPanel
            headerLeft={undefined}
            speeds={speeds}
            setSpeeds={setSpeeds}
            rated={rated}
            setRated={setRated}
            fromDate={fromDate}
            setFromDate={setFromDate}
            toDate={toDate}
            setToDate={setToDate}
          />

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-zinc-600">Filters selected: {currentFiltersSummary}</div>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              onClick={onClickPrimary}
              disabled={generateBusy || needsMigration}
            >
              {generateBusy ? "Generating…" : hasProfile ? "Regenerate Profile" : "Generate Profile"}
            </button>
          </div>

          {actionMessage ? <div className="text-xs text-zinc-600">{actionMessage}</div> : null}
        </div>
      </section>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg">
            <div className="text-sm font-medium text-zinc-900">Regenerate profile?</div>
            <div className="mt-2 text-xs leading-5 text-zinc-700">
              This will replace the existing profile for this opponent.
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRegenerate}
                className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-4 text-xs font-medium text-white hover:bg-zinc-800"
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
