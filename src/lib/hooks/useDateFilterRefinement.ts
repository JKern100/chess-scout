/**
 * React hook for progressive date filter refinement.
 * 
 * Shows "All-time" data instantly, then refines to exact date range
 * using cached opening traces from IndexedDB (no chess.js replay).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  getDateFilteredMoves,
  hasDateFilterCache,
  type MoveStats,
  type RefinementProgress,
} from '@/lib/analysis/dateFilterService';
import { repopulateIndexedDBFromServer } from '@/lib/analysis/cacheRepopulate';

export interface RefinementState {
  status: 'idle' | 'checking' | 'refining' | 'complete' | 'unavailable' | 'cancelled' | 'error';
  progress: RefinementProgress | null;
  refinedMoves: MoveStats[] | null;
  totalGames: number;
  filteredGames: number;
  error: string | null;
}

export interface UseDateFilterRefinementParams {
  platform: string;
  opponent: string;
  positionKey: string;
  side: 'opponent' | 'against';
  from: string | null;
  to: string | null;
  speeds: string[] | null;
  rated: 'any' | 'rated' | 'casual';
  opponentColor?: 'w' | 'b' | null; // Filter by which color opponent played
  openingEco?: string | null;  // Filter by ECO code (e.g., "A10")
  openingName?: string | null; // Filter by opening name (e.g., "English Opening")
  enabled: boolean; // Only refine when Analysis is enabled
}

export interface UseDateFilterRefinementResult {
  state: RefinementState;
  startRefinement: () => void;
  cancelRefinement: () => void;
  isRefining: boolean;
  hasRefinedData: boolean;
}

const initialState: RefinementState = {
  status: 'idle',
  progress: null,
  refinedMoves: null,
  totalGames: 0,
  filteredGames: 0,
  error: null,
};

export function useDateFilterRefinement(
  params: UseDateFilterRefinementParams
): UseDateFilterRefinementResult {
  const [state, setState] = useState<RefinementState>(initialState);
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const abortRef = useRef(false);
  const lastParamsRef = useRef<string>('');
  const repopulatingRef = useRef(false);
  
  const {
    platform,
    opponent,
    positionKey,
    side,
    from,
    to,
    speeds,
    rated,
    opponentColor,
    openingEco,
    openingName,
    enabled,
  } = params;
  
  // Fetch user ID on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!cancelled && user?.id) {
          setVisitorId(user.id);
        }
      } catch {
        // Ignore auth errors
      }
    })();
    return () => { cancelled = true; };
  }, []);
  
  const hasDateFilter = Boolean(from || to);
  const featureEnabled = isFeatureEnabled('analysis_v2_date_refine');
  
  // Always use IndexedDB when available - it's more reliable than opening_graph_nodes
  // which can have stale data. This ensures "all games" filter works correctly.
  const shouldUseIndexedDB = featureEnabled;
  
  // Generate a key for the current params to detect changes
  const paramsKey = `${visitorId}_${platform}_${opponent}_${positionKey}_${side}_${from}_${to}_${speeds?.join(',')}_${rated}_${opponentColor ?? 'any'}_${openingEco ?? ''}_${openingName ?? ''}`;
  
  // Reset state when params change
  useEffect(() => {
    if (paramsKey !== lastParamsRef.current) {
      lastParamsRef.current = paramsKey;
      abortRef.current = true; // Cancel any in-progress refinement
      setState(initialState);
    }
  }, [paramsKey]);
  
  const startRefinement: () => Promise<void> = useCallback(async () => {
    if (!visitorId || !opponent || !shouldUseIndexedDB || !enabled) {
      setState(prev => ({ ...prev, status: 'unavailable' }));
      return;
    }
    
    abortRef.current = false;
    setState(prev => ({ ...prev, status: 'checking', error: null }));
    
    // Check if we have cached data
    const cacheInfo = await hasDateFilterCache({
      visitorId,
      platform,
      opponent,
    });
    
    if (abortRef.current) {
      setState(prev => ({ ...prev, status: 'cancelled' }));
      return;
    }
    
    if (!cacheInfo.hasCachedData) {
      // Auto-repopulate IndexedDB from server-side game data
      // This handles the case where IndexedDB was cleared (e.g. schema upgrade)
      if (!repopulatingRef.current) {
        repopulatingRef.current = true;
        setState(prev => ({ ...prev, status: 'refining', error: null,
          progress: { phase: 'loading', gamesLoaded: 0, gamesTotal: 0 },
        }));
        try {
          const ok = await repopulateIndexedDBFromServer({
            visitorId,
            platform,
            opponent,
            onProgress: (p) => {
              if (abortRef.current) return;
              setState(prev => ({ ...prev,
                progress: { phase: p.phase === 'complete' ? 'building' : 'loading', gamesLoaded: p.gamesProcessed, gamesTotal: p.gamesTotal },
              }));
            },
          });
          repopulatingRef.current = false;
          if (abortRef.current) {
            setState(prev => ({ ...prev, status: 'cancelled' }));
            return;
          }
          if (ok) {
            // Cache is now populated — fall through to run refinement below
          } else {
            setState(prev => ({
              ...prev,
              status: 'unavailable',
              error: 'No game data found for this opponent.',
            }));
            return;
          }
        } catch {
          repopulatingRef.current = false;
          setState(prev => ({
            ...prev,
            status: 'unavailable',
            error: 'Failed to rebuild local cache from server data.',
          }));
          return;
        }
      } else {
        // Already repopulating in another call — wait
        setState(prev => ({
          ...prev,
          status: 'unavailable',
          error: 'Rebuilding local cache…',
        }));
        return;
      }
    }
    
    setState(prev => ({ ...prev, status: 'refining' }));
    
    try {
      const result = await getDateFilteredMoves({
        filterParams: {
          visitorId,
          platform,
          opponent,
          from,
          to,
          speeds,
          rated,
          opponentColor,
          openingEco,
          openingName,
        },
        positionKey,
        side,
        onProgress: (progress) => {
          if (abortRef.current) return;
          setState(prev => ({ ...prev, progress }));
        },
      });
      
      if (abortRef.current) {
        setState(prev => ({ ...prev, status: 'cancelled' }));
        return;
      }
      
      setState({
        status: 'complete',
        progress: { phase: 'complete', gamesLoaded: result.filteredGames, gamesTotal: result.totalGames },
        refinedMoves: result.moves,
        totalGames: result.totalGames,
        filteredGames: result.filteredGames,
        error: null,
      });
    } catch (e) {
      if (abortRef.current) {
        setState(prev => ({ ...prev, status: 'cancelled' }));
        return;
      }
      setState(prev => ({
        ...prev,
        status: 'error',
        error: e instanceof Error ? e.message : 'Refinement failed',
      }));
    }
  }, [visitorId, platform, opponent, positionKey, side, from, to, speeds, rated, opponentColor, openingEco, openingName, shouldUseIndexedDB, enabled]);
  
  const cancelRefinement = useCallback(() => {
    abortRef.current = true;
    setState(prev => ({
      ...prev,
      status: prev.status === 'refining' || prev.status === 'checking' ? 'cancelled' : prev.status,
    }));
  }, []);
  
  // Auto-start refinement when feature is enabled (for all filters, not just date filters)
  // This ensures IndexedDB data is used which is more reliable than opening_graph_nodes
  useEffect(() => {
    if (shouldUseIndexedDB && enabled && visitorId && opponent && state.status === 'idle') {
      startRefinement();
    }
  }, [shouldUseIndexedDB, enabled, visitorId, opponent, state.status, startRefinement]);
  
  return {
    state,
    startRefinement,
    cancelRefinement,
    isRefining: state.status === 'checking' || state.status === 'refining',
    hasRefinedData: state.status === 'complete' && state.refinedMoves !== null,
  };
}
