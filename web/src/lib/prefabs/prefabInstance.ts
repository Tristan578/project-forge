/**
 * Nested / linked prefab instances with per-field override tracking.
 *
 * DESIGN (scene.FR-1.OP-01 / OP-02 / OP-03 / OP-04)
 * ------------------------------------------------
 * A `Prefab` (see `prefabStore.ts`) is a single flat `PrefabSnapshot`. A
 * `PrefabInstance` is a *linked* reference to that source prefab: it carries the
 * source `prefabId`, a stable `instanceId`, and an `overrides` map recording the
 * snapshot fields the instance has deliberately diverged on. Everything NOT in
 * `overrides` is inherited live from the source prefab.
 *
 * Resolution is therefore a field-level merge computed on read
 * (`resolveInstance`): start from the source snapshot, then let each overridden
 * field win. This is what makes propagation automatic — when the source prefab
 * changes, every instance's UN-overridden fields follow it on the next resolve,
 * while overridden fields stay put (`applyPrefabUpdate`). There is no second
 * copy of the inherited data to drift out of sync.
 *
 * Nesting: a prefab may contain child instances of OTHER prefabs
 * (`PrefabChildRef`, held on `Prefab.children` in the store). That makes the
 * prefab graph a DAG, and a cycle in it (A contains B contains A) would make
 * resolution non-terminating, so `detectCycle` walks the graph to arbitrary
 * depth and rejects with the offending chain BEFORE any mutation is committed.
 *
 * Everything in this module is PURE: no `localStorage`, no engine, no mutation
 * of its inputs. The persistence + wiring live in `prefabStore.ts`; the manual
 * UI control and the equivalent AI command both call through these same
 * functions so the two entry points share one validated contract (F2).
 *
 * OUT OF SCOPE for this slice (tracked on the child issue): variant management
 * UI, selective per-field apply/revert UI, the override-inspection panel, and
 * export/runtime prefab resolution.
 */

import type { Prefab, PrefabSnapshot } from './prefabStore';

/** The snapshot fields an instance may override, keyed by field name. */
export type PrefabOverrideMap = Partial<Record<keyof PrefabSnapshot, unknown>>;

/**
 * A linked reference from a scene entity (or a parent prefab) to a source
 * prefab, plus the fields this instance has diverged on.
 */
export interface PrefabInstance {
  /** Stable id, survives save/reopen (N1). */
  instanceId: string;
  /** Id of the source `Prefab` this instance is linked to. */
  prefabId: string;
  /** Fields the instance overrides; everything else is inherited live. */
  overrides: PrefabOverrideMap;
  /** Scene entity this instance is bound to, when instantiated into a scene. */
  entityId?: string;
}

/** A nested prefab reference held on a parent prefab (`Prefab.children`). */
export interface PrefabChildRef {
  instanceId: string;
  prefabId: string;
  overrides?: PrefabOverrideMap;
}

/** Result of a cycle check: the chain is populated only when `hasCycle`. */
export interface CycleCheckResult {
  hasCycle: boolean;
  /** The prefab-id chain that closes the loop, e.g. `['A','B','A']`. */
  chain: string[];
}

/** Snapshot fields that participate in override tracking / resolution. */
const SNAPSHOT_FIELDS: ReadonlyArray<keyof PrefabSnapshot> = [
  'entityType',
  'name',
  'transform',
  'material',
  'light',
  'physics',
  'script',
  'audio',
  'particle',
];

/** Generate a stable instance id. */
function generateInstanceId(): string {
  return `pfi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Keep only override keys that name a real snapshot field. An override on an
 * unknown key can never resolve against the source and would otherwise sit in
 * the persisted instance forever as invisible dead data.
 */
function sanitizeOverrides(overrides: PrefabOverrideMap | undefined): PrefabOverrideMap {
  const clean: PrefabOverrideMap = {};
  if (!overrides) return clean;
  for (const field of SNAPSHOT_FIELDS) {
    if (Object.hasOwn(overrides, field) && overrides[field] !== undefined) {
      clean[field] = overrides[field];
    }
  }
  return clean;
}

/**
 * Create a new linked instance of a source prefab (OP-01).
 *
 * @param overrides Optional initial per-field overrides. Unknown keys are
 *   dropped so a caller cannot seed an instance with fields that never resolve.
 */
export function createInstance(
  prefabId: string,
  overrides?: PrefabOverrideMap,
  entityId?: string,
): PrefabInstance {
  return {
    instanceId: generateInstanceId(),
    prefabId,
    overrides: sanitizeOverrides(overrides),
    ...(entityId ? { entityId } : {}),
  };
}

/**
 * Resolve an instance against its source prefab: inherited fields come from the
 * prefab, overridden fields win. Pure — neither argument is mutated.
 */
export function resolveInstance(instance: PrefabInstance, prefab: Prefab): PrefabSnapshot {
  // Structured-clone the source so a consumer mutating the resolved snapshot can
  // never reach back into the stored prefab.
  const base: PrefabSnapshot = structuredCloneCompat(prefab.snapshot);
  for (const field of SNAPSHOT_FIELDS) {
    if (Object.hasOwn(instance.overrides, field) && instance.overrides[field] !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- override values are field-typed at the call sites that set them
      (base as any)[field] = structuredCloneCompat(instance.overrides[field]);
    }
  }
  return base;
}

/**
 * Propagate a (possibly updated) source prefab onto an instance (OP-04).
 *
 * Returns the instance UNCHANGED (its override set is the durable state) plus
 * the freshly resolved snapshot, so a caller can materialize the propagated
 * result while the overrides it recorded stay intact. Non-overridden fields
 * reflect the new prefab; overridden fields are preserved.
 */
export function applyPrefabUpdate(
  instance: PrefabInstance,
  prefab: Prefab,
): { instance: PrefabInstance; snapshot: PrefabSnapshot } {
  return { instance, snapshot: resolveInstance(instance, prefab) };
}

/** Add or replace one field override, returning a NEW instance (immutable). */
export function setOverride(
  instance: PrefabInstance,
  field: keyof PrefabSnapshot,
  value: unknown,
): PrefabInstance {
  return {
    ...instance,
    overrides: { ...instance.overrides, [field]: value },
  };
}

/**
 * Remove one field override, returning a NEW instance. The field then follows
 * the source prefab again on the next resolve.
 */
export function clearOverride(instance: PrefabInstance, field: keyof PrefabSnapshot): PrefabInstance {
  const next: PrefabOverrideMap = { ...instance.overrides };
  delete next[field];
  return { ...instance, overrides: next };
}

/** The fields this instance currently overrides (OP-03 inspection). */
export function getOverriddenFields(instance: PrefabInstance): Array<keyof PrefabSnapshot> {
  return SNAPSHOT_FIELDS.filter((f) => Object.hasOwn(instance.overrides, f));
}

/**
 * Detect a cyclic prefab reference in the nesting graph (OP-02).
 *
 * Walks children to arbitrary depth so a multi-level loop (A → B → A, or
 * A → B → C → A) is caught, not just a one-level self-reference. Returns the
 * offending chain when a prefab id is re-encountered on the current path.
 *
 * @param getChildPrefabIds Resolver from a prefab id to the prefab ids it
 *   directly nests. Injected rather than reading the store so this stays pure
 *   and testable, and so the caller can run the check against a *proposed*
 *   graph (parent + candidate child) before committing anything.
 */
export function detectCycle(
  rootPrefabId: string,
  getChildPrefabIds: (prefabId: string) => string[],
): CycleCheckResult {
  const walk = (prefabId: string, path: string[]): CycleCheckResult => {
    if (path.includes(prefabId)) {
      return { hasCycle: true, chain: [...path, prefabId] };
    }
    const nextPath = [...path, prefabId];
    for (const child of getChildPrefabIds(prefabId)) {
      const result = walk(child, nextPath);
      if (result.hasCycle) return result;
    }
    return { hasCycle: false, chain: [] };
  };
  return walk(rootPrefabId, []);
}

/**
 * Would adding `childPrefabId` under `parentPrefabId` create a cycle? Evaluates
 * the PROPOSED graph (existing children plus the candidate) without mutating
 * anything, so the caller can reject before committing (OP-02).
 */
export function wouldCreateCycle(
  parentPrefabId: string,
  childPrefabId: string,
  getChildPrefabIds: (prefabId: string) => string[],
): CycleCheckResult {
  const augmented = (prefabId: string): string[] => {
    const base = getChildPrefabIds(prefabId);
    return prefabId === parentPrefabId ? [...base, childPrefabId] : base;
  };
  // Start the walk from the child: a cycle exists iff following the child's
  // descendants (through the proposed edge) leads back to the parent.
  return detectCycle(parentPrefabId, augmented);
}

/**
 * `structuredClone` with a JSON fallback for environments (older jsdom) that do
 * not expose it. Snapshot data is plain JSON, so the fallback is lossless here.
 */
function structuredCloneCompat<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
