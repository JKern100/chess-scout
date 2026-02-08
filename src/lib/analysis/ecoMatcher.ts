/**
 * Shared ECO matching logic.
 * 
 * Matches a game's SAN move sequence to the longest matching ECO entry.
 * Used by both the import worker (to tag cached games) and the server profile builder.
 */

import ecoIndexRaw from "@/server/openings/eco_index.json";

type EcoEntry = {
  eco: string;
  name: string;
  moves_san: string[];
};

function normalizeEcoIndex(raw: any): EcoEntry[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((e: any) => ({
      eco: String(e?.eco ?? ""),
      name: String(e?.name ?? ""),
      moves_san: Array.isArray(e?.moves_san) ? e.moves_san.map((m: any) => String(m)) : [],
    }))
    .filter((e: EcoEntry) => e.eco && e.name && e.moves_san.length > 0);
}

const ECO_INDEX: EcoEntry[] = normalizeEcoIndex(ecoIndexRaw);

/**
 * Match a game's SAN moves to the longest matching ECO entry.
 * @param movesSan - Array of SAN moves from the game
 * @param maxPly - Maximum number of plies to consider (default: 24)
 * @returns { eco, name } of the best matching ECO entry
 */
export function matchEco(movesSan: string[], maxPly = 24): { eco: string | null; name: string } {
  const sample = movesSan.slice(0, Math.max(0, maxPly));
  let best: EcoEntry | null = null;
  for (const entry of ECO_INDEX) {
    const m = entry.moves_san;
    if (m.length > sample.length) continue;
    let ok = true;
    for (let i = 0; i < m.length; i += 1) {
      if (sample[i] !== m[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (!best || m.length > best.moves_san.length) best = entry;
  }
  if (!best) {
    return { eco: null, name: "Unknown" };
  }
  return { eco: best.eco, name: best.name };
}
