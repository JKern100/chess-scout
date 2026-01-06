"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MoreVertical, Check, RefreshCw, Trophy } from "lucide-react";
import { AnimatedNumber } from "./AnimatedNumber";

type ChessPlatform = "lichess" | "chesscom";

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
};

type ImportPhase = "idle" | "streaming" | "saving" | "done" | "error";

type Props = {
  platform: ChessPlatform;
  username: string;
  importedCount: number;
  totalGames: number;
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
  loading: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
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

export function OpponentCard({
  platform,
  username,
  importedCount,
  totalGames,
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
  loading,
  menuOpen,
  onMenuToggle,
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
  const title = lichessData?.title ?? null;
  const country = lichessData?.country ?? null;
  const flag = getCountryFlag(country);
  const seenAt = lichessData?.seenAt ?? null;
  const createdAt = lichessData?.createdAt ?? null;
  const primarySpeed = lichessData?.primarySpeed ?? null;
  const primaryRating = lichessData?.primaryRating ?? null;

  // W/D/L percentages
  const totalWDL = (lichessData?.wins ?? 0) + (lichessData?.draws ?? 0) + (lichessData?.losses ?? 0);
  const winPct = totalWDL > 0 ? ((lichessData?.wins ?? 0) / totalWDL) * 100 : 0;
  const drawPct = totalWDL > 0 ? ((lichessData?.draws ?? 0) / totalWDL) * 100 : 0;
  const lossPct = totalWDL > 0 ? ((lichessData?.losses ?? 0) / totalWDL) * 100 : 0;

  // Recent activity indicator
  const isOnline = seenAt && Date.now() - seenAt < 5 * 60 * 1000; // 5 minutes
  const isRecent = seenAt && Date.now() - seenAt < 24 * 60 * 60 * 1000; // 24 hours

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
      {/* Zone A: Identity */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {title ? (
            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">
              {title}
            </span>
          ) : null}
          <span className="truncate text-lg font-semibold text-neutral-900">{username}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {flag ? <span className="text-base" title={country ?? undefined}>{flag}</span> : null}
          <div className="flex items-center gap-1.5" title={seenAt ? `Last seen: ${formatRelativeTime(seenAt)}` : undefined}>
            <div
              className={`h-2 w-2 rounded-full ${
                isOnline ? "bg-green-500" : isRecent ? "bg-yellow-400" : "bg-neutral-300"
              }`}
            />
            <span className="text-xs text-neutral-500">{formatRelativeTime(seenAt)}</span>
          </div>

          {/* Menu */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
              onClick={onMenuToggle}
            >
              <MoreVertical className="h-4 w-4" />
            </button>

            {menuOpen ? (
              <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  disabled={loading || platform !== "lichess" || isSyncing || isQueued}
                  onClick={onSyncGames}
                >
                  Sync Games
                </button>
                {isSyncing ? (
                  <button
                    type="button"
                    className="flex w-full items-center px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                    onClick={onStopSync}
                  >
                    Stop Sync
                  </button>
                ) : isQueued ? (
                  <button
                    type="button"
                    className="flex w-full items-center px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
                    onClick={onRemoveFromQueue}
                  >
                    Remove from Queue
                  </button>
                ) : null}
                <div className="h-px bg-neutral-100" />
                <button
                  type="button"
                  className="flex w-full items-center px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  disabled={loading || isSyncing}
                  onClick={onArchive}
                >
                  Archive
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Zone B: Rating & History */}
      <div className="mt-3 flex items-center gap-4 text-xs text-neutral-500">
        {primarySpeed && primaryRating ? (
          <span>
            <span className="font-medium text-neutral-700">{capitalizeSpeed(primarySpeed)}:</span>{" "}
            {primaryRating}
          </span>
        ) : lichessLoading ? (
          <span className="animate-pulse">Loading rating...</span>
        ) : null}
        {createdAt ? (
          <span>Member since {formatMemberSince(createdAt)}</span>
        ) : null}
      </div>

      {/* Zone C: Sync Status & Odometer */}
      <div className="mt-4 flex flex-col gap-2 rounded-lg bg-neutral-50 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-neutral-500">Synced:</span>
            <AnimatedNumber value={importedCount} className="font-semibold text-neutral-900" />
            {isPartial && (
              <span className="text-xs text-amber-600">(partial)</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isSyncing ? (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                importPhase === "streaming" ? "bg-blue-100 text-blue-700" :
                importPhase === "saving" ? "bg-amber-100 text-amber-700" :
                importPhase === "error" ? "bg-red-100 text-red-700" :
                "bg-blue-100 text-blue-700"
              }`}>
                <RefreshCw className={`h-3 w-3 ${importPhase !== "error" ? "animate-spin" : ""}`} />
                {importPhase === "streaming" ? "Downloading" :
                 importPhase === "saving" ? "Saving" :
                 importPhase === "error" ? "Error" : "Syncing"}
              </span>
            ) : isQueued ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600">
                Queued
              </span>
            ) : hasNewGames ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                New Games
              </span>
            ) : isSynced ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                <Check className="h-3 w-3" />
                Synced
              </span>
            ) : null}
          </div>
        </div>
        
        {/* 3-year scope note */}
        <div className="text-[10px] text-neutral-400">
          Games from past 3 years
        </div>
        
        {/* Error message */}
        {syncError && (
          <div className="text-xs text-red-600">
            {syncError}
          </div>
        )}
      </div>

      {/* Zone D: Career Performance */}
      {totalWDL > 0 ? (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
            <div className="flex h-full">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${winPct}%` }}
                title={`Wins: ${lichessData?.wins?.toLocaleString()}`}
              />
              <div
                className="h-full bg-neutral-300 transition-all"
                style={{ width: `${drawPct}%` }}
                title={`Draws: ${lichessData?.draws?.toLocaleString()}`}
              />
              <div
                className="h-full bg-rose-500 transition-all"
                style={{ width: `${lossPct}%` }}
                title={`Losses: ${lichessData?.losses?.toLocaleString()}`}
              />
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-neutral-500">
            <span>{winPct.toFixed(0)}% W</span>
            <span>{drawPct.toFixed(0)}% D</span>
            <span>{lossPct.toFixed(0)}% L</span>
          </div>
        </div>
      ) : null}

      {/* Actions */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center rounded-lg bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          disabled={loading || importedCount < 10}
          onClick={onAnalyze}
        >
          Analyze
        </button>
        <Link
          href={`/opponents/${encodeURIComponent(platform)}/${encodeURIComponent(username)}/profile`}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-900 hover:bg-neutral-50"
        >
          Scout Report
        </Link>
      </div>
    </div>
  );
}
