/**
 * Pure data model for saved prefab links, override resolution, and nesting
 * graph validation. Resolution computes snapshots only; it does not create or
 * update engine entities. Linked placement and propagation remain on #9811.
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
 * Bound on an override map's serialized size (bytes). Overrides reach cloning
 * (`resolveInstance`) and `localStorage` serialization on every instance
 * create/save, so an unbounded value from a crafted `.forge` scene file is a
 * resource-exhaustion vector (persistent quota pressure, growing clone cost). 64KiB
 * comfortably covers a legitimate multi-field override (transform + material +
 * a short script snippet) while blocking pathological payloads.
 */
export const MAX_OVERRIDE_MAP_BYTES = 64 * 1024;

/** Serialized byte size of an override map. */
export function overrideMapByteSize(overrides: PrefabOverrideMap): number {
  try {
    return new Blob([JSON.stringify(overrides)]).size;
  } catch {
    // Circular or otherwise unstringifiable — treat as over any bound so the
    // caller rejects rather than silently accepting unmeasurable data.
    return Number.POSITIVE_INFINITY;
  }
}

/** Is this override map within the size bound (default `MAX_OVERRIDE_MAP_BYTES`)? */
export function isOverrideMapWithinSizeLimit(
  overrides: PrefabOverrideMap | undefined,
  maxBytes: number = MAX_OVERRIDE_MAP_BYTES,
): boolean {
  if (!overrides) return true;
  return overrideMapByteSize(overrides) <= maxBytes;
}

/**
 * Keep only override keys that name a real snapshot field. An override on an
 * unknown key can never resolve against the source and would otherwise sit in
 * the persisted instance forever as invisible dead data.
 */
export function sanitizeOverrides(overrides: PrefabOverrideMap | undefined): PrefabOverrideMap {
  const clean: PrefabOverrideMap = {};
  if (!overrides) return clean;
  for (const field of SNAPSHOT_FIELDS) {
    if (Object.hasOwn(overrides, field) && overrides[field] !== undefined) {
      clean[field] = overrides[field];
    }
  }
  return clean;
}

/** Reasonable upper bound on an id field read out of an untrusted scene file. */
const MAX_ID_LENGTH = 200;

function isBoundedString(value: unknown, maxLength: number = MAX_ID_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * Validate and sanitize ONE instance record read back out of a `.forge` scene
 * file (scene.FR-1 N1 SEC-1). Scene files are untrusted input — they can come
 * from a user's disk, a shared project, or a REMIXED project from a different
 * user (SEC-2's cross-user boundary) — so this never trusts shape or size.
 * Returns `null` (the whole record dropped) for a malformed id/entityId or an
 * overrides map that exceeds `MAX_OVERRIDE_MAP_BYTES`; unknown override KEYS
 * are silently dropped by `sanitizeOverrides` rather than invalidating the
 * record, matching that function's existing "extra fields are inert" contract
 * — but the size bound is checked against the RAW map, BEFORE those unknown
 * keys are dropped. Checking the cleaned map instead would let a crafted
 * record hide an arbitrarily large payload under an unknown key: it gets
 * silently stripped by `sanitizeOverrides` either way, so checking after
 * stripping would measure `{}` and accept a record whose actual size on the
 * wire was unbounded.
 */
export function sanitizeInstanceRecord(raw: unknown): PrefabInstance | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (!isBoundedString(candidate.instanceId)) return null;
  if (!isBoundedString(candidate.prefabId)) return null;
  if (candidate.entityId !== undefined && !isBoundedString(candidate.entityId)) return null;
  const rawOverrides = candidate.overrides;
  if (rawOverrides !== undefined && (typeof rawOverrides !== 'object' || rawOverrides === null || Array.isArray(rawOverrides))) {
    return null;
  }
  if (!isOverrideMapWithinSizeLimit(rawOverrides as PrefabOverrideMap | undefined)) return null;
  const overrides = sanitizeOverrides(rawOverrides as PrefabOverrideMap | undefined);
  return {
    instanceId: candidate.instanceId,
    prefabId: candidate.prefabId,
    overrides,
    ...(candidate.entityId ? { entityId: candidate.entityId as string } : {}),
  };
}

/**
 * Create a link metadata record for a source prefab; no engine entity is spawned.
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
      // Assign only whitelisted own fields; this resolves saved metadata and
      // does not validate component values for a future engine transaction.
      Object.assign(base, { [field]: structuredCloneCompat(instance.overrides[field]) });
    }
  }
  return base;
}

/**
 * Compute the snapshot a source update would produce for a link record.
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
  // Iterative DFS visits each node/edge once, even when a DAG has many
  // overlapping paths. An explicit stack also accepts deeply nested input
  // without depending on the JavaScript call-stack limit.
  const visited = new Set<string>();
  const visiting = new Set<string>([rootPrefabId]);
  const stack = [{ id: rootPrefabId, children: getChildPrefabIds(rootPrefabId), next: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.next === frame.children.length) {
      visiting.delete(frame.id);
      visited.add(frame.id);
      stack.pop();
      continue;
    }
    const child = frame.children[frame.next++];
    if (visiting.has(child)) {
      return { hasCycle: true, chain: [...stack.map((entry) => entry.id), child] };
    }
    if (visited.has(child)) continue;
    visiting.add(child);
    stack.push({ id: child, children: getChildPrefabIds(child), next: 0 });
  }
  return { hasCycle: false, chain: [] };
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
  // Check the parent's reachable graph including the proposed edge.
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
