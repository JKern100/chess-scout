"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { PlatformLogo } from "@/components/PlatformLogo";

type Platform = "lichess" | "chesscom";

type ProfileData = {
  primary_platform: Platform;
  platform_username: string;
  display_name: string;
};

export function AccountSettings({ user }: { user: User }) {
  const [primaryPlatform, setPrimaryPlatform] = useState<Platform>("lichess");
  const [platformUsername, setPlatformUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [hasCustomDisplayName, setHasCustomDisplayName] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [dbReady, setDbReady] = useState(true);

  // Load existing profile data
  useEffect(() => {
    async function loadProfile() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("profiles")
          .select("primary_platform, platform_username, display_name")
          .eq("id", user.id)
          .single();

        // PGRST116 = no rows found (new user, no profile yet) - this is expected
        // 42P01 = relation does not exist (table not created yet)
        // Also check for "does not exist" in message for column errors
        if (error) {
          if (error.code === "PGRST116") {
            // No profile yet - that's fine
          } else if (error.code === "42P01" || error.message?.includes("does not exist")) {
            // Table or column doesn't exist - need to run migration
            setDbReady(false);
          }
          // Don't log expected errors
          return;
        }

        if (data) {
          setPrimaryPlatform(data.primary_platform || "lichess");
          setPlatformUsername(data.platform_username || "");
          setDisplayName(data.display_name || "");
          if (data.display_name && data.display_name !== data.platform_username) {
            setHasCustomDisplayName(true);
          }
        }
      } catch {
        // Silently handle
      } finally {
        setIsLoading(false);
      }
    }

    loadProfile();
  }, [user.id]);

  // Auto-sync display name with platform username unless user has customized it
  const handlePlatformUsernameChange = useCallback(
    (value: string) => {
      setPlatformUsername(value);
      if (!hasCustomDisplayName) {
        setDisplayName(value);
      }
    },
    [hasCustomDisplayName]
  );

  // Track when user manually changes display name
  const handleDisplayNameChange = useCallback(
    (value: string) => {
      setDisplayName(value);
      // If user clears the display name or sets it to match platform username, reset custom flag
      if (value === "" || value === platformUsername) {
        setHasCustomDisplayName(false);
      } else {
        setHasCustomDisplayName(true);
      }
    },
    [platformUsername]
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const profileData: ProfileData = {
        primary_platform: primaryPlatform,
        platform_username: platformUsername.trim(),
        display_name: displayName.trim() || platformUsername.trim(),
      };

      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          ...profileData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (error) {
        throw error;
      }

      setSaveMessage({ type: "success", text: "Profile saved successfully" });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      console.error("Failed to save profile:", err);
      setSaveMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save profile",
      });
    } finally {
      setIsSaving(false);
    }
  }, [user.id, primaryPlatform, platformUsername, displayName]);

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-sm text-zinc-500">Loading profile...</div>
      </div>
    );
  }

  // Show migration notice if DB isn't ready
  if (!dbReady) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900">Account Settings</h1>
          <p className="mt-1 text-sm text-zinc-600">Configure your primary chess identity</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <div className="text-sm font-medium text-amber-900">Database Setup Required</div>
          <p className="mt-2 text-xs text-amber-800">
            The profiles table needs to be created. Please run the migration script in Supabase SQL Editor:
          </p>
          <code className="mt-2 block rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
            scripts/supabase_profiles_table.sql
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-900">Account Settings</h1>
        <p className="mt-1 text-sm text-zinc-600">Configure your primary chess identity for Self-Scout reports</p>
      </div>

      {/* Primary Identity Card */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-zinc-900">Primary Identity</h2>
          <p className="mt-1 text-xs text-zinc-500">Used to generate your personal Scout report</p>
        </div>

        <div className="grid gap-5">
          {/* Platform Selection */}
          <div>
            <label className="mb-2 block text-xs font-medium text-zinc-700">Primary Platform</label>
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

          {/* Platform Username */}
          <div>
            <label htmlFor="platform-username" className="mb-2 block text-xs font-medium text-zinc-700">
              <span className="inline-flex items-center gap-2">
                <PlatformLogo platform={primaryPlatform} size={16} className="opacity-80" />
                <span>{primaryPlatform === "lichess" ? "Lichess" : "Chess.com"} Username</span>
              </span>
            </label>
            <input
              id="platform-username"
              type="text"
              value={platformUsername}
              onChange={(e) => handlePlatformUsernameChange(e.target.value)}
              placeholder={`Enter your ${primaryPlatform === "lichess" ? "Lichess" : "Chess.com"} username`}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white"
            />
          </div>

          {/* Display Name */}
          <div>
            <label htmlFor="display-name" className="mb-2 block text-xs font-medium text-zinc-700">
              Scout Display Name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => handleDisplayNameChange(e.target.value)}
              placeholder="Your display name in Chess Scout"
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white"
            />
            <p className="mt-1.5 text-xs text-zinc-500">
              {hasCustomDisplayName
                ? "Using custom display name"
                : "Automatically mirrors your platform username"}
            </p>
          </div>
        </div>

        {/* Save Button */}
        <div className="mt-6 flex items-center justify-between border-t border-zinc-100 pt-5">
          <div>
            {saveMessage && (
              <span
                className={`text-xs font-medium ${
                  saveMessage.type === "success" ? "text-green-600" : "text-red-600"
                }`}
              >
                {saveMessage.text}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !platformUsername.trim()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Syncing...
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </div>

      {/* Account Info Card */}
      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900">Account Info</h2>
        <div className="grid gap-3">
          <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3">
            <span className="text-xs font-medium text-zinc-500">Email</span>
            <span className="text-sm font-medium text-zinc-900">{user.email}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3">
            <span className="text-xs font-medium text-zinc-500">User ID</span>
            <span className="font-mono text-xs text-zinc-500">{user.id.slice(0, 8)}...</span>
          </div>
        </div>
      </div>
    </div>
  );
}
