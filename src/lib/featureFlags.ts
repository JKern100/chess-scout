/**
 * Feature flags for gradual rollout of new functionality.
 * 
 * Flags can be controlled via:
 * 1. Environment variables (NEXT_PUBLIC_FF_<FLAG_NAME>)
 * 2. localStorage (for testing: localStorage.setItem('ff_analysis_v2_client_tree', 'true'))
 */

export type FeatureFlag = 
  | 'analysis_v2_client_tree'  // Phase 1: Client-side Analysis using opening_graph_nodes
  | 'analysis_v2_date_refine'; // Phase 1b: Progressive date filter refinement

const FLAG_DEFAULTS: Record<FeatureFlag, boolean> = {
  analysis_v2_client_tree: true,   // Enable by default for Phase 1
  analysis_v2_date_refine: true,   // Enable for Phase 1b - progressive date filter refinement
};

function getEnvFlag(flag: FeatureFlag): boolean | null {
  if (typeof process === 'undefined') return null;
  const envKey = `NEXT_PUBLIC_FF_${flag.toUpperCase()}`;
  const val = process.env[envKey];
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0') return false;
  return null;
}

function getLocalStorageFlag(flag: FeatureFlag): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = localStorage.getItem(`ff_${flag}`);
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
  } catch {
    // localStorage might be unavailable
  }
  return null;
}

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  // Priority: localStorage > env > default
  const fromLocalStorage = getLocalStorageFlag(flag);
  if (fromLocalStorage !== null) return fromLocalStorage;
  
  const fromEnv = getEnvFlag(flag);
  if (fromEnv !== null) return fromEnv;
  
  return FLAG_DEFAULTS[flag] ?? false;
}

export function setFeatureFlag(flag: FeatureFlag, enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`ff_${flag}`, enabled ? 'true' : 'false');
  } catch {
    // localStorage might be unavailable
  }
}

export function clearFeatureFlag(flag: FeatureFlag): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(`ff_${flag}`);
  } catch {
    // localStorage might be unavailable
  }
}
