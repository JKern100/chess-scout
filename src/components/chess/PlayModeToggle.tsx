"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Mode = "simulation" | "analysis";

export function PlayModeToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const modeParam = searchParams.get("mode");
  const mode: Mode = modeParam === "analysis" || modeParam === "simulation" ? modeParam : "analysis";

  const setMode = useCallback(
    (next: Mode) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("mode", next);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  return (
    <div className="inline-flex overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <button
        type="button"
        className={`h-8 px-3 text-[10px] font-medium ${
          mode === "analysis" ? "bg-zinc-900 text-white" : "text-zinc-900 hover:bg-zinc-50"
        }`}
        onClick={() => setMode("analysis")}
      >
        Analysis
      </button>
      <button
        type="button"
        className={`h-8 px-3 text-[10px] font-medium ${
          mode === "simulation" ? "bg-zinc-900 text-white" : "text-zinc-900 hover:bg-zinc-50"
        }`}
        onClick={() => setMode("simulation")}
      >
        Game Simulation
      </button>
    </div>
  );
}
