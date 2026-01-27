/**
 * Lichess Explorer API - Game Fetching
 * 
 * Fetches actual games from the Lichess Explorer API based on a position (FEN),
 * rating tier, and speed filters. Used for synthetic opponent creation.
 */

import { Chess } from "chess.js";

export type ExplorerGame = {
  id: string;
  winner: "white" | "black" | "draw" | null;
  speed: string;
  mode: string;
  white: { name: string; rating: number };
  black: { name: string; rating: number };
  year: number;
  month: string;
};

export type ExplorerGameWithPgn = ExplorerGame & {
  pgn: string;
  movesSan: string[];
  playedAt: string | null;
};

export type ExplorerResponse = {
  white: number;
  draws: number;
  black: number;
  moves: Array<{
    uci: string;
    san: string;
    white: number;
    draws: number;
    black: number;
    averageRating: number;
  }>;
  recentGames?: ExplorerGame[];
  topGames?: ExplorerGame[];
  opening?: {
    eco: string;
    name: string;
  };
};

export type FetchExplorerGamesParams = {
  fen: string;
  ratings?: string;
  speeds?: string;
  maxGames?: number;
  variant?: string;
};

/**
 * Fetch games from the Lichess Explorer API for a given position
 */
export async function fetchExplorerGames(
  params: FetchExplorerGamesParams
): Promise<{ games: ExplorerGame[]; opening: { eco: string; name: string } | null }> {
  const { fen, ratings = "1600,1800,2000,2200,2500", speeds = "blitz,rapid,classical", maxGames = 200, variant = "standard" } = params;

  const url = new URL("https://explorer.lichess.ovh/lichess");
  url.searchParams.set("fen", fen);
  url.searchParams.set("variant", variant);
  url.searchParams.set("speeds", speeds);
  url.searchParams.set("ratings", ratings);
  url.searchParams.set("recentGames", String(Math.min(maxGames, 15))); // Explorer API limits recent games
  url.searchParams.set("topGames", String(Math.min(maxGames, 4))); // Top games limited too

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lichess Explorer error (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json().catch(() => null)) as ExplorerResponse | null;
  if (!json) {
    throw new Error("Invalid response from Lichess Explorer");
  }

  const games: ExplorerGame[] = [];
  
  // Collect recent games
  if (Array.isArray(json.recentGames)) {
    games.push(...json.recentGames);
  }
  
  // Collect top games (avoid duplicates)
  if (Array.isArray(json.topGames)) {
    const existingIds = new Set(games.map(g => g.id));
    for (const game of json.topGames) {
      if (!existingIds.has(game.id)) {
        games.push(game);
      }
    }
  }

  const opening = json.opening || null;

  return { games, opening };
}

/**
 * Fetch a single game's PGN from Lichess
 */
export async function fetchGamePgn(gameId: string): Promise<string | null> {
  try {
    const url = `https://lichess.org/game/export/${gameId}?evals=0&clocks=0&opening=1`;
    const res = await fetch(url, {
      headers: { accept: "application/x-chess-pgn" },
    });

    if (!res.ok) {
      console.warn(`Failed to fetch PGN for game ${gameId}: ${res.status}`);
      return null;
    }

    return await res.text();
  } catch (e) {
    console.warn(`Error fetching PGN for game ${gameId}:`, e);
    return null;
  }
}

/**
 * Fetch multiple game PGNs in batch (more efficient)
 */
export async function fetchGamePgnsBatch(gameIds: string[]): Promise<Map<string, string>> {
  if (gameIds.length === 0) return new Map();

  // Lichess allows fetching multiple games at once via POST
  const url = "https://lichess.org/api/games/export/_ids";
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/x-chess-pgn",
        "content-type": "text/plain",
      },
      body: gameIds.join(","),
    });

    if (!res.ok) {
      console.warn(`Batch PGN fetch failed: ${res.status}`);
      return new Map();
    }

    const text = await res.text();
    const pgns = text.split("\n\n\n").filter(p => p.trim());
    
    const result = new Map<string, string>();
    
    for (const pgn of pgns) {
      // Extract game ID from Site tag
      const siteMatch = pgn.match(/\[Site\s+"https:\/\/lichess\.org\/([a-zA-Z0-9]+)"\]/);
      if (siteMatch) {
        const id = siteMatch[1];
        result.set(id, pgn);
      }
    }

    return result;
  } catch (e) {
    console.warn("Error in batch PGN fetch:", e);
    return new Map();
  }
}

/**
 * Parse moves from a PGN string
 */
export function parseMovesSan(pgn: string): string[] {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn, { strict: false });
    return chess.history();
  } catch {
    // Fallback: try to extract moves from PGN text
    const moveSection = pgn.split(/\n\n/)[1] || "";
    const moves: string[] = [];
    const moveRegex = /\d+\.\s*(\S+)(?:\s+(\S+))?/g;
    let match;
    while ((match = moveRegex.exec(moveSection)) !== null) {
      if (match[1] && !match[1].includes("-")) moves.push(match[1]);
      if (match[2] && !match[2].includes("-")) moves.push(match[2]);
    }
    return moves;
  }
}

/**
 * Extract metadata from PGN
 */
export function extractPgnMetadata(pgn: string): {
  whitePlayer: string | null;
  blackPlayer: string | null;
  whiteElo: number | null;
  blackElo: number | null;
  result: "1-0" | "0-1" | "1/2-1/2" | "*";
  playedAt: string | null;
  eco: string | null;
  opening: string | null;
} {
  const getTag = (tag: string): string | null => {
    const re = new RegExp(`^\\[${tag}\\s+"([^"]*)"\\]$`, "mi");
    const m = pgn.match(re);
    return m?.[1] || null;
  };

  const whitePlayer = getTag("White");
  const blackPlayer = getTag("Black");
  const whiteEloStr = getTag("WhiteElo");
  const blackEloStr = getTag("BlackElo");
  const resultStr = getTag("Result");
  const utcDate = getTag("UTCDate");
  const utcTime = getTag("UTCTime");
  const eco = getTag("ECO");
  const opening = getTag("Opening");

  let playedAt: string | null = null;
  if (utcDate) {
    const dateStr = utcDate.replace(/\./g, "-");
    const timeStr = utcTime || "12:00:00";
    try {
      playedAt = new Date(`${dateStr}T${timeStr}Z`).toISOString();
    } catch {
      playedAt = null;
    }
  }

  return {
    whitePlayer,
    blackPlayer,
    whiteElo: whiteEloStr ? parseInt(whiteEloStr, 10) : null,
    blackElo: blackEloStr ? parseInt(blackEloStr, 10) : null,
    result: (resultStr as "1-0" | "0-1" | "1/2-1/2" | "*") || "*",
    playedAt,
    eco,
    opening,
  };
}

/**
 * Fetch games with full PGN data for a position
 * This is the main function used for synthetic opponent creation
 */
export async function fetchExplorerGamesWithPgn(
  params: FetchExplorerGamesParams,
  onProgress?: (fetched: number, total: number) => void
): Promise<ExplorerGameWithPgn[]> {
  const { games, opening } = await fetchExplorerGames(params);
  
  if (games.length === 0) {
    return [];
  }

  const gameIds = games.map(g => g.id);
  const totalGames = gameIds.length;

  // Fetch PGNs in batches
  const batchSize = 50;
  const results: ExplorerGameWithPgn[] = [];
  
  for (let i = 0; i < gameIds.length; i += batchSize) {
    const batch = gameIds.slice(i, i + batchSize);
    const pgns = await fetchGamePgnsBatch(batch);
    
    for (const game of games.slice(i, i + batchSize)) {
      const pgn = pgns.get(game.id);
      if (!pgn) continue;

      const movesSan = parseMovesSan(pgn);
      const metadata = extractPgnMetadata(pgn);

      results.push({
        ...game,
        pgn,
        movesSan,
        playedAt: metadata.playedAt,
      });
    }

    onProgress?.(Math.min(i + batchSize, totalGames), totalGames);

    // Small delay to avoid rate limiting
    if (i + batchSize < gameIds.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * Collect more games by exploring multiple moves from the starting position
 * This helps gather more games when the direct position has limited games
 */
export async function fetchExpandedExplorerGames(
  params: FetchExplorerGamesParams & { targetGames?: number },
  onProgress?: (fetched: number, total: number, status: string) => void
): Promise<ExplorerGameWithPgn[]> {
  const { fen, ratings, speeds, targetGames = 200 } = params;
  
  const allGames = new Map<string, ExplorerGameWithPgn>();
  const visitedFens = new Set<string>();
  const fenQueue: string[] = [fen];

  let iteration = 0;
  const maxIterations = 30; // Increased to explore more positions

  while (fenQueue.length > 0 && allGames.size < targetGames && iteration < maxIterations) {
    iteration++;
    const currentFen = fenQueue.shift()!;
    
    if (visitedFens.has(currentFen)) continue;
    visitedFens.add(currentFen);

    onProgress?.(allGames.size, targetGames, `Exploring position ${iteration}...`);

    try {
      // Get explorer data for this position (includes moves and games)
      const url = new URL("https://explorer.lichess.ovh/lichess");
      url.searchParams.set("fen", currentFen);
      url.searchParams.set("variant", "standard");
      url.searchParams.set("speeds", speeds || "blitz,rapid,classical");
      url.searchParams.set("ratings", ratings || "1600,1800,2000,2200,2500");
      url.searchParams.set("recentGames", "15");
      url.searchParams.set("topGames", "4");

      const res = await fetch(url.toString(), {
        headers: { accept: "application/json" },
      });

      if (!res.ok) continue;

      const data = await res.json() as ExplorerResponse;
      
      // Collect games from this position
      const positionGames: ExplorerGame[] = [];
      if (Array.isArray(data.recentGames)) {
        positionGames.push(...data.recentGames);
      }
      if (Array.isArray(data.topGames)) {
        const existingIds = new Set(positionGames.map(g => g.id));
        for (const game of data.topGames) {
          if (!existingIds.has(game.id)) {
            positionGames.push(game);
          }
        }
      }

      // Fetch PGNs for new games
      const newGameIds = positionGames
        .filter(g => !allGames.has(g.id))
        .map(g => g.id);

      if (newGameIds.length > 0) {
        const pgns = await fetchGamePgnsBatch(newGameIds);
        
        for (const game of positionGames) {
          if (allGames.has(game.id)) continue;
          const pgn = pgns.get(game.id);
          if (!pgn) continue;

          const movesSan = parseMovesSan(pgn);
          const metadata = extractPgnMetadata(pgn);

          allGames.set(game.id, {
            ...game,
            pgn,
            movesSan,
            playedAt: metadata.playedAt,
          });
        }
      }

      // Add continuation moves to queue (explore deeper into the tree)
      const topMoves = (data.moves || []).slice(0, 5); // Explore top 5 moves
      for (const move of topMoves) {
        try {
          const chess = new Chess(currentFen);
          chess.move(move.san);
          const nextFen = chess.fen();
          if (!visitedFens.has(nextFen)) {
            fenQueue.push(nextFen);
          }
        } catch {
          // Invalid move, skip
        }
      }
    } catch (e) {
      console.warn(`Error exploring position: ${e}`);
    }

    // Rate limiting - Lichess Explorer allows ~15 req/min for anonymous
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  onProgress?.(allGames.size, targetGames, "Complete");

  return Array.from(allGames.values());
}
