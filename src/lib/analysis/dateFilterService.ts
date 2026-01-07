/**
 * Date Filter Refinement Service
 * 
 * Uses cached opening traces from IndexedDB to build date-filtered move stats
 * without requiring chess.js replay. This enables fast progressive refinement
 * from "All-time" to "Exact date range" in the Analysis UI.
 */

import {
  getCachedGames,
  getCachedGamesCount,
  buildTreeFromTraces,
  getMovesFromTree,
  type CachedGame,
} from './analysisCache';

export interface DateFilterParams {
  visitorId: string;
  platform: string;
  opponent: string;
  from?: string | null;  // ISO date string
  to?: string | null;    // ISO date string
  speeds?: string[] | null;
  rated?: 'any' | 'rated' | 'casual';
}

export interface MoveStats {
  uci: string;
  count: number;
  win: number;
  loss: number;
  draw: number;
}

export interface DateFilterResult {
  positionKey: string;
  side: 'opponent' | 'against';
  moves: MoveStats[];
  totalGames: number;
  filteredGames: number;
  isComplete: boolean;
}

export interface RefinementProgress {
  phase: 'idle' | 'loading' | 'building' | 'complete' | 'error';
  gamesLoaded: number;
  gamesTotal: number;
  error?: string;
}

type ProgressCallback = (progress: RefinementProgress) => void;

/**
 * Build a date-filtered tree from cached games and get moves for a position.
 * This is the fast path that avoids chess.js replay.
 */
export async function getDateFilteredMoves(params: {
  filterParams: DateFilterParams;
  positionKey: string;
  side: 'opponent' | 'against';
  onProgress?: ProgressCallback;
}): Promise<DateFilterResult> {
  const { filterParams, positionKey, side, onProgress } = params;
  
  const visitorKey = `${filterParams.visitorId}_${filterParams.platform}_${filterParams.opponent.toLowerCase()}`;
  
  // Report loading phase
  onProgress?.({
    phase: 'loading',
    gamesLoaded: 0,
    gamesTotal: 0,
  });
  
  // Get total count first
  const totalCount = await getCachedGamesCount(visitorKey);
  
  // Fetch filtered games from IndexedDB
  let games: CachedGame[];
  try {
    games = await getCachedGames({
      visitorKey,
      from: filterParams.from ?? undefined,
      to: filterParams.to ?? undefined,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Failed to load cached games';
    onProgress?.({
      phase: 'error',
      gamesLoaded: 0,
      gamesTotal: totalCount,
      error,
    });
    return {
      positionKey,
      side,
      moves: [],
      totalGames: totalCount,
      filteredGames: 0,
      isComplete: false,
    };
  }
  
  // Apply additional filters (speed, rated)
  let filteredGames = games;
  
  if (filterParams.speeds && filterParams.speeds.length > 0 && filterParams.speeds.length < 5) {
    filteredGames = filteredGames.filter(g => g.speed && filterParams.speeds!.includes(g.speed));
  }
  
  if (filterParams.rated === 'rated') {
    filteredGames = filteredGames.filter(g => g.rated === true);
  } else if (filterParams.rated === 'casual') {
    filteredGames = filteredGames.filter(g => g.rated === false);
  }
  
  onProgress?.({
    phase: 'building',
    gamesLoaded: filteredGames.length,
    gamesTotal: totalCount,
  });
  
  // Build tree from opening traces (no chess.js replay!)
  const tree = buildTreeFromTraces(filteredGames);
  
  // Get moves for the requested position
  const moves = getMovesFromTree(tree, positionKey, side);
  
  onProgress?.({
    phase: 'complete',
    gamesLoaded: filteredGames.length,
    gamesTotal: totalCount,
  });
  
  return {
    positionKey,
    side,
    moves,
    totalGames: totalCount,
    filteredGames: filteredGames.length,
    isComplete: true,
  };
}

/**
 * Check if we have cached data for an opponent that can be used for date filtering
 */
export async function hasDateFilterCache(params: {
  visitorId: string;
  platform: string;
  opponent: string;
}): Promise<{ hasCachedData: boolean; cachedGamesCount: number }> {
  const visitorKey = `${params.visitorId}_${params.platform}_${params.opponent.toLowerCase()}`;
  const count = await getCachedGamesCount(visitorKey);
  return {
    hasCachedData: count > 0,
    cachedGamesCount: count,
  };
}

/**
 * Progressive refinement: starts with all-time data, then refines to exact date range.
 * Returns an async generator that yields progress updates.
 */
export async function* progressiveRefine(params: {
  filterParams: DateFilterParams;
  positionKey: string;
  side: 'opponent' | 'against';
}): AsyncGenerator<DateFilterResult & { phase: RefinementProgress['phase'] }> {
  const { filterParams, positionKey, side } = params;
  
  // Yield loading state
  yield {
    positionKey,
    side,
    moves: [],
    totalGames: 0,
    filteredGames: 0,
    isComplete: false,
    phase: 'loading',
  };
  
  // Get the filtered result
  const result = await getDateFilteredMoves({
    filterParams,
    positionKey,
    side,
  });
  
  // Yield complete result
  yield {
    ...result,
    phase: 'complete',
  };
}
