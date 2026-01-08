"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AccountOnboardingModal } from "@/components/account/AccountOnboardingModal";
import { useRouter, usePathname } from "next/navigation";

type Platform = "lichess" | "chesscom";

type ProfileData = {
  primary_platform: Platform;
  platform_username: string;
  display_name: string;
  onboarding_completed: boolean;
  user_games_imported_count: number;
  user_profile_generated_at: string | null;
  is_pro: boolean;
};

type OnboardingContextValue = {
  isOnboardingComplete: boolean;
  profile: ProfileData | null;
  isLoading: boolean;
  showOnboardingModal: () => void;
  hideOnboardingModal: () => void;
  refreshProfile: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

const ONBOARDING_STARTED_KEY = "chess_scout_onboarding_started";

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [hasCheckedOnboarding, setHasCheckedOnboarding] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Check if onboarding was already started in this session (persists across navigation)
  const isOnboardingStarted = typeof window !== "undefined" && window.localStorage.getItem(ONBOARDING_STARTED_KEY) === "true";

  const fetchProfile = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user?.id) {
        setProfile(null);
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "primary_platform, platform_username, display_name, onboarding_completed, user_games_imported_count, user_profile_generated_at, is_pro"
        )
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        // 42P01 = table doesn't exist
        // Column doesn't exist errors
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          // Table or column doesn't exist - need migration
          console.warn("Profiles table needs migration for onboarding columns");
          setProfile(null);
        } else {
          console.error("Error fetching profile:", error);
          setProfile(null);
        }
      } else if (data) {
        setProfile({
          primary_platform: data.primary_platform || "lichess",
          platform_username: data.platform_username || "",
          display_name: data.display_name || "",
          onboarding_completed: Boolean(data.onboarding_completed),
          user_games_imported_count: Number(data.user_games_imported_count) || 0,
          user_profile_generated_at: data.user_profile_generated_at || null,
          is_pro: Boolean((data as any).is_pro),
        });
      } else {
        // No row found (new user) - treat as needing onboarding.
        setProfile(null);
      }
    } catch (err) {
      console.error("Error in fetchProfile:", err);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  // Auto-show onboarding modal for new users (only on authenticated pages)
  useEffect(() => {
    if (isLoading || hasCheckedOnboarding) return;
    
    // Skip onboarding check on landing page and auth pages
    if (pathname === "/" || pathname.startsWith("/auth")) {
      setHasCheckedOnboarding(true);
      return;
    }

    // If onboarding was already started in this session, don't show again
    // (user navigated away during import - let them browse freely)
    if (isOnboardingStarted) {
      setHasCheckedOnboarding(true);
      return;
    }

    // Check if user needs onboarding
    const needsOnboarding = !profile || !profile.onboarding_completed || !profile.platform_username;
    
    if (needsOnboarding) {
      setModalOpen(true);
      // Mark onboarding as started so it doesn't pop up again during navigation
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ONBOARDING_STARTED_KEY, "true");
      }
    }
    
    setHasCheckedOnboarding(true);
  }, [isLoading, profile, pathname, hasCheckedOnboarding, isOnboardingStarted]);

  const showOnboardingModal = useCallback(() => {
    setModalOpen(true);
  }, []);

  const hideOnboardingModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setModalOpen(false);
    void fetchProfile();
    
    // Clear the "onboarding started" flag since it's now complete
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ONBOARDING_STARTED_KEY);
    }
    
    // Navigate to user's own profile page
    if (profile?.platform_username) {
      router.push(`/opponents/${profile.primary_platform}/${encodeURIComponent(profile.platform_username)}/profile`);
    }
  }, [fetchProfile, profile, router]);

  const isOnboardingComplete = useMemo(() => {
    return Boolean(profile?.onboarding_completed && profile?.platform_username);
  }, [profile]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      isOnboardingComplete,
      profile,
      isLoading,
      showOnboardingModal,
      hideOnboardingModal,
      refreshProfile: fetchProfile,
    }),
    [isOnboardingComplete, profile, isLoading, showOnboardingModal, hideOnboardingModal, fetchProfile]
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      <AccountOnboardingModal
        isOpen={modalOpen}
        onClose={hideOnboardingModal}
        onComplete={handleOnboardingComplete}
        initialProfile={profile}
      />
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return ctx;
}
