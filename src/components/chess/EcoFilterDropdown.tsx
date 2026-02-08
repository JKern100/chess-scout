"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { getDistinctEcos, type EcoEntry } from "@/lib/analysis/analysisCache";

type Props = {
  platform: string;
  opponentUsername: string;
  opponentColor: "w" | "b";
  selectedEco: string | null;
  selectedEcoName: string | null;
  onSelect: (eco: string | null, ecoName: string | null) => void;
};

/**
 * Fetch ECOs from the server API (extracts from PGN headers in the games table).
 * Works immediately on first visit — no IndexedDB sync needed.
 */
async function fetchEcosFromApi(
  platform: string,
  username: string,
  opponentColor: "w" | "b"
): Promise<EcoEntry[]> {
  const res = await fetch(
    `/api/games/ecos?platform=${encodeURIComponent(platform)}&username=${encodeURIComponent(username)}`
  );
  if (!res.ok) return [];
  const json = await res.json();
  const raw: Array<{ eco: string; eco_name: string; opponent_color: string; count: number }> =
    json.ecos ?? [];

  // Filter by color and merge into EcoEntry shape
  const counts = new Map<string, EcoEntry>();
  for (const r of raw) {
    if (r.opponent_color !== opponentColor) continue;
    const key = `${r.eco}|${r.eco_name}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += r.count;
    } else {
      counts.set(key, { eco: r.eco, name: r.eco_name, count: r.count });
    }
  }
  return Array.from(counts.values()).sort((a, b) => a.eco.localeCompare(b.eco));
}

export function EcoFilterDropdown({
  platform,
  opponentUsername,
  opponentColor,
  selectedEco,
  selectedEcoName,
  onSelect,
}: Props) {
  const [ecos, setEcos] = useState<EcoEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const lastFetchKey = useRef("");

  // Fetch ECOs from API (primary) with IndexedDB upgrade when available
  const fetchEcos = useCallback(async () => {
    if (!opponentUsername) return;

    const fetchKey = `${platform}_${opponentUsername.toLowerCase()}_${opponentColor}`;
    if (fetchKey === lastFetchKey.current) return;
    lastFetchKey.current = fetchKey;

    setLoading(true);

    try {
      // Primary source: API endpoint (reads from Supabase games table PGN headers)
      const apiEntries = await fetchEcosFromApi(platform, opponentUsername, opponentColor);
      if (apiEntries.length > 0) {
        setEcos(apiEntries);
        setLoading(false);
        return;
      }

      // Secondary: try IndexedDB (may have data from a previous sync)
      try {
        // Need visitorId for IndexedDB — get from supabase
        const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
        const supabase = createSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          const visitorKey = `${user.id}_${platform}_${opponentUsername.toLowerCase()}`;
          const idbEntries = await getDistinctEcos({ visitorKey, opponentColor });
          if (idbEntries.length > 0) {
            setEcos(idbEntries);
            setLoading(false);
            return;
          }
        }
      } catch {
        // IndexedDB not available — that's fine
      }

      setEcos([]);
    } catch {
      setEcos([]);
    } finally {
      setLoading(false);
    }
  }, [platform, opponentUsername, opponentColor]);

  useEffect(() => {
    void fetchEcos();
  }, [fetchEcos]);

  // When the ECO list loads, snap the selection to the matching entry.
  // Match by ECO code first (name may differ between API and eco_index.json).
  // If the selected ECO code doesn't exist at all in the list, clear the selection.
  useEffect(() => {
    if (!selectedEco) return;
    if (ecos.length === 0) return; // still loading or truly empty
    // Exact match (eco + name)
    const exact = ecos.find((e) => e.eco === selectedEco && e.name === selectedEcoName);
    if (exact) return; // already in sync
    // Fuzzy match: same ECO code, different name variant
    const byCode = ecos.find((e) => e.eco === selectedEco);
    if (byCode) {
      // Snap to the name the dropdown actually has
      onSelect(byCode.eco, byCode.name);
    } else {
      // ECO code not present for this color — clear
      onSelect(null, null);
    }
  }, [ecos, selectedEco, selectedEcoName, loading, onSelect]);

  const value = selectedEco ? `${selectedEco}|${selectedEcoName ?? ""}` : "";

  return (
    <div className="grid gap-1">
      <div className="text-[10px] font-medium text-zinc-900">Opening</div>
      <select
        className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[11px] text-zinc-900 outline-none focus:border-zinc-400"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) {
            onSelect(null, null);
          } else {
            const [eco, ...rest] = v.split("|");
            onSelect(eco, rest.join("|") || null);
          }
        }}
        disabled={loading && ecos.length === 0}
      >
        <option value="">All openings</option>
        {ecos.map((e) => {
          const key = `${e.eco}|${e.name}`;
          const label = e.name !== e.eco ? `${e.eco} — ${e.name}` : e.eco;
          return (
            <option key={key} value={key}>
              {label} ({e.count})
            </option>
          );
        })}
      </select>
      {loading && ecos.length === 0 && (
        <div className="text-[9px] text-zinc-400">Loading openings…</div>
      )}
    </div>
  );
}
