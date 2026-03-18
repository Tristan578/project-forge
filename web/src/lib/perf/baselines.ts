/**
 * Performance baseline targets for SpawnForge key operations.
 *
 * These are the expected upper bounds (in milliseconds) for each operation.
 * The benchmark runner will fail CI if any measurement exceeds 2× these values.
 *
 * Baselines were established empirically on a mid-range 2024 development machine
 * (Apple M3 Pro, Chrome 125, WebGPU enabled).  Adjust after profiling on target CI
 * hardware — the ratios matter more than the absolute numbers.
 */

export interface PerformanceBaseline {
  /** Human-readable description of the operation being measured */
  description: string;
  /**
   * Expected p95 latency in milliseconds.
   * CI fails if the measured p95 exceeds this × 2.
   */
  p95Ms: number;
  /**
   * Expected average latency in milliseconds.
   */
  avgMs: number;
}

/**
 * Baseline targets keyed by benchmark name.
 * Names MUST match the `name` argument passed to `benchmark()` in the suite.
 */
export const PERFORMANCE_BASELINES: Record<string, PerformanceBaseline> = {
  // ---------------------------------------------------------------------------
  // Scene serialization
  // Target: serialize a 100-entity scene to JSON in < 50 ms p95
  // ---------------------------------------------------------------------------
  'scene-serialize-100-entities': {
    description: 'Serialize a 100-entity scene to .forge JSON format',
    p95Ms: 50,
    avgMs: 20,
  },

  // ---------------------------------------------------------------------------
  // Command dispatch
  // Target: JSON command round-trip (parse + queue) in < 1 ms per call
  // ---------------------------------------------------------------------------
  'command-dispatch-single': {
    description: 'Dispatch a single JSON command through handle_command()',
    p95Ms: 1,
    avgMs: 0.3,
  },

  // ---------------------------------------------------------------------------
  // Store update propagation
  // Target: Zustand store update visible to subscribers in < 5 ms
  // ---------------------------------------------------------------------------
  'store-update-propagation': {
    description: 'Zustand store update propagation time (set → subscriber notified)',
    p95Ms: 5,
    avgMs: 1,
  },

  // ---------------------------------------------------------------------------
  // Scene graph rebuild
  // Target: rebuild the scene hierarchy for 100 nodes in < 20 ms
  // ---------------------------------------------------------------------------
  'scene-graph-rebuild-100-nodes': {
    description: 'Rebuild scene graph hierarchy for 100 nodes',
    p95Ms: 20,
    avgMs: 8,
  },

  // ---------------------------------------------------------------------------
  // Scene deserialization (load)
  // Target: parse and apply a 100-entity .forge file in < 100 ms
  // ---------------------------------------------------------------------------
  'scene-deserialize-100-entities': {
    description: 'Deserialize and validate a 100-entity .forge JSON scene',
    p95Ms: 100,
    avgMs: 40,
  },

  // ---------------------------------------------------------------------------
  // Material preset lookup
  // Target: find a preset by name from 56-item catalogue in < 1 ms
  // ---------------------------------------------------------------------------
  'material-preset-lookup': {
    description: 'Look up a material preset by name from the full catalogue',
    p95Ms: 1,
    avgMs: 0.1,
  },

  // ---------------------------------------------------------------------------
  // Hierarchy filter
  // Target: filter a 500-node hierarchy by search term in < 10 ms
  // ---------------------------------------------------------------------------
  'hierarchy-filter-500-nodes': {
    description: 'Filter a 500-node scene hierarchy by a search string',
    p95Ms: 10,
    avgMs: 3,
  },
};

/**
 * Returns the baseline for a given benchmark name, or `null` if not registered.
 */
export function getBaseline(name: string): PerformanceBaseline | null {
  return PERFORMANCE_BASELINES[name] ?? null;
}

/**
 * Checks whether a measured p95 value exceeds the registered baseline by more
 * than `thresholdMultiplier` (default 2×).
 *
 * Returns `true` if the measurement is within budget, `false` if it regresses.
 */
export function isWithinBudget(
  name: string,
  measuredP95Ms: number,
  thresholdMultiplier = 2.0,
): boolean {
  const baseline = getBaseline(name);
  if (!baseline) return true; // Unknown benchmark — cannot evaluate
  return measuredP95Ms <= baseline.p95Ms * thresholdMultiplier;
}
