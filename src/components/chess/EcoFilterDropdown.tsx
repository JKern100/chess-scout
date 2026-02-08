"use client";

import { useEffect, useState, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getDistinctEcos, type EcoEntry } from "@/lib/analysis/analysisCache";

type Props = {
  platform: string;
  opponentUsername: string;
  opponentColor: "w" | "b";
  selectedEco: string | null;
  selectedEcoName: string | null;
  onSelect: (eco: string | null, ecoName: string | null) => void;
};

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
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const lastFetchKey = useRef("");

  // Fetch user ID on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!cancelled && user?.id) setVisitorId(user.id);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch distinct ECOs when visitor, opponent, or color changes
  useEffect(() => {
    if (!visitorId || !opponentUsername) return;

    const visitorKey = `${visitorId}_${platform}_${opponentUsername.toLowerCase()}`;
    const fetchKey = `${visitorKey}_${opponentColor}`;

    if (fetchKey === lastFetchKey.current) return;
    lastFetchKey.current = fetchKey;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const entries = await getDistinctEcos({
          visitorKey,
          opponentColor,
        });
        if (!cancelled) setEcos(entries);
      } catch {
        if (!cancelled) setEcos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visitorId, platform, opponentUsername, opponentColor]);

  // Reset selection when color changes if the selected ECO is no longer available
  useEffect(() => {
    if (!selectedEco) return;
    if (ecos.length === 0 && !loading) return;
    const found = ecos.find((e) => e.eco === selectedEco && e.name === selectedEcoName);
    if (!found && ecos.length > 0) {
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
      {!loading && ecos.length === 0 && (
        <div className="text-[9px] text-zinc-400">No ECO data yet — re-import to populate</div>
      )}
    </div>
  );
}
