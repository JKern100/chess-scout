"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, RefreshCw, Check, ChevronRight, BookOpen, Clock } from "lucide-react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useImportQueue } from "@/context/ImportQueueContext";
import { OpponentFiltersPanel } from "@/components/chess/OpponentFiltersPanel";
import { useOpponentFilters } from "@/components/chess/useOpponentFilters";

type Platform = "lichess" | "chesscom";

type OnboardingStep = "welcome" | "identity" | "syncing" | "filters" | "generating" | "complete";

type ProfileData = {
  primary_platform: Platform;
  platform_username: string;
  display_name: string;
  onboarding_completed: boolean;
  user_games_imported_count: number;
  user_profile_generated_at: string | null;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  initialProfile?: ProfileData | null;
};

export function AccountOnboardingModal({ isOpen, onClose, onComplete, initialProfile }: Props) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [primaryPlatform, setPrimaryPlatform] = useState<Platform>(initialProfile?.primary_platform || "lichess");
  const [platformUsername, setPlatformUsername] = useState(initialProfile?.platform_username || "");
  const [displayName, setDisplayName] = useState(initialProfile?.display_name || "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncedGamesCount, setSyncedGamesCount] = useState(initialProfile?.user_games_imported_count || 0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [profileGenerated, setProfileGenerated] = useState(!!initialProfile?.user_profile_generated_at);

  const { speeds, setSpeeds, rated, setRated, datePreset, setDatePreset, fromDate, setFromDate, toDate, setToDate } = useOpponentFilters();
  const { addToQueue, isImporting, currentOpponent, progress, progressByOpponent } = useImportQueue();

  const pollIntervalRef = useRef<number | null>(null);

  // Track sync progress for the user's own games
  const userOpponentId = useMemo(() => {
    if (!platformUsername.trim()) return null;
    return `${primaryPlatform}:${platformUsername.trim().toLowerCase()}`;
  }, [primaryPlatform, platformUsername]);

  const userSyncProgress = useMemo(() => {
    if (!userOpponentId) return 0;
    return progressByOpponent[userOpponentId] || 0;
  }, [userOpponentId, progressByOpponent]);

  const isUserSyncing = useMemo(() => {
    if (!userOpponentId) return false;
    return isImporting && currentOpponent === userOpponentId;
  }, [isImporting, currentOpponent, userOpponentId]);

  // Poll for synced games count
  useEffect(() => {
    if (step !== "syncing" || !platformUsername.trim()) return;

    const pollGamesCount = async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) return;

        const { count, error } = await supabase
          .from("games")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", user.id)
          .eq("platform", primaryPlatform)
          .ilike("username", platformUsername.trim().toLowerCase());

        if (!error && typeof count === "number") {
          setSyncedGamesCount(count);
        }
      } catch {
        // ignore
      }
    };

    void pollGamesCount();
    pollIntervalRef.current = window.setInterval(pollGamesCount, 3000);

    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [step, platformUsername, primaryPlatform]);

  // Minimum games needed for a meaningful profile
  const MIN_GAMES_FOR_PROFILE = 50;

  // Auto-advance from syncing when enough games are synced or sync completes
  useEffect(() => {
    if (step === "syncing" && !isUserSyncing && userSyncProgress > 0) {
      // Sync finished with games - auto advance after a short delay
      const timer = setTimeout(() => {
        setStep("filters");
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [step, isUserSyncing, userSyncProgress]);

  const handleSaveIdentity = useCallback(async () => {
    if (!platformUsername.trim()) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error("Not signed in");

      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          primary_platform: primaryPlatform,
          platform_username: platformUsername.trim(),
          display_name: displayName.trim() || platformUsername.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (error) throw error;

      // Start syncing games
      setStep("syncing");
      if (userOpponentId) {
        addToQueue(userOpponentId);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setIsSaving(false);
    }
  }, [platformUsername, primaryPlatform, displayName, userOpponentId, addToQueue]);

  const handleGenerateProfile = useCallback(async () => {
    if (!platformUsername.trim()) return;

    setIsGenerating(true);
    setGenerateError(null);

    try {
      const res = await fetch(
        `/api/opponents/${encodeURIComponent(primaryPlatform)}/${encodeURIComponent(platformUsername.trim())}/profile/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            speeds,
            rated,
            from: fromDate || null,
            to: toDate || null,
            enable_style_markers: true,
          }),
        }
      );

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((json as any)?.error ?? "Failed to generate profile"));
      }

      // Update profile to mark as generated
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        await supabase.from("profiles").update({
          user_profile_generated_at: new Date().toISOString(),
          user_games_imported_count: userSyncProgress,
        }).eq("id", user.id);
      }

      setProfileGenerated(true);
      setStep("complete");
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Failed to generate profile");
    } finally {
      setIsGenerating(false);
    }
  }, [platformUsername, primaryPlatform, speeds, rated, fromDate, toDate, userSyncProgress]);

  const handleComplete = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        await supabase.from("profiles").update({
          onboarding_completed: true,
        }).eq("id", user.id);
      }
    } catch {
      // ignore
    }
    onComplete();
  }, [onComplete]);

  const handleSkipToFilters = useCallback(() => {
    setStep("filters");
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-6">
          {/* Step: Welcome */}
          {step === "welcome" && (
            <div className="text-center">
              <div className="mb-6">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-yellow-100">
                  <span className="text-3xl">♟️</span>
                </div>
                <h2 className="text-xl font-semibold text-zinc-900">Welcome to ChessScout!</h2>
                <p className="mt-2 text-sm text-zinc-600">
                  Let&apos;s set up your account to unlock personalized chess insights and opponent scouting.
                </p>
              </div>

              <div className="mb-6 grid gap-3 text-left">
                <div className="flex items-start gap-3 rounded-xl bg-zinc-50 p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600">1</div>
                  <div>
                    <div className="text-sm font-medium text-zinc-900">Connect your chess account</div>
                    <div className="text-xs text-zinc-500">Link your Lichess or Chess.com username</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-xl bg-zinc-50 p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600">2</div>
                  <div>
                    <div className="text-sm font-medium text-zinc-900">Sync your games</div>
                    <div className="text-xs text-zinc-500">We&apos;ll import your game history for analysis</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-xl bg-zinc-50 p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600">3</div>
                  <div>
                    <div className="text-sm font-medium text-zinc-900">Generate your Scout profile</div>
                    <div className="text-xs text-zinc-500">Get personalized insights about your playing style</div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStep("identity")}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Get Started
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Step: Identity */}
          {step === "identity" && (
            <div>
              <h2 className="mb-2 text-lg font-semibold text-zinc-900">Connect Your Chess Account</h2>
              <p className="mb-6 text-sm text-zinc-600">
                Enter your chess platform username to sync your games and generate your personal Scout report.
              </p>

              <div className="grid gap-5">
                {/* Platform Selection */}
                <div>
                  <label className="mb-2 block text-xs font-medium text-zinc-700">Platform</label>
                  <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setPrimaryPlatform("lichess")}
                      className={`inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors ${
                        primaryPlatform === "lichess"
                          ? "bg-zinc-900 text-white"
                          : "text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      Lichess
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrimaryPlatform("chesscom")}
                      className={`inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors ${
                        primaryPlatform === "chesscom"
                          ? "bg-zinc-900 text-white"
                          : "text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      Chess.com
                    </button>
                  </div>
                </div>

                {/* Username */}
                <div>
                  <label htmlFor="onboard-username" className="mb-2 block text-xs font-medium text-zinc-700">
                    {primaryPlatform === "lichess" ? "Lichess" : "Chess.com"} Username
                  </label>
                  <input
                    id="onboard-username"
                    type="text"
                    value={platformUsername}
                    onChange={(e) => {
                      setPlatformUsername(e.target.value);
                      if (!displayName || displayName === platformUsername) {
                        setDisplayName(e.target.value);
                      }
                    }}
                    placeholder={`Enter your ${primaryPlatform === "lichess" ? "Lichess" : "Chess.com"} username`}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white"
                    autoFocus
                  />
                </div>

                {/* Display Name */}
                <div>
                  <label htmlFor="onboard-display" className="mb-2 block text-xs font-medium text-zinc-700">
                    Display Name (optional)
                  </label>
                  <input
                    id="onboard-display"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your display name in ChessScout"
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white"
                  />
                </div>

                {saveError && (
                  <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{saveError}</div>
                )}

                {primaryPlatform === "chesscom" && (
                  <div className="rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-700">
                    Chess.com game imports are currently limited. Full support coming soon!
                  </div>
                )}
              </div>

              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep("welcome")}
                  className="text-sm font-medium text-zinc-500 hover:text-zinc-700"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleSaveIdentity}
                  disabled={isSaving || !platformUsername.trim()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Continue
                      <ChevronRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step: Syncing */}
          {step === "syncing" && (
            <div className="text-center">
              <div className="mb-6">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100">
                  <RefreshCw className={`h-8 w-8 text-blue-600 ${isUserSyncing ? "animate-spin" : ""}`} />
                </div>
                <h2 className="text-lg font-semibold text-zinc-900">
                  {isUserSyncing ? "Building Your Chess Profile..." : userSyncProgress > 0 ? "Sync Complete!" : "Starting Sync..."}
                </h2>
                <p className="mt-2 text-sm text-zinc-600 max-w-md mx-auto">
                  {isUserSyncing
                    ? "We're importing your last 3 years of games to build a comprehensive picture of your playing style."
                    : userSyncProgress > 0
                    ? "Your games have been imported successfully."
                    : "Preparing to import your games..."}
                </p>
              </div>

              {/* 3-Year Explanation */}
              {isUserSyncing && (
                <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-left">
                  <div className="flex items-start gap-3">
                    <Clock className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-blue-900">Why 3 years of games?</div>
                      <p className="mt-1 text-xs text-blue-700">
                        This timeframe captures your current playing style while filtering out outdated patterns.
                        The result? More accurate insights and better opponent preparation.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-6 rounded-xl bg-zinc-50 p-6">
                <div className="text-4xl font-bold text-zinc-900">{userSyncProgress.toLocaleString()}</div>
                <div className="mt-1 text-sm text-zinc-500">games processed</div>

                {isUserSyncing && (
                  <div className="mt-4">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className="h-2.5 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(5, (userSyncProgress / Math.max(userSyncProgress + 500, 1000)) * 100))}%` }}
                      />
                    </div>
                    <div className="mt-3 text-xs text-zinc-500">
                      {userSyncProgress < 100 
                        ? "Getting started... this usually takes 1-5 minutes."
                        : userSyncProgress < 500
                        ? "Making great progress! Your profile is taking shape."
                        : userSyncProgress < 2000
                        ? "Impressive game history! Almost there."
                        : "Wow, you've played a lot! Hang tight, we're processing everything."}
                    </div>
                  </div>
                )}
              </div>

              {/* User Guide invitation */}
              {isUserSyncing && (
                <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="flex items-center justify-center gap-3">
                    <BookOpen className="h-5 w-5 text-zinc-500" />
                    <span className="text-sm text-zinc-600">While you wait, explore the</span>
                    <Link
                      href="/guide"
                      target="_blank"
                      className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      User Guide →
                    </Link>
                  </div>
                </div>
              )}

              {/* Only show continue when sync is complete */}
              {!isUserSyncing && userSyncProgress > 0 && (
                <button
                  type="button"
                  onClick={() => setStep("filters")}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Continue
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}

              {/* Encouraging message while syncing */}
              {isUserSyncing && (
                <p className="text-xs text-zinc-400 mt-4">
                  Please keep this window open. The sync will complete automatically.
                </p>
              )}
            </div>
          )}

          {/* Step: Filters */}
          {step === "filters" && (
            <div>
              <h2 className="mb-2 text-lg font-semibold text-zinc-900">Generate Your Scout Profile</h2>
              <p className="mb-6 text-sm text-zinc-600">
                Choose which games to analyze for your personal Scout report.
              </p>

              <OpponentFiltersPanel
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
                generateStyleMarkers={true}
                setGenerateStyleMarkers={() => {}}
              />

              {generateError && (
                <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{generateError}</div>
              )}

              {userSyncProgress < MIN_GAMES_FOR_PROFILE && (
                <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  You need at least {MIN_GAMES_FOR_PROFILE} synced games to generate a meaningful profile. 
                  Currently synced: {userSyncProgress} games.
                  {isUserSyncing ? " Please wait while we import more games..." : " Please go back and wait for more games to sync."}
                </div>
              )}

              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep("syncing")}
                  className="text-sm font-medium text-zinc-500 hover:text-zinc-700"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleGenerateProfile}
                  disabled={isGenerating || userSyncProgress < MIN_GAMES_FOR_PROFILE}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  title={userSyncProgress < MIN_GAMES_FOR_PROFILE ? `Need at least ${MIN_GAMES_FOR_PROFILE} games (have ${userSyncProgress})` : undefined}
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      Generate Profile
                      <ChevronRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step: Complete */}
          {step === "complete" && (
            <div className="text-center">
              <div className="mb-6">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100">
                  <Check className="h-8 w-8 text-green-600" />
                </div>
                <h2 className="text-lg font-semibold text-zinc-900">You&apos;re All Set!</h2>
                <p className="mt-2 text-sm text-zinc-600">
                  Your Scout profile has been generated. You can now explore your playing style insights and start scouting opponents.
                </p>
              </div>

              <div className="mb-6 grid gap-3 text-left">
                <div className="rounded-xl bg-zinc-50 p-4">
                  <div className="text-sm font-medium text-zinc-900">{platformUsername}</div>
                  <div className="text-xs text-zinc-500">{primaryPlatform === "lichess" ? "Lichess" : "Chess.com"}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-zinc-50 p-4 text-center">
                    <div className="text-2xl font-bold text-zinc-900">{userSyncProgress.toLocaleString()}</div>
                    <div className="text-xs text-zinc-500">Games Synced</div>
                  </div>
                  <div className="rounded-xl bg-zinc-50 p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">✓</div>
                    <div className="text-xs text-zinc-500">Profile Ready</div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={handleComplete}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  View My Scout Profile
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-sm font-medium text-zinc-500 hover:text-zinc-700"
                >
                  Close and explore later
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
