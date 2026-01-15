"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, RefreshCw, ChevronRight, BookOpen, Clock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useImportQueue } from "@/context/ImportQueueContext";
import { useOpponentFilters } from "@/components/chess/useOpponentFilters";
import { PlatformLogo } from "@/components/PlatformLogo";

type Platform = "lichess" | "chesscom";

type OnboardingStep = "welcome" | "identity" | "syncing";

type ProfileData = {
  primary_platform: Platform;
  platform_username: string;
  display_name: string;
  onboarding_completed: boolean;
  user_games_imported_count: number;
  user_profile_generated_at: string | null;
  is_pro: boolean;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  initialProfile?: ProfileData | null;
};

export function AccountOnboardingModal({ isOpen, onClose, onComplete, initialProfile }: Props) {
  const router = useRouter();
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
  const [scanMaxGames, setScanMaxGames] = useState<number | null>(200);

  // Onboarding should use default filters (not persisted from prior sessions)
  const { speeds, rated, fromDate, toDate } = useOpponentFilters({ persist: false });
  const { addToQueue, isImporting, currentOpponent, progress, progressByOpponent, importPhase, pendingWrites } = useImportQueue();

  const pollIntervalRef = useRef<number | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const lastDbVerifyAtRef = useRef<number>(0);

  // Track sync progress for the user's own games
  const userOpponentId = useMemo(() => {
    if (!platformUsername.trim()) return null;
    return `${primaryPlatform}:${platformUsername.trim().toLowerCase()}`;
  }, [primaryPlatform, platformUsername]);

  const isProUser = Boolean(initialProfile?.is_pro);

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
        addToQueue(userOpponentId, { maxGames: scanMaxGames });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setIsSaving(false);
    }
  }, [platformUsername, primaryPlatform, displayName, userOpponentId, addToQueue, scanMaxGames]);

  const handleGenerateProfile = useCallback(async () => {
    if (!platformUsername.trim()) return;

    setIsGenerating(true);
    setGenerateError(null);

    try {
      generationAbortRef.current?.abort();
      const controller = new AbortController();
      generationAbortRef.current = controller;

      const res = await fetch(
        `/api/opponents/${encodeURIComponent(primaryPlatform)}/${encodeURIComponent(platformUsername.trim())}/profile/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            speeds,
            rated,
            // Onboarding should not apply date filtering by default.
            // Otherwise users with older games (or clock skew) can end up with 0 analyzed games.
            from: null,
            to: null,
            enable_style_markers: true,
            enable_ai_narrative: true,
            subject_type: "self",
          }),
          signal: controller.signal,
        }
      );

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn("[Onboarding] profile generate failed", {
          status: res.status,
          error: (json as any)?.error,
          platform: primaryPlatform,
          username: platformUsername.trim(),
        });
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

      // Mark onboarding complete and take user directly to their self report
      try {
        const supabase2 = createSupabaseBrowserClient();
        const { data: { user: user2 } } = await supabase2.auth.getUser();
        if (user2?.id) {
          await supabase2.from("profiles").update({ onboarding_completed: true }).eq("id", user2.id);
        }
      } catch {
        // ignore
      }

      onComplete();
      router.push(`/opponents/${primaryPlatform}/${encodeURIComponent(platformUsername.trim())}/profile`);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setGenerateError(err instanceof Error ? err.message : "Failed to generate profile");
    } finally {
      setIsGenerating(false);
    }
  }, [platformUsername, primaryPlatform, speeds, rated, userSyncProgress, onComplete, router]);

  // Auto-generate from syncing screen and then redirect directly to report.
  useEffect(() => {
    if (step !== "syncing") return;
    if (isUserSyncing) return;
    if (userSyncProgress <= 0) return;

    // Avoid generating while the importer is still flushing writes.
    // Otherwise the generator can query the DB before games are fully committed.
    if (importPhase === "saving" || pendingWrites > 0) return;

    // If a profile already exists, take the user straight to it.
    if (profileGenerated && !isGenerating) {
      onComplete();
      router.push(`/opponents/${primaryPlatform}/${encodeURIComponent(platformUsername.trim())}/profile`);
      return;
    }

    // Otherwise, generate once we have enough games AND they've landed in the DB.
    if (!profileGenerated && !isGenerating && userSyncProgress >= MIN_GAMES_FOR_PROFILE) {
      const now = Date.now();
      // Throttle DB verification to avoid spamming Supabase.
      if (now - lastDbVerifyAtRef.current < 1500) return;
      lastDbVerifyAtRef.current = now;

      void (async () => {
        try {
          const supabase = createSupabaseBrowserClient();
          const { data: { user } } = await supabase.auth.getUser();
          if (!user?.id) return;

          const usernameKey = platformUsername.trim().toLowerCase();
          const { count, error } = await supabase
            .from("games")
            .select("id", { count: "exact", head: true })
            .eq("profile_id", user.id)
            .eq("platform", primaryPlatform)
            .ilike("username", usernameKey);

          if (error) {
            console.warn("[Onboarding] DB verify failed", error.message);
            return;
          }

          const dbCount = typeof count === "number" ? count : 0;
          // Only proceed once DB has at least the games we believe were processed.
          if (dbCount >= Math.min(userSyncProgress, MIN_GAMES_FOR_PROFILE)) {
            void handleGenerateProfile();
          }
        } catch {
          // ignore
        }
      })();
    }
  }, [
    step,
    isUserSyncing,
    userSyncProgress,
    profileGenerated,
    isGenerating,
    handleGenerateProfile,
    onComplete,
    router,
    primaryPlatform,
    platformUsername,
    importPhase,
    pendingWrites,
  ]);

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
                <div>
                  <div className="mb-2 text-xs font-medium text-zinc-700">Choose your scan depth</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setScanMaxGames(100)}
                      className={`group w-full rounded-2xl border p-4 text-left transition-colors ${
                        scanMaxGames === 100
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold">100 Games</div>
                        <div className={`text-xs font-medium ${scanMaxGames === 100 ? "text-white/80" : "text-zinc-500"}`}>
                          Blitz Scan
                        </div>
                      </div>
                      <div className={`mt-2 text-xs ${scanMaxGames === 100 ? "text-white/80" : "text-zinc-600"}`}>
                        A quick tactical overview designed for a fast taste.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScanMaxGames(200)}
                      className={`group w-full rounded-2xl border p-4 text-left transition-colors ${
                        scanMaxGames === 200
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold">200 Games</div>
                        <div className={`text-xs font-medium ${scanMaxGames === 200 ? "text-white/80" : "text-zinc-500"}`}>
                          Rapid Review
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className={`text-xs ${scanMaxGames === 200 ? "text-white/80" : "text-zinc-600"}`}>
                          Our recommended choice; a good statistical base to accurately establish a player&apos;s core habits.
                        </div>
                      </div>
                      <div className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        scanMaxGames === 200 ? "bg-white/15 text-white" : "bg-emerald-50 text-emerald-700"
                      }`}>
                        Recommended
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScanMaxGames(500)}
                      disabled={!isProUser}
                      title={!isProUser ? "Pro only" : undefined}
                      className={`group w-full rounded-2xl border p-4 text-left transition-colors ${
                        !isProUser
                          ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400"
                          : scanMaxGames === 500
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold">500 Games</div>
                        <div className={`text-xs font-medium ${scanMaxGames === 500 ? "text-white/80" : !isProUser ? "text-zinc-400" : "text-zinc-500"}`}>
                          Classical Deep Dive
                        </div>
                      </div>
                      <div className={`mt-2 text-xs ${scanMaxGames === 500 ? "text-white/80" : !isProUser ? "text-zinc-400" : "text-zinc-600"}`}>
                        A thorough, professional-grade analysis for serious scouting.
                      </div>
                      {!isProUser && (
                        <div className="mt-2 inline-flex rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
                          Pro
                        </div>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setScanMaxGames(null)}
                      disabled={!isProUser}
                      title={!isProUser ? "Pro only" : undefined}
                      className={`group w-full rounded-2xl border p-4 text-left transition-colors ${
                        !isProUser
                          ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400"
                          : scanMaxGames === null
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold">Unlimited</div>
                        <div className={`text-xs font-medium ${scanMaxGames === null ? "text-white/80" : !isProUser ? "text-zinc-400" : "text-zinc-500"}`}>
                          Grandmaster Prep
                        </div>
                      </div>
                      <div className={`mt-2 text-xs ${scanMaxGames === null ? "text-white/80" : !isProUser ? "text-zinc-400" : "text-zinc-600"}`}>
                        An exhaustive, no-stone-unturned option for total analytical dominance.
                      </div>
                      {!isProUser && (
                        <div className="mt-2 inline-flex rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
                          Pro
                        </div>
                      )}
                    </button>
                  </div>
                </div>

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
                      <span className="inline-flex items-center justify-center gap-2">
                        <PlatformLogo platform="lichess" size={16} className={primaryPlatform === "lichess" ? "opacity-90" : "opacity-70"} />
                        <span>Lichess</span>
                      </span>
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
                      <span className="inline-flex items-center justify-center gap-2">
                        <PlatformLogo platform="chesscom" size={16} className={primaryPlatform === "chesscom" ? "opacity-90" : "opacity-70"} />
                        <span>Chess.com</span>
                      </span>
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
                  <RefreshCw
                    className={`h-8 w-8 text-blue-600 ${
                      isUserSyncing || isGenerating || importPhase === "saving" || pendingWrites > 0 ? "animate-spin" : ""
                    }`}
                  />
                </div>
                <h2 className="text-lg font-semibold text-zinc-900">
                  {isUserSyncing
                    ? "Building Your Chess Profile..."
                    : isGenerating
                      ? "Generating Your Scout Report..."
                      : userSyncProgress > 0
                        ? "Sync Complete!"
                        : "Starting Sync..."}
                </h2>
                <p className="mt-2 text-sm text-zinc-600 max-w-md mx-auto">
                  {isUserSyncing
                    ? `We’re importing ${scanMaxGames === null ? "your full game history" : `your most recent ${scanMaxGames.toLocaleString()} games`} to build a comprehensive picture of your playing style.`
                    : isGenerating
                      ? "Hang tight — we’re analyzing your games and building your Scout report."
                      : userSyncProgress > 0
                        ? "Your games have been imported successfully."
                        : "Preparing to import your games..."}
                </p>
              </div>

              {/* Import Explanation */}
              {isUserSyncing && (
                <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-left">
                  <div className="flex items-start gap-3">
                    <Clock className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-blue-900">Why this scan depth?</div>
                      <p className="mt-1 text-xs text-blue-700">
                        Your most recent games capture your current playing style while keeping the import fast.
                        You can refresh anytime to sync new games as you play more.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-6 rounded-xl bg-zinc-50 p-6">
                <div className="text-4xl font-bold text-zinc-900">{userSyncProgress.toLocaleString()}</div>
                <div className="mt-1 text-sm text-zinc-500">games processed</div>

                {(isUserSyncing || isGenerating) && (
                  <div className="mt-4">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className={`h-2.5 rounded-full transition-all duration-500 ${
                          isGenerating
                            ? "bg-gradient-to-r from-emerald-500 to-emerald-600"
                            : importPhase === "saving" 
                            ? "bg-gradient-to-r from-amber-500 to-amber-600" 
                            : "bg-gradient-to-r from-blue-500 to-blue-600"
                        }`}
                        style={{ 
                          width: isGenerating
                            ? "92%"
                            : importPhase === "saving" 
                              ? `${Math.min(90, Math.max(60, 90 - (pendingWrites / 10)))}%`
                              : `${Math.min(60, Math.max(5, (userSyncProgress / Math.max(1, scanMaxGames ?? 1000)) * 60))}%` 
                        }}
                      />
                    </div>
                    <div className="mt-3 text-xs text-zinc-500">
                      {isGenerating
                        ? "Generating Scout report..."
                        : importPhase === "saving" 
                        ? pendingWrites > 0 
                          ? `Saving to database... (${pendingWrites} batches remaining)`
                          : "Finishing up..."
                        : userSyncProgress < 100 
                          ? "Downloading games... this usually takes 1-2 minutes."
                          : userSyncProgress < 500
                            ? "Making great progress! Your profile is taking shape."
                            : "Impressive game history! Almost there."}
                    </div>

                    <div className="mt-4 mx-auto max-w-md text-left">
                      <div className="space-y-1 text-sm">
                        <div className={`${isUserSyncing && importPhase !== "saving" ? "text-zinc-900 font-medium" : "text-zinc-500"}`}>
                          Downloading games
                        </div>
                        <div className={`${importPhase === "saving" || pendingWrites > 0 ? "text-zinc-900 font-medium" : "text-zinc-500"}`}>
                          Saving games to database
                        </div>
                        <div className={`${!isUserSyncing && !isGenerating && userSyncProgress >= MIN_GAMES_FOR_PROFILE ? "text-zinc-900 font-medium" : "text-zinc-500"}`}>
                          Preparing your Scout report
                        </div>
                        <div className={`${isGenerating ? "text-zinc-900 font-medium" : "text-zinc-500"}`}>
                          Generating your Scout report
                        </div>
                      </div>
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

              {/* Encouraging message while syncing */}
              {(isUserSyncing || isGenerating) && (
                <p className="text-xs text-zinc-400 mt-4">
                  Please keep this window open. The sync will complete automatically.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
