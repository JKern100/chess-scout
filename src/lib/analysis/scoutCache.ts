/**
 * Scout prediction cache using IndexedDB.
 * 
 * Caches Scout API predictions to avoid redundant API calls
 * for the same position+opponent+mode combination.
 * 
 * Uses the shared analysis DB from analysisCache.ts
 */

import { getAnalysisDb, type ScoutPredictionEntry, type AnalysisCacheSchema } from './analysisCache';
import type { IDBPDatabase } from 'idb';

const STORE_NAME = 'scout_predictions';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const MAX_ENTRIES = 5000;

/**
 * Generate cache key for a Scout prediction request.
 */
export function getScoutCacheKey(params: {
  fen: string;
  opponentUsername: string;
  mode: string;
  isOpponentTurn?: boolean;
}): string {
  const fenKey = params.fen.trim();
  const oppKey = params.opponentUsername.trim().toLowerCase();
  const modeKey = params.mode || 'hybrid';
  const turnKey = params.isOpponentTurn ? 'opp' : 'self';
  return `${fenKey}|${oppKey}|${modeKey}|${turnKey}`;
}

/**
 * Get cached Scout prediction.
 */
export async function getCachedScoutPrediction(key: string): Promise<any | null> {
  try {
    const db = await getAnalysisDb();
    const entry = await db.get(STORE_NAME, key);
    
    if (!entry) return null;
    
    // Check TTL
    const age = Date.now() - entry.cachedAt;
    if (age > CACHE_TTL_MS) {
      // Expired - delete and return null
      await db.delete(STORE_NAME, key).catch(() => {});
      return null;
    }
    
    return entry.prediction;
  } catch {
    return null;
  }
}

/**
 * Cache a Scout prediction.
 */
export async function cacheScoutPrediction(key: string, prediction: any): Promise<void> {
  try {
    const db = await getAnalysisDb();
    
    const entry: ScoutPredictionEntry = {
      key,
      prediction,
      cachedAt: Date.now(),
    };
    
    await db.put(STORE_NAME, entry);
    
    // Cleanup old entries if too many
    void pruneOldEntries(db);
  } catch {
    // Ignore cache errors
  }
}

/**
 * Prune old cache entries to stay under MAX_ENTRIES.
 */
async function pruneOldEntries(db: IDBPDatabase<AnalysisCacheSchema>): Promise<void> {
  try {
    const count = await db.count(STORE_NAME);
    if (count <= MAX_ENTRIES) return;
    
    // Delete oldest entries
    const deleteCount = count - MAX_ENTRIES + 100; // Delete extra to avoid frequent pruning
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const index = tx.store.index('by_cached_at');
    
    let deleted = 0;
    for await (const cursor of index.iterate()) {
      if (deleted >= deleteCount) break;
      await cursor.delete();
      deleted++;
    }
    
    await tx.done;
  } catch {
    // Ignore prune errors
  }
}

/**
 * Clear all Scout prediction cache.
 */
export async function clearScoutCache(): Promise<void> {
  try {
    const db = await getAnalysisDb();
    await db.clear(STORE_NAME);
  } catch {
    // Ignore clear errors
  }
}

/**
 * Get cache statistics.
 */
export async function getScoutCacheStats(): Promise<{
  entryCount: number;
  oldestEntryAge: number | null;
}> {
  try {
    const db = await getAnalysisDb();
    const count = await db.count(STORE_NAME);
    
    if (count === 0) {
      return { entryCount: 0, oldestEntryAge: null };
    }
    
    const tx = db.transaction(STORE_NAME, 'readonly');
    const index = tx.store.index('by_cached_at');
    const cursor = await index.openCursor();
    
    const oldestAge = cursor ? Date.now() - cursor.value.cachedAt : null;
    
    return { entryCount: count, oldestEntryAge: oldestAge };
  } catch {
    return { entryCount: 0, oldestEntryAge: null };
  }
}
