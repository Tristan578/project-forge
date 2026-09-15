import type { PrefabSnapshot } from './prefabStore';

/**
 * Asset version tracking and transactional reimport foundation.
 *
 * Operation families (see #9812 / scene.FR-2):
 *  - scene.FR-2.OP-01  Asset versions and dependency crosswalks
 *  - scene.FR-2.OP-02  Impact preview and version selection
 *  - scene.FR-2.OP-03  Transactional reimport with override preservation
 *  - scene.FR-2.OP-04  Concurrent revision conflict and rollback
 *
 * Every function here is pure: preview and validation never mutate their
 * inputs, and a rejected reimport leaves the prior version and all instances
 * exactly as they were (no partial mutation). Scene-level reference crosswalks,
 * AI-path parity and multi-entity transactional rollback are deliberately out
 * of scope for this foundation slice and are tracked as follow-up work.
 */

/** Top-level snapshot fields preserved across a reimport by default. */
export const DEFAULT_PROTECTED_FIELDS = ['transform', 'script'] as const;

export interface AssetVersion {
  /** Human-readable, version-scoped id, e.g. `av_v1_1a2b3c`. */
  id: string;
  /** Monotonic version counter; increments by one on every accepted reimport. */
  versionNumber: number;
  /** Stable content hash of the source snapshot this version was cut from. */
  sourceHash: string;
  createdAt: string;
  updatedAt: string;
  /** Top-level snapshot fields preserved across reimport (in addition to per-instance overrides). */
  protectedFields: string[];
}

/**
 * An instance that references a prefab's source asset. `overrides` names the
 * top-level snapshot fields the creator changed by hand; those, together with
 * the version's protected fields, are preserved when the source is reimported.
 */
export interface PrefabInstance {
  id: string;
  prefabId: string;
  snapshot: PrefabSnapshot;
  overrides: string[];
}

export interface ReimportFieldChange {
  instanceId: string;
  /** Fields that would change to track the new source. */
  changedFields: string[];
  /** Protected/overridden fields that differ from the new source but are kept. */
  preservedFields: string[];
}

/**
 * Why a reimport was rejected. The pure functions in this module only ever emit
 * `missing-source` / `incompatible-source`; `unknown-prefab` and
 * `read-only-prefab` are raised by the prefabStore wrappers that resolve a
 * prefab id before delegating here, so the reason vocabulary stays shared.
 */
export type ReimportRejection =
  | 'missing-source'
  | 'incompatible-source'
  | 'unknown-prefab'
  | 'read-only-prefab';

export interface ReimportPreview {
  ok: boolean;
  reason?: ReimportRejection;
  fromVersion: number | null;
  toVersion: number | null;
  affectedInstanceIds: string[];
  changes: ReimportFieldChange[];
}

export interface ReimportResult {
  ok: boolean;
  reason?: ReimportRejection;
  /** New version on success; the unchanged prior version (same reference) on rejection. */
  version: AssetVersion | null;
  /** Updated instances on success; the original, untouched instances on rejection. */
  updatedInstances: PrefabInstance[];
  affectedInstanceIds: string[];
}

export interface ReferenceCrosswalk {
  prefabId: string;
  instanceIds: string[];
  referenceCount: number;
}

export interface ConflictCandidate {
  label: string;
  source: PrefabSnapshot;
  sourceHash: string;
}

export interface VersionConflict {
  base: number;
  baseVersion: AssetVersion;
  resolvable: boolean;
  divergentFields: string[];
  candidates: ConflictCandidate[];
}

export interface ConflictResolution {
  chosenLabel: string;
  source: PrefabSnapshot;
  version: AssetVersion;
}

/** Deterministic JSON serialization with recursively sorted object keys. */
function stableStringify(value: unknown): string {
  // `undefined` (an absent/removed field) must serialize to something distinct from
  // `null` (an explicit null value) — JSON.stringify(undefined) is the JS value
  // `undefined`, which previously fell through the `?? 'null'` fallback and collided
  // with `null`, making fieldsDiffer() treat "field removed" as "field unchanged".
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

/** FNV-1a 32-bit hash of a stable serialization; stable across key insertion order. */
export function hashSnapshot(snapshot: PrefabSnapshot): string {
  const serialized = stableStringify(snapshot);
  let hash = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i += 1) {
    hash ^= serialized.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in unsigned range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function versionId(versionNumber: number, sourceHash: string): string {
  return `av_v${versionNumber}_${sourceHash.slice(0, 6)}`;
}

/** OP-01: cut version 1 for a freshly tracked source asset. */
export function createAssetVersion(
  snapshot: PrefabSnapshot,
  protectedFields: readonly string[] = DEFAULT_PROTECTED_FIELDS,
  now: string = new Date().toISOString(),
): AssetVersion {
  const sourceHash = hashSnapshot(snapshot);
  return {
    id: versionId(1, sourceHash),
    versionNumber: 1,
    sourceHash,
    createdAt: now,
    updatedAt: now,
    protectedFields: [...protectedFields],
  };
}

/** OP-03: advance to the next version off `prev`, preserving createdAt and protected fields. */
export function bumpAssetVersion(
  prev: AssetVersion,
  snapshot: PrefabSnapshot,
  now: string = new Date().toISOString(),
): AssetVersion {
  const versionNumber = prev.versionNumber + 1;
  const sourceHash = hashSnapshot(snapshot);
  return {
    id: versionId(versionNumber, sourceHash),
    versionNumber,
    sourceHash,
    createdAt: prev.createdAt,
    updatedAt: now,
    protectedFields: [...prev.protectedFields],
  };
}

/** A source is reimportable only when present and of the same entity type. */
export function isCompatibleSource(
  current: PrefabSnapshot,
  next: PrefabSnapshot | null | undefined,
): next is PrefabSnapshot {
  return !!next && next.entityType === current.entityType;
}

/** OP-01: which instances reference a given prefab. */
export function buildReferenceCrosswalk(
  prefabId: string,
  instances: readonly PrefabInstance[],
): ReferenceCrosswalk {
  const instanceIds = instances.filter((i) => i.prefabId === prefabId).map((i) => i.id);
  return { prefabId, instanceIds, referenceCount: instanceIds.length };
}

function protectedSet(version: AssetVersion, instance: PrefabInstance): Set<string> {
  return new Set<string>([...version.protectedFields, ...instance.overrides]);
}

function snapshotKeys(a: PrefabSnapshot, b: PrefabSnapshot): string[] {
  return Array.from(new Set<string>([...Object.keys(a), ...Object.keys(b)]));
}

function fieldValue(snapshot: PrefabSnapshot, field: string): unknown {
  return (snapshot as unknown as Record<string, unknown>)[field];
}

function fieldsDiffer(a: unknown, b: unknown): boolean {
  return stableStringify(a) !== stableStringify(b);
}

function classifyInstance(
  current: PrefabSnapshot,
  next: PrefabSnapshot,
  version: AssetVersion,
  instance: PrefabInstance,
): ReimportFieldChange {
  const protectedFields = protectedSet(version, instance);
  const changedFields: string[] = [];
  const preservedFields: string[] = [];
  for (const field of snapshotKeys(current, next)) {
    const instanceValue = fieldValue(instance.snapshot, field);
    const nextValue = fieldValue(next, field);
    if (!fieldsDiffer(instanceValue, nextValue)) continue;
    if (protectedFields.has(field)) {
      preservedFields.push(field);
    } else {
      changedFields.push(field);
    }
  }
  return { instanceId: instance.id, changedFields, preservedFields };
}

/** OP-02: impact preview — the instances/fields a reimport would touch, without mutating anything. */
export function reimportPreview(
  current: PrefabSnapshot,
  next: PrefabSnapshot | null | undefined,
  version: AssetVersion,
  instances: readonly PrefabInstance[],
): ReimportPreview {
  if (!next) {
    return { ok: false, reason: 'missing-source', fromVersion: version.versionNumber, toVersion: null, affectedInstanceIds: [], changes: [] };
  }
  if (!isCompatibleSource(current, next)) {
    return { ok: false, reason: 'incompatible-source', fromVersion: version.versionNumber, toVersion: null, affectedInstanceIds: [], changes: [] };
  }
  const changes = instances.map((instance) => classifyInstance(current, next, version, instance));
  const affectedInstanceIds = changes.filter((c) => c.changedFields.length > 0).map((c) => c.instanceId);
  return {
    ok: true,
    fromVersion: version.versionNumber,
    toVersion: version.versionNumber + 1,
    affectedInstanceIds,
    changes,
  };
}

function applyToInstance(
  current: PrefabSnapshot,
  next: PrefabSnapshot,
  version: AssetVersion,
  instance: PrefabInstance,
): { instance: PrefabInstance; changed: boolean } {
  const protectedFields = protectedSet(version, instance);
  const updated: Record<string, unknown> = { ...(instance.snapshot as unknown as Record<string, unknown>) };
  let changed = false;
  for (const field of snapshotKeys(current, next)) {
    if (protectedFields.has(field)) continue;
    const nextValue = fieldValue(next, field);
    if (!fieldsDiffer(updated[field], nextValue)) continue;
    if (nextValue === undefined) {
      delete updated[field];
    } else {
      updated[field] = nextValue;
    }
    changed = true;
  }
  return {
    instance: { ...instance, snapshot: updated as unknown as PrefabSnapshot },
    changed,
  };
}

/**
 * OP-03: transactional reimport. On success every affected instance tracks the
 * new source except its protected and overridden fields, and the version bumps.
 * On a missing or incompatible source nothing is mutated — the prior version
 * (same reference) and the original instances are returned unchanged.
 */
export function applyReimport(
  current: PrefabSnapshot,
  next: PrefabSnapshot | null | undefined,
  version: AssetVersion,
  instances: readonly PrefabInstance[],
  now: string = new Date().toISOString(),
): ReimportResult {
  if (!next) {
    return { ok: false, reason: 'missing-source', version, updatedInstances: [...instances], affectedInstanceIds: [] };
  }
  if (!isCompatibleSource(current, next)) {
    return { ok: false, reason: 'incompatible-source', version, updatedInstances: [...instances], affectedInstanceIds: [] };
  }
  const affectedInstanceIds: string[] = [];
  const updatedInstances = instances.map((instance) => {
    const { instance: nextInstance, changed } = applyToInstance(current, next, version, instance);
    if (changed) affectedInstanceIds.push(instance.id);
    return nextInstance;
  });
  return {
    ok: true,
    version: bumpAssetVersion(version, next, now),
    updatedInstances,
    affectedInstanceIds,
  };
}

/** OP-04: two competing revisions off the same base return a resolvable conflict. */
export function detectVersionConflict(
  base: AssetVersion,
  a: { label: string; source: PrefabSnapshot },
  b: { label: string; source: PrefabSnapshot },
): VersionConflict {
  const divergentFields = snapshotKeys(a.source, b.source).filter((field) =>
    fieldsDiffer(fieldValue(a.source, field), fieldValue(b.source, field)),
  );
  return {
    base: base.versionNumber,
    baseVersion: base,
    resolvable: true,
    divergentFields,
    candidates: [
      { label: a.label, source: a.source, sourceHash: hashSnapshot(a.source) },
      { label: b.label, source: b.source, sourceHash: hashSnapshot(b.source) },
    ],
  };
}

/** OP-04: resolve a conflict by choosing one revision; produces the next version. */
export function resolveVersionConflict(
  conflict: VersionConflict,
  chosenLabel: string,
  now: string = new Date().toISOString(),
): ConflictResolution {
  const winner = conflict.candidates.find((c) => c.label === chosenLabel);
  if (!winner) {
    throw new Error(`Unknown conflict label "${chosenLabel}"; expected one of ${conflict.candidates.map((c) => c.label).join(', ')}`);
  }
  return {
    chosenLabel: winner.label,
    source: winner.source,
    version: bumpAssetVersion(conflict.baseVersion, winner.source, now),
  };
}
