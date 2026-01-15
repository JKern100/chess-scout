"use client";

import { useState } from "react";
import { X, Search } from "lucide-react";
import { PlatformLogo } from "@/components/PlatformLogo";

type ChessPlatform = "lichess" | "chesscom";

type ScanDepthOption = {
  value: number | null;
  label: string;
  description: string;
  disabled: boolean;
};

const SCAN_DEPTH_OPTIONS: ScanDepthOption[] = [
  { value: 100, label: "Most recent 100 Games", description: "", disabled: false },
  { value: 200, label: "Most recent 200 Games", description: "", disabled: false },
  { value: 500, label: "Most recent 500 Games", description: "", disabled: true },
  { value: null, label: "Custom and Unlimited Games", description: "", disabled: true },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onAdd: (platform: ChessPlatform, username: string, maxGames: number | null) => Promise<void>;
  loading: boolean;
};

export function AddPlayerModal({ open, onClose, onAdd, loading }: Props) {
  const [platform, setPlatform] = useState<ChessPlatform>("lichess");
  const [username, setUsername] = useState("");
  const [scanDepth, setScanDepth] = useState<number | null>(200);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;
    await onAdd(platform, trimmed, scanDepth);
    setUsername("");
    setScanDepth(200);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">Add Player to Track</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* Platform Toggle */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700">Platform</label>
            <div className="flex h-10 items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
              <button
                type="button"
                className={`h-full flex-1 rounded-md px-3 text-sm font-medium transition-colors ${
                  platform === "lichess"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
                onClick={() => setPlatform("lichess")}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <PlatformLogo platform="lichess" size={16} className={platform === "lichess" ? "opacity-90" : "opacity-70"} />
                  <span>Lichess</span>
                </span>
              </button>
              <button
                type="button"
                className={`h-full flex-1 rounded-md px-3 text-sm font-medium transition-colors ${
                  platform === "chesscom"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
                onClick={() => setPlatform("chesscom")}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <PlatformLogo platform="chesscom" size={16} className={platform === "chesscom" ? "opacity-90" : "opacity-70"} />
                  <span>Chess.com</span>
                </span>
              </button>
            </div>
          </div>

          {/* Username Input */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700">Username</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter player username..."
                className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-100"
                disabled={loading}
                autoFocus
              />
            </div>
          </div>

          {/* Scan Depth Options */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700">Games to Sync</label>
            <div className="grid grid-cols-2 gap-2">
              {SCAN_DEPTH_OPTIONS.map((opt) => {
                const isSelected = scanDepth === opt.value;
                const isDefault = opt.value === 200;
                return (
                  <button
                    key={opt.value ?? "unlimited"}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => setScanDepth(opt.value)}
                    className={`relative flex flex-col items-center justify-center rounded-xl border-2 px-3 py-3 text-center transition-all ${
                      opt.disabled
                        ? "cursor-not-allowed border-zinc-100 bg-zinc-50 opacity-50"
                        : isSelected
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300"
                    }`}
                  >
                    <span className={`text-sm font-medium ${isSelected ? "text-white" : "text-zinc-900"}`}>
                      {opt.label}
                    </span>
                    {isDefault && !isSelected && (
                      <span className="mt-1 text-[10px] font-medium text-zinc-500">Default</span>
                    )}
                    {isDefault && isSelected && (
                      <span className="mt-1 text-[10px] font-medium text-zinc-300">Default</span>
                    )}
                    {opt.disabled && (
                      <span className="mt-1 text-[10px] font-medium text-zinc-400">Coming Soon</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !username.trim()}
              className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading ? "Adding..." : "Add Player"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
