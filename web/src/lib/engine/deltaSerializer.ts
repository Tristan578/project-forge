/**
 * Delta encoding for play-tick serialization.
 *
 * Instead of sending the full scene state every frame, this module computes
 * a delta (patch) containing only the components that changed since the last
 * snapshot. This reduces per-frame serialization cost from O(n) to O(changed).
 *
 * A full "keyframe" snapshot is sent every KEYFRAME_INTERVAL frames to guard
 * against drift from missed deltas.
 */

/** entityId -> componentName -> value */
export type SceneSnapshot = Record<string, Record<string, unknown>>;

export interface DeltaPatch {
  /** entityId -> componentName -> newValue (only changed components) */
  changed: Record<string, Record<string, unknown>>;
  /** Entity IDs that were removed since last snapshot */
  removed: string[];
  /** Entity IDs that were added since last snapshot */
  added: string[];
  /** Monotonic timestamp (ms) */
  timestamp: number;
  /** Whether this patch is a full keyframe (receiver should replace, not merge) */
  isKeyframe: boolean;
}

/** Default keyframe interval — send full state every N frames */
const DEFAULT_KEYFRAME_INTERVAL = 60;

export class DeltaSerializer {
  private lastSnapshot: SceneSnapshot | null = null;
  private frameCount = 0;
  private keyframeInterval: number;

  constructor(keyframeInterval: number = DEFAULT_KEYFRAME_INTERVAL) {
    this.keyframeInterval = keyframeInterval;
  }

  /**
   * Capture a snapshot as the new baseline for future deltas.
   */
  takeSnapshot(sceneState: SceneSnapshot): void {
    // Deep clone so mutations to the original don't affect our baseline
    this.lastSnapshot = deepCloneSnapshot(sceneState);
  }

  /**
   * Compute a delta between the current baseline and the new state.
   * Automatically takes a snapshot of the new state as the new baseline.
   * Every `keyframeInterval` frames, returns a full keyframe instead of a delta.
   */
  computeDelta(newState: SceneSnapshot): DeltaPatch {
    this.frameCount++;

    // Keyframe: send full state periodically for safety
    const isKeyframe =
      this.lastSnapshot === null ||
      this.frameCount % this.keyframeInterval === 0;

    if (isKeyframe) {
      const patch = createKeyframePatch(newState);
      this.lastSnapshot = deepCloneSnapshot(newState);
      return patch;
    }

    const patch = diffSnapshots(this.lastSnapshot!, newState);
    this.lastSnapshot = deepCloneSnapshot(newState);
    return patch;
  }

  /**
   * Apply a delta patch to a base snapshot, producing the full state.
   * If the patch is a keyframe, the base is ignored and the patch's changed
   * data is returned directly.
   */
  applyDelta(base: SceneSnapshot, delta: DeltaPatch): SceneSnapshot {
    if (delta.isKeyframe) {
      // Keyframe patches contain the full state in `changed`
      return deepCloneSnapshot(delta.changed);
    }

    // Start from a copy of the base
    const result: SceneSnapshot = deepCloneSnapshot(base);

    // Remove deleted entities
    for (const entityId of delta.removed) {
      delete result[entityId];
    }

    // Apply changed/added components
    for (const [entityId, components] of Object.entries(delta.changed)) {
      if (!result[entityId]) {
        result[entityId] = {};
      }
      for (const [compName, value] of Object.entries(components)) {
        result[entityId][compName] = value;
      }
    }

    return result;
  }

  /**
   * Return the last cached snapshot, or null if none exists.
   */
  getLastSnapshot(): SceneSnapshot | null {
    return this.lastSnapshot;
  }

  /**
   * Clear all cached state. Call on scene change or mode transition.
   */
  reset(): void {
    this.lastSnapshot = null;
    this.frameCount = 0;
  }

  /**
   * Get the current frame count (useful for testing).
   */
  getFrameCount(): number {
    return this.frameCount;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function deepCloneSnapshot(snapshot: SceneSnapshot): SceneSnapshot {
  const result: SceneSnapshot = {};
  for (const entityId of Object.keys(snapshot)) {
    const components = snapshot[entityId];
    const cloned: Record<string, unknown> = {};
    for (const key of Object.keys(components)) {
      // JSON round-trip for deep clone of component values
      cloned[key] = structuredCloneValue(components[key]);
    }
    result[entityId] = cloned;
  }
  return result;
}

function structuredCloneValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  // Arrays and objects: JSON round-trip is the fastest portable deep clone
  return JSON.parse(JSON.stringify(value));
}

/**
 * Diff two snapshots and return a DeltaPatch with only what changed.
 * Uses JSON.stringify per-component for structural equality comparison.
 */
function diffSnapshots(
  prev: SceneSnapshot,
  next: SceneSnapshot
): DeltaPatch {
  const changed: Record<string, Record<string, unknown>> = {};
  const removed: string[] = [];
  const added: string[] = [];

  const prevKeys = new Set(Object.keys(prev));
  const nextKeys = new Set(Object.keys(next));

  // Detect removed entities
  for (const entityId of prevKeys) {
    if (!nextKeys.has(entityId)) {
      removed.push(entityId);
    }
  }

  // Detect added entities and changed components
  for (const entityId of nextKeys) {
    if (!prevKeys.has(entityId)) {
      // Entirely new entity — include all its components
      added.push(entityId);
      changed[entityId] = { ...next[entityId] };
      continue;
    }

    // Entity exists in both — diff components
    const prevComponents = prev[entityId];
    const nextComponents = next[entityId];
    const changedComponents: Record<string, unknown> = {};
    let hasChanges = false;

    for (const compName of Object.keys(nextComponents)) {
      const prevVal = prevComponents[compName];
      const nextVal = nextComponents[compName];

      if (!componentEqual(prevVal, nextVal)) {
        changedComponents[compName] = nextVal;
        hasChanges = true;
      }
    }

    // Check for removed components (component existed before but not now)
    for (const compName of Object.keys(prevComponents)) {
      if (!(compName in nextComponents)) {
        // Signal removed component with undefined -> will be handled by applyDelta
        changedComponents[compName] = undefined;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      changed[entityId] = changedComponents;
    }
  }

  return {
    changed,
    removed,
    added,
    timestamp: Date.now(),
    isKeyframe: false,
  };
}

function createKeyframePatch(state: SceneSnapshot): DeltaPatch {
  return {
    changed: deepCloneSnapshot(state),
    removed: [],
    added: Object.keys(state),
    timestamp: Date.now(),
    isKeyframe: true,
  };
}

/**
 * Fast structural comparison of two component values.
 * For primitives, uses ===. For objects/arrays, falls back to JSON.stringify.
 */
function componentEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  // Fast path for arrays of numbers (common: position/rotation/scale tuples)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // General case: JSON comparison
  return JSON.stringify(a) === JSON.stringify(b);
}
