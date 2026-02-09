/**
 * Repopulates IndexedDB cache from server-side game data.
 *
 * When IndexedDB is cleared (e.g. schema upgrade), this fetches PGNs from
 * the games table and replays them locally to rebuild opening traces + ECO tags.
 * This avoids needing a full Lichess re-import.
 */

import { Chess } from "chess.js";
import { normalizeFen } from "@/server/opponentModel";
import { matchEco } from "@/lib/analysis/ecoMatcher";
import {
  upsertCachedGames,
  updateSyncCursor,
  type CachedGame,
  type OpeningTraceEntry,
  MAX_OPENING_PLIES,
} from "@/lib/analysis/analysisCache";

// -----------------------------------------------------------
// PGN header helpers
// -----------------------------------------------------------

function pgnHeader(pgn: string, key: string): string | null {
  const re = new RegExp(`^\\[${key}\\s+"([^"]*)"\\]`, "m");
  const m = pgn.match(re);
  return m?.[1] ?? null;
}

function inferSpeed(pgn: string): string | null {
  const tc = pgnHeader(pgn, "TimeControl");
  if (!tc) return null;
  const m = tc.match(/^(\d+)\+?(\d+)?$/);
  if (!m) return tc.includes("1/") ? "correspondence" : null;
  const base = Number(m[1]);
  const inc = Number(m[2] ?? 0);
  const est = base + inc * 40;
  if (est < 180) return "bullet";
  if (est < 480) return "blitz";
  if (est < 1500) return "rapid";
  return "classical";
}

function inferRated(pgn: string): boolean | null {
  const event = pgnHeader(pgn, "Event") ?? "";
  if (/rated/i.test(event)) return true;
  if (/casual/i.test(event)) return false;
  return null;
}

function inferResult(pgn: string): string {
  return pgnHeader(pgn, "Result") ?? "*";
}

function inferOpponentColor(pgn: string, opponentUsername: string): "w" | "b" {
  const white = (pgnHeader(pgn, "White") ?? "").trim().toLowerCase();
  const black = (pgnHeader(pgn, "Black") ?? "").trim().toLowerCase();
  const opp = opponentUsername.trim().toLowerCase();
  if (white === opp) return "w";
  if (black === opp) return "b";
  // Fallback: if opponent name doesn't match either header, assume black
  return "b";
}

function extractMovesSan(pgn: string): string[] {
  // Strip headers
  const body = pgn.replace(/^\[.*\]\s*$/gm, "").trim();
  // Remove comments and variations
  const cleaned = body.replace(/\{[^}]*\}/g, "").replace(/\([^)]*\)/g, "");
  // Extract SAN tokens (skip move numbers, results, NAGs)
  const tokens = cleaned.split(/\s+/);
  const moves: string[] = [];
  for (const t of tokens) {
    if (!t) continue;
    if (/^\d+\./.test(t)) continue; // move number
    if (t === "1-0" || t === "0-1" || t === "1/2-1/2" || t === "*") continue;
    if (t.startsWith("$")) continue; // NAG
    moves.push(t);
  }
  return moves;
}

// -----------------------------------------------------------
// Core repopulation
// -----------------------------------------------------------

export interface RepopulateProgress {
  phase: "fetching" | "processing" | "writing" | "complete" | "error";
  gamesTotal: number;
  gamesProcessed: number;
  error?: string;
}

export async function repopulateIndexedDBFromServer(params: {
  visitorId: string;
  platform: string;
  opponent: string;
  onProgress?: (p: RepopulateProgress) => void;
}): Promise<boolean> {
  const { visitorId, platform, opponent, onProgress } = params;
  const opponentLower = opponent.trim().toLowerCase();

  onProgress?.({ phase: "fetching", gamesTotal: 0, gamesProcessed: 0 });

  // Fetch PGNs from server
  let games: Array<{ id: string; played_at: string | null; pgn: string }>;
  try {
    const res = await fetch(
      `/api/games/repopulate-cache?platform=${encodeURIComponent(platform)}&username=${encodeURIComponent(opponentLower)}`
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to fetch" }));
      onProgress?.({ phase: "error", gamesTotal: 0, gamesProcessed: 0, error: err?.error ?? "Failed to fetch games" });
      return false;
    }
    const json = await res.json();
    games = Array.isArray(json?.games) ? json.games : [];
  } catch (e) {
    onProgress?.({ phase: "error", gamesTotal: 0, gamesProcessed: 0, error: e instanceof Error ? e.message : "Fetch failed" });
    return false;
  }

  if (games.length === 0) {
    onProgress?.({ phase: "complete", gamesTotal: 0, gamesProcessed: 0 });
    return false; // No games to repopulate
  }

  const visitorKey = `${visitorId}_${platform}_${opponentLower}`;
  const total = games.length;
  onProgress?.({ phase: "processing", gamesTotal: total, gamesProcessed: 0 });

  // Process PGNs in batches to avoid blocking the UI
  const cached: CachedGame[] = [];
  const BATCH = 20;

  for (let i = 0; i < games.length; i += BATCH) {
    const batch = games.slice(i, i + BATCH);

    for (const g of batch) {
      try {
        const pgn = g.pgn;
        const movesSan = extractMovesSan(pgn);
        if (movesSan.length === 0) continue;

        // Compute opening trace (first N plies)
        const chess = new Chess();
        const trace: OpeningTraceEntry[] = [];
        const oppColor = inferOpponentColor(pgn, opponentLower);

        for (let ply = 0; ply < Math.min(movesSan.length, MAX_OPENING_PLIES); ply++) {
          const positionKey = normalizeFen(chess.fen());
          const currentTurn = chess.turn(); // 'w' or 'b'
          const isOpponentMove = currentTurn === oppColor;

          try {
            const move = chess.move(movesSan[ply]);
            if (!move) break;
            const uci = move.from + move.to + (move.promotion ?? "");
            trace.push({ ply, positionKey, moveUci: uci, isOpponentMove });
          } catch {
            break; // Invalid move
          }
        }

        if (trace.length === 0) continue;

        const ecoMatch = matchEco(movesSan, 24);

        cached.push({
          id: g.id,
          visitorKey,
          platform,
          opponent: opponentLower,
          playedAt: g.played_at ?? new Date().toISOString(),
          speed: inferSpeed(pgn),
          rated: inferRated(pgn),
          result: inferResult(pgn),
          opponentColor: oppColor,
          eco: ecoMatch.eco,
          ecoName: ecoMatch.name,
          openingTrace: trace,
        });
      } catch {
        // Skip invalid games
      }
    }

    onProgress?.({ phase: "processing", gamesTotal: total, gamesProcessed: Math.min(i + BATCH, total) });

    // Yield to event loop between batches
    await new Promise((r) => setTimeout(r, 0));
  }

  // Write to IndexedDB
  onProgress?.({ phase: "writing", gamesTotal: total, gamesProcessed: total });

  try {
    await upsertCachedGames(cached);
    await updateSyncCursor({
      key: visitorKey,
      lastSyncedAt: new Date().toISOString(),
      gamesCount: cached.length,
      schemaVersion: 3,
    });
  } catch (e) {
    onProgress?.({ phase: "error", gamesTotal: total, gamesProcessed: total, error: "Failed to write to IndexedDB" });
    return false;
  }

  onProgress?.({ phase: "complete", gamesTotal: total, gamesProcessed: total });
  return cached.length > 0;
}
