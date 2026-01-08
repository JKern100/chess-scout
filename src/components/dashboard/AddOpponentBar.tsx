"use client";

import { UserPlus } from "lucide-react";

type Props = {
  onClick: () => void;
  loading: boolean;
};

export function AddOpponentBar({ onClick, loading }: Props) {
  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
      >
        <UserPlus className="h-4 w-4" />
        Add Player to Track
      </button>
    </div>
  );
}
