"use client";

import { useEffect, useState } from "react";

type ChessPlatform = "lichess" | "chesscom";

type Profile = {
  id: string;
  chess_platform: ChessPlatform;
  chess_username: string | null;
  is_pro: boolean;
  analyses_remaining: number;
};

type Props = {
  initialProfile: Profile | null;
};

export function ConnectAccountPanel({ initialProfile }: Props) {
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [platform, setPlatform] = useState<ChessPlatform>(
    initialProfile?.chess_platform ?? "lichess"
  );
  const [username, setUsername] = useState<string>(initialProfile?.chess_username ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setProfile(initialProfile);
    setPlatform(initialProfile?.chess_platform ?? "lichess");
    setUsername(initialProfile?.chess_username ?? "");
  }, [initialProfile]);

  async function save() {
    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          chess_platform: platform,
          chess_username: username,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to save profile");
      }

      setProfile(json.profile);
      setStatus("Saved.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-medium text-zinc-900">Connect your account</div>
          <div className="mt-1 text-sm text-zinc-600">
            This is the username we’ll use to fetch your games.
          </div>
        </div>
        <div className="rounded-xl bg-zinc-50 px-3 py-2 text-right">
          <div className="text-xs text-zinc-500">Analyses remaining</div>
          <div className="text-base font-semibold text-zinc-900">
            {profile?.analyses_remaining ?? 5}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-900" htmlFor="platform">
            Platform
          </label>
          <select
            id="platform"
            className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as ChessPlatform)}
          >
            <option value="lichess">Lichess</option>
            <option value="chesscom">Chess.com</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-900" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={platform === "lichess" ? "lichess_username" : "chesscom_username"}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-zinc-600">
          {profile?.chess_username ? (
            <span>
              Connected: <span className="font-medium text-zinc-900">{profile.chess_platform}</span>
              {" / "}
              <span className="font-medium text-zinc-900">{profile.chess_username}</span>
            </span>
          ) : (
            <span>Not connected yet.</span>
          )}
        </div>

        <button
          type="button"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          disabled={loading || !username.trim()}
          onClick={save}
        >
          Save
        </button>
      </div>

      {status ? <div className="text-sm text-zinc-600">{status}</div> : null}
    </div>
  );
}
