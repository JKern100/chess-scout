/**
 * IndexedDB cache for Analysis data.
 * 
 * Stores opening traces (positionKey + moveUci) per game for fast date filtering
 * without requiring chess.js replay.
 * 
 * Schema:
 * - analysis_games: Per-game metadata + opening trace (first N plies)
 * - analysis_sync_cursors: Delta sync tracking per opponent
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DB_NAME = 'chess_scout_analysis';
const DB_VERSION = 3; // Bumped for eco/ecoName fields on CachedGame
const MAX_OPENING_PLIES = 20; // Store first 20 plies (10 moves) per game

export { MAX_OPENING_PLIES };

/**
 * Opening trace entry: position + move played at that position
 */
export interface OpeningTraceEntry {
  ply: number;           // 0-indexed ply number
  positionKey: string;   // Normalized FEN (first 4 fields)
  moveUci: string;       // UCI move (e.g., "e2e4", "g1f3")
  isOpponentMove: boolean; // True if opponent played this move
}

/**
 * Cached game with opening trace for fast date filtering
 */
export interface CachedGame {
  id: string;                    // platform_game_id (primary key)
  visitorKey: string;            // ${visitorId}_${platform}_${opponent}
  platform: string;
  opponent: string;              // lowercase username
  playedAt: string;              // ISO timestamp
  speed: string | null;          // "bullet" | "blitz" | "rapid" | "classical" | null
  rated: boolean | null;
  result: string;                // "1-0" | "0-1" | "1/2-1/2" | "*"
  opponentColor: 'w' | 'b';      // Which color the opponent played
  eco: string | null;              // ECO code (e.g., "A10", "B27")
  ecoName: string | null;          // ECO opening name (e.g., "English Opening")
  openingTrace: OpeningTraceEntry[]; // First N plies with position keys
}

/**
 * Sync cursor for delta fetching
 */
export interface SyncCursor {
  key: string;                   // ${visitorId}_${platform}_${opponent}
  lastSyncedAt: string;          // ISO timestamp
  gamesCount: number;            // Total games cached
  schemaVersion: number;         // For cache invalidation on schema changes
}

/**
 * Scout prediction cache entry
 */
export interface ScoutPredictionEntry {
  key: string; // fen_opponent_mode_turn
  prediction: any;
  cachedAt: number;
}

interface AnalysisCacheSchema extends DBSchema {
  analysis_games: {
    key: string;
    value: CachedGame;
    indexes: {
      'by_visitor': string;
      'by_visitor_date': [string, string];
    };
  };
  analysis_sync_cursors: {
    key: string;
    value: SyncCursor;
  };
  scout_predictions: {
    key: string;
    value: ScoutPredictionEntry;
    indexes: {
      'by_cached_at': number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<AnalysisCacheSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<AnalysisCacheSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<AnalysisCacheSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // Games store with indexes for filtering
        if (!db.objectStoreNames.contains('analysis_games')) {
          const gamesStore = db.createObjectStore('analysis_games', { keyPath: 'id' });
          gamesStore.createIndex('by_visitor', 'visitorKey');
          gamesStore.createIndex('by_visitor_date', ['visitorKey', 'playedAt']);
        }
        
        // Sync cursors store
        if (!db.objectStoreNames.contains('analysis_sync_cursors')) {
          db.createObjectStore('analysis_sync_cursors', { keyPath: 'key' });
        }
        
        // Scout predictions cache store (added in v2)
        if (!db.objectStoreNames.contains('scout_predictions')) {
          const scoutStore = db.createObjectStore('scout_predictions', { keyPath: 'key' });
          scoutStore.createIndex('by_cached_at', 'cachedAt');
        }

        // v3: eco/ecoName fields added to CachedGame.
        // Clear games + sync cursors so next import re-populates with ECO data.
        if (oldVersion < 3 && oldVersion > 0) {
          try {
            transaction.objectStore('analysis_games').clear();
            transaction.objectStore('analysis_sync_cursors').clear();
          } catch {
            // Best-effort: if clearing fails, data will be overwritten on next import
          }
        }
      },
    });
  }
  return dbPromise;
}

// Export getDb for use by scoutCache
export { getDb as getAnalysisDb, type AnalysisCacheSchema };

/**
 * Get sync cursor for an opponent
 */
export async function getSyncCursor(visitorKey: string): Promise<SyncCursor | null> {
  const db = await getDb();
  const cursor = await db.get('analysis_sync_cursors', visitorKey);
  return cursor ?? null;
}

/**
 * Update sync cursor after successful sync
 */
export async function updateSyncCursor(cursor: SyncCursor): Promise<void> {
  const db = await getDb();
  await db.put('analysis_sync_cursors', cursor);
}

/**
 * Store or update cached games (batch upsert)
 */
export async function upsertCachedGames(games: CachedGame[]): Promise<void> {
  if (games.length === 0) return;
  
  const db = await getDb();
  const tx = db.transaction('analysis_games', 'readwrite');
  const store = tx.objectStore('analysis_games');
  
  await Promise.all(games.map(game => store.put(game)));
  await tx.done;
}

/**
 * Get all cached games for an opponent (optionally filtered by date)
 */
export async function getCachedGames(params: {
  visitorKey: string;
  from?: string | null;
  to?: string | null;
}): Promise<CachedGame[]> {
  const db = await getDb();
  const tx = db.transaction('analysis_games', 'readonly');
  const index = tx.objectStore('analysis_games').index('by_visitor_date');
  
  const { visitorKey, from, to } = params;
  
  // Build range based on date filters
  let range: IDBKeyRange | undefined;
  if (from && to) {
    range = IDBKeyRange.bound([visitorKey, from], [visitorKey, to]);
  } else if (from) {
    range = IDBKeyRange.lowerBound([visitorKey, from]);
  } else if (to) {
    range = IDBKeyRange.upperBound([visitorKey, to]);
  } else {
    range = IDBKeyRange.bound([visitorKey, ''], [visitorKey, '\uffff']);
  }
  
  const games: CachedGame[] = [];
  let cursor = await index.openCursor(range);
  
  while (cursor) {
    const game = cursor.value as CachedGame;
    if (game.visitorKey === visitorKey) {
      games.push(game);
    }
    cursor = await cursor.continue();
  }
  
  return games;
}

/**
 * Get count of cached games for an opponent
 */
export async function getCachedGamesCount(visitorKey: string): Promise<number> {
  const db = await getDb();
  const tx = db.transaction('analysis_games', 'readonly');
  const index = tx.objectStore('analysis_games').index('by_visitor');
  return index.count(visitorKey);
}

/**
 * Clear all cached games for an opponent (for re-sync)
 */
export async function clearCachedGames(visitorKey: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['analysis_games', 'analysis_sync_cursors'], 'readwrite');
  
  // Clear games
  const gamesStore = tx.objectStore('analysis_games');
  const index = gamesStore.index('by_visitor');
  let cursor = await index.openCursor(visitorKey);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  
  // Clear cursor
  await tx.objectStore('analysis_sync_cursors').delete(visitorKey);
  
  await tx.done;
}

/**
 * Build aggregated move stats from cached games with opening traces.
 * This is the fast path for date filtering - no chess.js replay needed.
 * 
 * @returns Map<positionKey, { opponent: Map<uci, stats>, against: Map<uci, stats> }>
 */
export function buildTreeFromTraces(games: CachedGame[]): Map<string, {
  opponent: Map<string, { uci: string; count: number; win: number; loss: number; draw: number }>;
  against: Map<string, { uci: string; count: number; win: number; loss: number; draw: number }>;
}> {
  const tree = new Map<string, {
    opponent: Map<string, { uci: string; count: number; win: number; loss: number; draw: number }>;
    against: Map<string, { uci: string; count: number; win: number; loss: number; draw: number }>;
  }>();
  
  for (const game of games) {
    const result = game.result;
    const oppColor = game.opponentColor;
    
    for (const entry of game.openingTrace) {
      const { positionKey, moveUci, isOpponentMove } = entry;
      
      let pos = tree.get(positionKey);
      if (!pos) {
        pos = { opponent: new Map(), against: new Map() };
        tree.set(positionKey, pos);
      }
      
      const bucket = isOpponentMove ? pos.opponent : pos.against;
      let stats = bucket.get(moveUci);
      if (!stats) {
        stats = { uci: moveUci, count: 0, win: 0, loss: 0, draw: 0 };
        bucket.set(moveUci, stats);
      }
      
      stats.count++;
      
      // Update W/D/L from opponent's perspective
      if (result === '1/2-1/2') {
        stats.draw++;
      } else if (result === '1-0') {
        if (oppColor === 'w') stats.win++;
        else stats.loss++;
      } else if (result === '0-1') {
        if (oppColor === 'b') stats.win++;
        else stats.loss++;
      }
    }
  }
  
  return tree;
}

/**
 * Get moves for a position from a pre-built tree
 */
export function getMovesFromTree(
  tree: ReturnType<typeof buildTreeFromTraces>,
  positionKey: string,
  side: 'opponent' | 'against'
): Array<{ uci: string; count: number; win: number; loss: number; draw: number }> {
  const pos = tree.get(positionKey);
  if (!pos) return [];
  
  const bucket = side === 'opponent' ? pos.opponent : pos.against;
  return Array.from(bucket.values()).sort((a, b) => b.count - a.count);
}
