"use client";

import { useState } from "react";
import { Search } from "lucide-react";

type ChessPlatform = "lichess" | "chesscom";

type Props = {
  onAdd: (platform: ChessPlatform, username: string) => Promise<void>;
  loading: boolean;
};

export function AddOpponentBar({ onAdd, loading }: Props) {
  const [platform, setPlatform] = useState<ChessPlatform>("lichess");
  const [username, setUsername] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;
    await onAdd(platform, trimmed);
    setUsername("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="flex h-10 items-center rounded-lg border border-neutral-200 bg-white p-0.5">
        <button
          type="button"
          className={`h-full rounded-md px-3 text-xs font-medium transition-colors ${
            platform === "lichess"
              ? "bg-neutral-900 text-white"
              : "text-neutral-600 hover:text-neutral-900"
          }`}
          onClick={() => setPlatform("lichess")}
        >
          Lichess
        </button>
        <button
          type="button"
          className={`h-full rounded-md px-3 text-xs font-medium transition-colors ${
            platform === "chesscom"
              ? "bg-neutral-900 text-white"
              : "text-neutral-600 hover:text-neutral-900"
          }`}
          onClick={() => setPlatform("chesscom")}
        >
          Chess.com
        </button>
      </div>

      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter opponent username..."
          className="h-10 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-300"
          disabled={loading}
        />
      </div>

      <button
        type="submit"
        disabled={loading || !username.trim()}
        className="h-10 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
      >
        Scout Opponent
      </button>
    </form>
  );
}
