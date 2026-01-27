"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MoreVertical, RefreshCw, Clock, TrendingUp, TrendingDown, Minus, ChevronRight, ChevronDown, Zap, Timer, Hourglass, BookOpen } from "lucide-react";
import { AnimatedNumber } from "./AnimatedNumber";
import { PlatformLogo } from "@/components/PlatformLogo";

type ChessPlatform = "lichess" | "chesscom";

type RatingHistoryData = {
  delta7d: number | null;
  delta30d: number | null;
  games7d: number;
  games30d: number;
};

type LichessUserData = {
  title: string | null;
  country: string | null;
  createdAt: number;
  seenAt: number | null;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  primarySpeed: string | null;
  primaryRating: number | null;
  perfs: Record<string, { rating: number; games: number; rd: number }>;
  ratingHistory?: Record<string, RatingHistoryData>;
};

type ImportPhase = "idle" | "streaming" | "saving" | "done" | "error";

export type ActivitySummary = {
  newGamesCount: number;
  speedCounts: Record<string, number>;
  ratedCount: number;
  casualCount: number;
  variants: Record<string, number>;
  ratingDeltas: Record<string, number>;
  currentRatings: Record<string, number>;
  notes: string[];
  sinceMs: number | null;
};

type Props = {
  platform: ChessPlatform;
  username: string;
  importedCount: number;
  indexedCount?: number;
  totalGames: number;
  isSelf?: boolean;
  isActiveImport?: boolean;
  isSyncing: boolean;
  isQueued: boolean;
  hasNewGames: boolean;
  importPhase?: ImportPhase;
  syncError?: string | null;
  onSyncGames: () => void;
  onStopSync: () => void;
  onRemoveFromQueue: () => void;
  onArchive: () => void;
  onAnalyze: () => void;
  onShowSavedLines?: () => void;
  loading: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  activitySummary?: ActivitySummary | null;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
};

function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return "Unknown";
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 48) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatMemberSince(timestamp: number): string {
  const date = new Date(timestamp);
  return date.getFullYear().toString();
}

function getCountryFlag(countryCode: string | null): string | null {
  if (!countryCode || countryCode.length !== 2) return null;
  // Convert country code to flag emoji
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function capitalizeSpeed(speed: string | null): string {
  if (!speed) return "";
  return speed.charAt(0).toUpperCase() + speed.slice(1);
}

function getSpeedIcon(speed: string | null) {
  switch (speed?.toLowerCase()) {
    case "bullet":
      return <Zap className="h-3.5 w-3.5" />;
    case "blitz":
      return <Timer className="h-3.5 w-3.5" />;
    case "rapid":
    case "classical":
    case "correspondence":
      return <Hourglass className="h-3.5 w-3.5" />;
    default:
      return null;
  }
}

function formatDelta(delta: number | null): { text: string; color: string; icon: React.ReactNode } {
  if (delta === null || delta === 0) {
    return { text: "—", color: "text-zinc-400", icon: <Minus className="h-3 w-3" /> };
  }
  if (delta > 0) {
    return { text: `+${delta}`, color: "text-emerald-600", icon: <TrendingUp className="h-3 w-3" /> };
  }
  return { text: `${delta}`, color: "text-rose-600", icon: <TrendingDown className="h-3 w-3" /> };
}

export function OpponentCard({
  platform,
  username,
  importedCount,
  indexedCount,
  totalGames,
  isSelf = false,
  isActiveImport = false,
  isSyncing,
  isQueued,
  hasNewGames,
  importPhase = "idle",
  syncError,
  onSyncGames,
  onStopSync,
  onRemoveFromQueue,
  onArchive,
  onAnalyze,
  onShowSavedLines,
  loading,
  menuOpen,
  onMenuToggle,
  activitySummary,
  isExpanded = false,
  onToggleExpand,
}: Props) {
  const [lichessData, setLichessData] = useState<LichessUserData | null>(null);
  const [lichessLoading, setLichessLoading] = useState(false);

  useEffect(() => {
    if (platform !== "lichess") return;

    let cancelled = false;
    setLichessLoading(true);

    fetch(`/api/lichess/user/${encodeURIComponent(username)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) setLichessData(data);
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setLichessLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [platform, username]);

  const isSynced = importedCount > 0 && !isSyncing;
  const isPartial = importedCount > 0 && importedCount < totalGames && !isSyncing;

  const indexingTarget = Math.min(1000, totalGames > 0 ? totalGames : 1000);
  const indexedValue = typeof indexedCount === "number" ? indexedCount : null;
  const isIndexing = !isSyncing && !isQueued && isActiveImport && indexedValue !== null && indexingTarget > 0 && indexedValue < indexingTarget;
  const title = lichessData?.title ?? null;
  const country = lichessData?.country ?? null;
  const flag = getCountryFlag(country);
  const seenAt = lichessData?.seenAt ?? null;
  const createdAt = lichessData?.createdAt ?? null;
  const primarySpeed = lichessData?.primarySpeed ?? null;
  const primaryRating = lichessData?.primaryRating ?? null;
  const ratingHistory = lichessData?.ratingHistory ?? {};
  const primaryHistory = primarySpeed ? ratingHistory[primarySpeed] : null;

  // W/D/L percentages
  const totalWDL = (lichessData?.wins ?? 0) + (lichessData?.draws ?? 0) + (lichessData?.losses ?? 0);
  const winPct = totalWDL > 0 ? ((lichessData?.wins ?? 0) / totalWDL) * 100 : 0;
  const drawPct = totalWDL > 0 ? ((lichessData?.draws ?? 0) / totalWDL) * 100 : 0;
  const lossPct = totalWDL > 0 ? ((lichessData?.losses ?? 0) / totalWDL) * 100 : 0;

  // Recent activity indicator
  const isOnline = seenAt && Date.now() - seenAt < 5 * 60 * 1000; // 5 minutes
  const isRecent = seenAt && Date.now() - seenAt < 24 * 60 * 60 * 1000; // 24 hours

  // Rating delta formatting
  const delta7d = formatDelta(primaryHistory?.delta7d ?? null);
  const delta30d = formatDelta(primaryHistory?.delta30d ?? null);
  const games7d = primaryHistory?.games7d ?? 0;
  const games30d = primaryHistory?.games30d ?? 0;

  const topPerfs = Object.entries(lichessData?.perfs ?? {})
    .map(([speed, perf]) => ({
      speed,
      rating: perf.rating,
      games: perf.games,
      delta30d: ratingHistory[speed]?.delta30d ?? null,
    }))
    .filter((p) => typeof p.rating === "number" && typeof p.games === "number" && p.games > 0)
    .sort((a, b) => b.games - a.games)
    .slice(0, 3);

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl bg-white shadow-sm transition-all duration-200 hover:shadow-md ${
        isSelf
          ? "border-2 border-emerald-300/80 shadow-emerald-100 hover:border-emerald-300"
          : "border border-zinc-200/80 hover:border-zinc-300"
      }`}
    >
      {/* Gradient accent top bar */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-zinc-900 via-zinc-700 to-zinc-900" />
      
      <div className="p-5 pt-6">
        {/* Header: Identity + Status */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Avatar placeholder with online indicator */}
            <div className="relative">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 text-lg font-bold text-zinc-600">
                {title ? (
                  <span className="text-amber-700">{title}</span>
                ) : (
                  username.charAt(0).toUpperCase()
                )}
              </div>
              <div
                className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${
                  isOnline ? "bg-emerald-500" : isRecent ? "bg-amber-400" : "bg-zinc-300"
                }`}
                title={seenAt ? `Last seen: ${formatRelativeTime(seenAt)}` : "Unknown"}
              />
            </div>
            
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-base font-semibold text-zinc-900">{username}</span>
                {isSelf ? <span className="text-xs font-medium text-emerald-700">(self)</span> : null}
                <PlatformLogo platform={platform} size={14} className="opacity-90" />
                {flag && <span className="text-sm" title={country ?? undefined}>{flag}</span>}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <span>{formatRelativeTime(seenAt)}</span>
                {createdAt && (
                  <>
                    <span className="text-zinc-300">·</span>
                    <span>Since {formatMemberSince(createdAt)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Menu */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
              onClick={onMenuToggle}
            >
              <MoreVertical className="h-4 w-4" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
                  disabled={loading || platform !== "lichess" || isSyncing || isQueued}
                  onClick={onSyncGames}
                >
                  <RefreshCw className="h-4 w-4 text-zinc-400" />
                  Sync Games
                </button>
                {isSyncing ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-rose-600 transition-colors hover:bg-rose-50"
                    onClick={onStopSync}
                  >
                    Stop Sync
                  </button>
                ) : isQueued ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
                    onClick={onRemoveFromQueue}
                  >
                    Remove from Queue
                  </button>
                ) : null}
                <div className="h-px bg-zinc-100" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                  disabled={loading || isSyncing}
                  onClick={onArchive}
                >
                  Archive
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Primary Rating Card */}
        {primarySpeed && primaryRating ? (
          <div className="mt-4 rounded-xl bg-gradient-to-br from-zinc-50 to-zinc-100/50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm">
                  {getSpeedIcon(primarySpeed)}
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {capitalizeSpeed(primarySpeed)}
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-zinc-900">
                    {primaryRating}
                  </div>
                </div>
              </div>
              
              {/* Rating Changes */}
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-400">7d</span>
                  <span className={`flex items-center gap-0.5 font-semibold tabular-nums ${delta7d.color}`}>
                    {delta7d.icon}
                    {delta7d.text}
                  </span>
                  {games7d > 0 && (
                    <span className="text-zinc-400">({games7d}g)</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-400">30d</span>
                  <span className={`flex items-center gap-0.5 font-semibold tabular-nums ${delta30d.color}`}>
                    {delta30d.icon}
                    {delta30d.text}
                  </span>
                  {games30d > 0 && (
                    <span className="text-zinc-400">({games30d}g)</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : lichessLoading ? (
          <div className="mt-4 flex h-[88px] items-center justify-center rounded-xl bg-zinc-50">
            <RefreshCw className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : null}

        {/* Sync Status Bar */}
        <div className="mt-4 flex items-center justify-between rounded-lg bg-zinc-50/80 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-500">Synced</span>
            <AnimatedNumber value={importedCount} className="text-sm font-bold tabular-nums text-zinc-900" />
            {isPartial && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">partial</span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {isSyncing ? (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                importPhase === "streaming" ? "bg-blue-100 text-blue-700" :
                importPhase === "saving" ? "bg-amber-100 text-amber-700" :
                importPhase === "error" ? "bg-red-100 text-red-700" :
                "bg-blue-100 text-blue-700"
              }`}>
                <RefreshCw className="h-3 w-3 animate-spin" />
                {importPhase === "streaming" ? "Downloading" : importPhase === "saving" ? "Saving" : "Syncing"}
              </span>
            ) : isQueued ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-200 px-2.5 py-1 text-[11px] font-semibold text-zinc-700">
                <Clock className="h-3 w-3" />
                Queued
              </span>
            ) : isIndexing ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Indexing
              </span>
            ) : isSynced ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                Synced
              </span>
            ) : null}
          </div>
        </div>
        
        {syncError && (
          <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {syncError}
          </div>
        )}

        {/* Activity Summary */}
        {activitySummary && activitySummary.newGamesCount > 0 && (
          <div className="mt-3 rounded-xl border border-blue-200/60 bg-gradient-to-br from-blue-50 to-indigo-50/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-700">
                {activitySummary.newGamesCount} new game{activitySummary.newGamesCount !== 1 ? "s" : ""}
              </span>
              {Object.keys(activitySummary.ratingDeltas).length > 0 && (
                <div className="flex gap-1.5">
                  {Object.entries(activitySummary.ratingDeltas).map(([speed, delta]) => (
                    <span
                      key={speed}
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        delta > 0 ? "bg-emerald-100 text-emerald-700" :
                        delta < 0 ? "bg-rose-100 text-rose-700" :
                        "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {delta > 0 ? "+" : ""}{delta}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {activitySummary.notes.length > 0 && (
              <div className="mt-1.5 text-[10px] text-blue-600/80">
                {activitySummary.notes.join(" · ")}
              </div>
            )}
          </div>
        )}

        {/* Expandable Content */}
        {isExpanded && (
          <>
            {/* Win Rate Bar */}
            {totalWDL > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-zinc-500">
                  <span>Career Performance</span>
                  <span>{totalWDL.toLocaleString()} games</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div className="flex h-full">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${winPct}%` }}
                      title={`Wins: ${lichessData?.wins?.toLocaleString()}`}
                    />
                    <div
                      className="h-full bg-zinc-300 transition-all duration-500"
                      style={{ width: `${drawPct}%` }}
                      title={`Draws: ${lichessData?.draws?.toLocaleString()}`}
                    />
                    <div
                      className="h-full bg-rose-500 transition-all duration-500"
                      style={{ width: `${lossPct}%` }}
                      title={`Losses: ${lichessData?.losses?.toLocaleString()}`}
                    />
                  </div>
                </div>
                {topPerfs.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {topPerfs.map((p) => {
                      const d30 = formatDelta(p.delta30d);
                      return (
                        <div
                          key={p.speed}
                          title={`${capitalizeSpeed(p.speed)} · ${p.games.toLocaleString()} games`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2 py-1 text-[10px] font-medium text-zinc-700"
                        >
                          <span className="font-semibold text-zinc-900">{capitalizeSpeed(p.speed)}</span>
                          <span className="tabular-nums text-zinc-700">{p.rating}</span>
                          <span className={`inline-flex items-center gap-0.5 tabular-nums ${d30.color}`}>
                            {d30.icon}
                            {d30.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            )}

            {onShowSavedLines ? (
              <button
                type="button"
                onClick={onShowSavedLines}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                <BookOpen className="h-4 w-4 text-zinc-400" />
                <span>Show Saved Lines</span>
              </button>
            ) : null}
          </>
        )}

        {/* Expand/Collapse Toggle */}
        {onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-700"
          >
            {isExpanded ? (
              <>
                <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                <span>Show less</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span>Show more</span>
              </>
            )}
          </button>
        )}

        {/* Action Buttons */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            type="button"
            className="group/btn relative inline-flex h-10 items-center justify-center gap-2 overflow-hidden rounded-xl bg-zinc-900 text-sm font-semibold text-white transition-all hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading || importedCount < 10}
            onClick={onAnalyze}
          >
            <span>Analyze</span>
            <ChevronRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
          </button>
          <Link
            href={`/opponents/${encodeURIComponent(platform)}/${encodeURIComponent(username)}/profile`}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border-2 border-zinc-200 bg-white text-sm font-semibold text-zinc-700 transition-all hover:border-zinc-300 hover:bg-zinc-50"
          >
            <span>Profile</span>
            <ChevronRight className="h-4 w-4 text-zinc-400" />
          </Link>
        </div>
      </div>
    </div>
  );
}
