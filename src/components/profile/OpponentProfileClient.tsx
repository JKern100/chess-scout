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
  stats_json: OpponentProfileV1 | null;
  games_analyzed: number | null;
  generated_at: string | null;
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

  const hasProfile = Boolean(profileRow?.stats_json);

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
      setActionMessage("Opponent profile schema is missing v1 columns. Run scripts/supabase_opponent_profiles.sql in Supabase SQL editor.");
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
                        {snap.top.map((m) => (
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
