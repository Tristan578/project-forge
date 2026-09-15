/** Persist prefab definitions and editor link metadata; engine integration is tracked in #9811. */
import type { MaterialData, LightData, PhysicsData, ScriptData, AudioData, ParticleData } from '@/stores/editorStore';
import {
  createInstance,
  resolveInstance,
  wouldCreateCycle,
  detectCycle,
  sanitizeInstanceRecord,
  isOverrideMapWithinSizeLimit,
  MAX_OVERRIDE_MAP_BYTES,
  type PrefabInstance,
  type PrefabChildRef,
  type PrefabOverrideMap,
  type CycleCheckResult,
} from './prefabInstance';
import {
  createAssetVersion,
  bumpAssetVersion,
  buildReferenceCrosswalk,
  reimportPreview,
  applyReimport,
  type AssetVersion,
  type PrefabInstance as ReimportInstance,
  type ReimportPreview,
  type ReimportResult,
  type ReferenceCrosswalk,
} from './assetVersion';

export type { PrefabInstance, PrefabChildRef, PrefabOverrideMap } from './prefabInstance';

export interface PrefabSnapshot {
  entityType: string;
  name: string;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  material?: MaterialData;
  light?: LightData;
  physics?: PhysicsData;
  script?: ScriptData;
  audio?: AudioData;
  particle?: ParticleData;
}

export interface Prefab {
  id: string;
  name: string;
  category: string;
  description: string;
  snapshot: PrefabSnapshot;
  createdAt: string;
  updatedAt: string;
  /**
   * Nested prefab instances this prefab contains (linked prefabs). Optional so
   * every pre-existing flat prefab, and every built-in, stays a valid non-nested
   * prefab with no migration.
   */
  children?: PrefabChildRef[];
  /**
   * Version record for the prefab's source asset (#9812 / scene.FR-2). Optional
   * so prefabs persisted before version tracking still load; readers should
   * fall back to `createAssetVersion(prefab.snapshot)` when it is absent.
   */
  assetVersion?: AssetVersion;
}

const PREFAB_STORAGE_KEY = 'forge-prefabs';
const DELETED_PREFAB_IDS_STORAGE_KEY = 'forge-deleted-prefab-ids';
/** Cap on how many deleted ids the tombstone set retains (oldest evicted first). */
const MAX_TOMBSTONED_IDS = 2000;

/**
 * Ids of prefabs the user has explicitly deleted (scene.FR-1 N1). A saved but
 * currently-inactive scene keeps its OWN embedded copy of a definition
 * (`prefabDefinitions`, `writePrefabDefinitions`/`readPrefabDefinitions`) —
 * deleting a prefab only ever touches the ACTIVE library and registry, so
 * reopening that inactive scene would otherwise resurrect the deleted prefab
 * via `mergeImportedPrefabDefinitions`. This tombstone set is what that merge
 * checks to refuse re-importing an id the user has since deleted.
 */
function loadDeletedPrefabIds(): Set<string> {
  try {
    const stored = localStorage.getItem(DELETED_PREFAB_IDS_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch { return new Set(); }
}

function recordDeletedPrefabId(id: string): void {
  const ids = loadDeletedPrefabIds();
  ids.add(id);
  // FIFO-ish eviction: Set preserves insertion order, so the first entries are
  // the oldest deletions — least likely to still be embedded in a scene
  // someone is about to reopen.
  while (ids.size > MAX_TOMBSTONED_IDS) {
    const oldest = ids.values().next().value;
    if (oldest === undefined) break;
    ids.delete(oldest);
  }
  localStorage.setItem(DELETED_PREFAB_IDS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
}

/**
 * Change notification (scene.FR-1 N1 — "prefab panel keeps a stale library").
 * `localStorage` has no reactivity of its own, so a component that reads the
 * store once (e.g. a `useMemo` with an empty dependency array) never learns
 * about a mutation made through a DIFFERENT entry point — a chat command, or
 * another mounted panel — while it stays mounted. Both persistence funnels
 * below (`savePrefabsToStorage`, `savePrefabInstancesToStorage`) notify on
 * every write, so this covers every mutating function in this module without
 * each one needing its own call site.
 */
type PrefabChangeListener = () => void;
const prefabChangeListeners = new Set<PrefabChangeListener>();

/** Subscribe to prefab-library / instance-registry changes. Returns an unsubscribe function. */
export function subscribeToPrefabChanges(listener: PrefabChangeListener): () => void {
  prefabChangeListeners.add(listener);
  return () => { prefabChangeListeners.delete(listener); };
}

function notifyPrefabsChanged(): void {
  for (const listener of prefabChangeListeners) listener();
}

/** Load user-created prefabs from localStorage */
export function loadPrefabs(): Prefab[] {
  try {
    const stored = localStorage.getItem(PREFAB_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

/** Save prefabs to localStorage */
export function savePrefabsToStorage(prefabs: Prefab[]): void {
  localStorage.setItem(PREFAB_STORAGE_KEY, JSON.stringify(prefabs));
  notifyPrefabsChanged();
}

/** Save a new prefab */
export function savePrefab(name: string, category: string, description: string, snapshot: PrefabSnapshot): Prefab {
  const prefabs = loadPrefabs();
  const now = new Date().toISOString();
  const prefab: Prefab = {
    id: `prefab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    category: category || 'uncategorized',
    description: description || '',
    snapshot,
    createdAt: now,
    updatedAt: now,
    assetVersion: createAssetVersion(snapshot, undefined, now),
  };
  prefabs.push(prefab);
  savePrefabsToStorage(prefabs);
  return prefab;
}

/**
 * Delete a prefab by ID, cascading every reference to it rather than leaving a
 * dangling link (scene.FR-1 N1). A `Prefab` is now referenced two ways: a
 * scene-level `PrefabInstance.prefabId` (its linked source) and a parent
 * `Prefab.children[].prefabId` (a nesting edge). Deletion removes the
 * definition AND both kinds of reference in one pass, so `resolveInstance` and
 * `getChildPrefabIds` never have to handle a reference that resolves to
 * nothing. Cascade (over reject-while-referenced) matches the rest of this
 * store's fail-soft persistence and needs no new UI to explain a block.
 */
export function deletePrefab(id: string): boolean {
  const prefabs = loadPrefabs();
  const filtered = prefabs.filter(p => p.id !== id);
  if (filtered.length === prefabs.length) return false;

  // Tombstone the id so a saved-but-inactive scene's embedded copy of this
  // definition (`prefabDefinitions`) cannot resurrect it on a later load —
  // deletion here only ever touches the ACTIVE library and registry.
  recordDeletedPrefabId(id);

  // Drop the deleted prefab from every remaining prefab's `children`.
  const withoutChildRefs = filtered.map((p) => {
    if (!p.children || !p.children.some((c) => c.prefabId === id)) return p;
    return { ...p, children: p.children.filter((c) => c.prefabId !== id), updatedAt: new Date().toISOString() };
  });
  savePrefabsToStorage(withoutChildRefs);

  // Drop every scene-level instance still linked to the deleted source.
  const instances = loadPrefabInstances();
  const remainingInstances = instances.filter((i) => i.prefabId !== id);
  if (remainingInstances.length !== instances.length) {
    savePrefabInstancesToStorage(remainingInstances);
  }
  return true;
}

/** Get a prefab by ID or name */
export function getPrefab(idOrName: string): Prefab | undefined {
  const all = [...loadPrefabs(), ...getBuiltInPrefabs()];
  return all.find(p => p.id === idOrName || p.name === idOrName);
}

/** Update an existing prefab's snapshot, bumping its asset version. */
export function updatePrefab(id: string, snapshot: PrefabSnapshot): boolean {
  const prefabs = loadPrefabs();
  const idx = prefabs.findIndex(p => p.id === id);
  if (idx === -1) return false;
  const now = new Date().toISOString();
  const prev = prefabs[idx].assetVersion;
  prefabs[idx].snapshot = snapshot;
  prefabs[idx].updatedAt = now;
  prefabs[idx].assetVersion = prev
    ? bumpAssetVersion(prev, snapshot, now)
    : createAssetVersion(snapshot, undefined, now);
  savePrefabsToStorage(prefabs);
  return true;
}

/** List all prefabs (user + built-in) */
export function listAllPrefabs(): Prefab[] {
  return [...getBuiltInPrefabs(), ...loadPrefabs()];
}

/** Search prefabs by name (case-insensitive) */
export function searchPrefabs(query: string): Prefab[] {
  const q = query.toLowerCase().trim();
  if (!q) return listAllPrefabs();
  return listAllPrefabs().filter(p =>
    p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
  );
}

/** Get prefabs by category */
export function getPrefabsByCategory(category: string): Prefab[] {
  return listAllPrefabs().filter(p => p.category === category);
}

/** Get unique categories */
export function getPrefabCategories(): string[] {
  const cats = new Set(listAllPrefabs().map(p => p.category));
  return Array.from(cats).sort();
}

/**
 * Every LOCAL user `Prefab` transitively reachable from `startIds` by walking
 * `children[].prefabId` edges. Built-in / unknown ids resolve to nothing and
 * are simply left out — they either ship with the app already or are already
 * unresolvable, so there is nothing local to embed either way.
 */
function collectPrefabDefinitionClosure(startIds: Iterable<string>): Prefab[] {
  const userPrefabs = loadPrefabs();
  const byId = new Map(userPrefabs.map((p) => [p.id, p] as const));
  const collected = new Map<string, Prefab>();
  const pending = Array.from(startIds).reverse();
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (collected.has(id)) continue;
    const prefab = byId.get(id);
    if (!prefab) continue;
    collected.set(id, prefab);
    for (const child of [...(prefab.children ?? [])].reverse()) pending.push(child.prefabId);
  }
  return Array.from(collected.values());
}

/**
 * Export prefab as JSON string, including the transitive definitions of any
 * nested children it links (scene.FR-1 N1 — "nested imports contain dangling
 * children"). A plain `JSON.stringify(prefab)` carries `children[].prefabId`
 * references into THIS browser's library, not the definitions those ids name;
 * `importPrefab` needs `nestedDefinitions` to make an imported nested prefab
 * resolvable somewhere those ids do not already exist.
 */
export function exportPrefab(id: string): string | null {
  const prefab = getPrefab(id);
  if (!prefab) return null;
  const childIds = (prefab.children ?? []).map((c) => c.prefabId);
  // Exclude the prefab itself: cycle detection (`wouldCreateCycle`) already
  // prevents it from ever nesting itself, but excluding it here defensively
  // keeps the payload from ever describing a prefab as its own dependency.
  const nestedDefinitions = collectPrefabDefinitionClosure(childIds).filter((d) => d.id !== prefab.id);
  const payload = nestedDefinitions.length > 0 ? { ...prefab, nestedDefinitions } : prefab;
  return JSON.stringify(payload, null, 2);
}

/** Cap on how many nested children one imported prefab may carry (defense in depth). */
const MAX_IMPORTED_CHILDREN = 200;

/**
 * Validate every nested edge without changing its stable id. Reading a saved
 * scene must preserve identity; only an explicit prefab import remints edges.
 * Reject the definition when its child array is malformed or over the limit.
 */
function sanitizeImportedChildren(raw: unknown): PrefabChildRef[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_IMPORTED_CHILDREN) return null;
  const out: PrefabChildRef[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    const instance = sanitizeInstanceRecord(entry);
    if (!instance || ids.has(instance.instanceId)) return null;
    ids.add(instance.instanceId);
    out.push({
      instanceId: instance.instanceId,
      prefabId: instance.prefabId,
      ...(Object.keys(instance.overrides).length ? { overrides: instance.overrides } : {}),
    });
  }
  return out;
}

/** Reasonable upper bound on a text field read out of untrusted prefab JSON. */
const MAX_PREFAB_TEXT_FIELD_LENGTH = 200;

/** Overall serialized-size bound on ONE prefab definition (defense in depth). */
const MAX_PREFAB_DEFINITION_BYTES = 256 * 1024;

function isBoundedPrefabText(value: unknown, maxLength: number = MAX_PREFAB_TEXT_FIELD_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function hasValidSnapshotShape(value: unknown): value is PrefabSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.entityType !== 'string' || s.entityType.length === 0) return false;
  if (typeof s.name !== 'string') return false;
  const t = s.transform;
  if (typeof t !== 'object' || t === null) return false;
  const tr = t as Record<string, unknown>;
  return isVec3(tr.position) && isVec3(tr.rotation) && isVec3(tr.scale);
}

/**
 * Validate and sanitize ONE prefab definition read back out of untrusted
 * input — a scene's embedded `prefabDefinitions`, or an imported prefab's
 * `nestedDefinitions` (scene.FR-1 N1 SEC). Every entry point that installs a
 * `Prefab` it did not itself construct funnels through this rather than
 * trusting shape: id/name/category are bounded strings, `snapshot` has the
 * required transform shape, `children` (if present) goes through the same
 * `sanitizeImportedChildren` untrusted-child validation as a direct prefab
 * import, and the whole definition is capped at `MAX_PREFAB_DEFINITION_BYTES`
 * so a legitimately-shaped but enormous material/script payload cannot ride
 * along inside an otherwise-valid record.
 *
 * @param raw Untrusted definition, including optional nested-link metadata.
 * @returns Sanitized metadata with default descriptive fields, or null when shape/size checks fail; no persistence occurs.
 */
export function sanitizePrefabDefinition(raw: unknown): Prefab | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (!isBoundedPrefabText(candidate.id)) return null;
  if (!isBoundedPrefabText(candidate.name)) return null;
  if (candidate.category !== undefined && !isBoundedPrefabText(candidate.category)) return null;
  if (candidate.description !== undefined && typeof candidate.description !== 'string') return null;
  if (!hasValidSnapshotShape(candidate.snapshot)) return null;
  if (candidate.createdAt !== undefined && typeof candidate.createdAt !== 'string') return null;
  if (candidate.updatedAt !== undefined && typeof candidate.updatedAt !== 'string') return null;

  // Bound raw input before dropping fields, including unknown fields.
  try {
    if (new Blob([JSON.stringify(candidate)]).size > MAX_PREFAB_DEFINITION_BYTES) return null;
  } catch { return null; }
  const children = candidate.children !== undefined ? sanitizeImportedChildren(candidate.children) : undefined;
  if (children === null) return null;
  const now = new Date().toISOString();
  const definition: Prefab = {
    id: candidate.id,
    name: candidate.name,
    category: typeof candidate.category === 'string' ? candidate.category : 'imported',
    description: typeof candidate.description === 'string' ? candidate.description : '',
    snapshot: candidate.snapshot,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now,
    ...(children && children.length > 0 ? { children } : {}),
  };

  try {
    if (new Blob([JSON.stringify(definition)]).size > MAX_PREFAB_DEFINITION_BYTES) return null;
  } catch {
    return null;
  }
  return definition;
}

/**
 * Import a prefab and its dependency definitions atomically. The imported root
 * and its nesting edges receive fresh ids; references back to the old root are
 * remapped before validating the complete graph. Invalid or cyclic input makes
 * no storage writes and returns null.
 *
 * @param json Serialized root definition with optional nestedDefinitions dependencies.
 * @returns The persisted root with a fresh ID, or null on validation, dependency, parsing, or storage failure.
 */
export function importPrefab(json: string): Prefab | null {
  try {
    if (new Blob([json]).size > MAX_PREFAB_DEFINITION_BYTES * MAX_MERGED_DEFINITIONS) return null;
    const data: unknown = JSON.parse(json);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
    const raw = data as Record<string, unknown>;
    const id = `prefab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { nestedDefinitions: rawDependencies, ...rootDefinition } = raw;
    const parsed = sanitizePrefabDefinition({ ...rootDefinition, id });
    if (!parsed) return null;
    if (rawDependencies !== undefined && !Array.isArray(rawDependencies)) return null;
    const dependencies = rawDependencies ?? [];
    if (dependencies.length > MAX_MERGED_DEFINITIONS) return null;
    const remapChildren = (prefab: Prefab): Prefab => ({
      ...prefab,
      ...(prefab.children ? {
        children: prefab.children.map((child) => ({
          ...createInstance(child.prefabId === raw.id ? id : child.prefabId, child.overrides),
        })),
      } : {}),
    });
    const created = remapChildren(parsed);
    const sanitizedDependencies: Prefab[] = [];
    for (const dependency of dependencies) {
      const definition = sanitizePrefabDefinition(dependency);
      if (!definition || definition.id === raw.id) return null;
      sanitizedDependencies.push(remapChildren(definition));
    }
    const proposed = prepareImportedDefinitions([...sanitizedDependencies, created]);
    if (!proposed) return null;
    savePrefabsToStorage(proposed);
    return proposed.find((prefab) => prefab.id === id) ?? null;
  } catch { return null; }
}

/** Resolve a prefab's asset version, falling back to a synthesized v1 for legacy records. */
export function getPrefabAssetVersion(idOrName: string): AssetVersion | undefined {
  const prefab = getPrefab(idOrName);
  if (!prefab) return undefined;
  return prefab.assetVersion ?? createAssetVersion(prefab.snapshot);
}

/**
 * OP-01: which instances reference a prefab. Instances are supplied by the
 * caller (scene layer); this foundation slice does not itself own scene state.
 */
export function getPrefabReferenceCrosswalk(
  prefabId: string,
  instances: readonly ReimportInstance[],
): ReferenceCrosswalk {
  return buildReferenceCrosswalk(prefabId, instances);
}

/**
 * OP-02: preview the impact of reimporting a prefab's source, mutating nothing.
 * An unknown prefab is reported as `unknown-prefab` rather than throwing.
 */
export function previewPrefabReimport(
  prefabId: string,
  nextSource: PrefabSnapshot | null | undefined,
  instances: readonly ReimportInstance[],
): ReimportPreview {
  const prefab = getPrefab(prefabId);
  if (!prefab) {
    return { ok: false, reason: 'unknown-prefab', fromVersion: null, toVersion: null, affectedInstanceIds: [], changes: [] };
  }
  const version = prefab.assetVersion ?? createAssetVersion(prefab.snapshot);
  return reimportPreview(prefab.snapshot, nextSource, version, instances);
}

/**
 * OP-03: transactionally reimport a user prefab's source asset. On success the
 * prefab's source snapshot is replaced with the re-read asset, its version is
 * bumped, and the returned instances track the new source except for their
 * protected/overridden fields. On any rejection nothing is persisted and the
 * prior playable version is retained. Built-in prefabs are read-only.
 */
export function reimportPrefab(
  prefabId: string,
  nextSource: PrefabSnapshot | null | undefined,
  instances: readonly ReimportInstance[],
): ReimportResult {
  const prefabs = loadPrefabs();
  const idx = prefabs.findIndex(p => p.id === prefabId);
  if (idx === -1) {
    const isBuiltIn = getBuiltInPrefabs().some(p => p.id === prefabId);
    return {
      ok: false,
      reason: isBuiltIn ? 'read-only-prefab' : 'unknown-prefab',
      version: null,
      updatedInstances: [...instances],
      affectedInstanceIds: [],
    };
  }
  const prefab = prefabs[idx];
  const version = prefab.assetVersion ?? createAssetVersion(prefab.snapshot);
  const result = applyReimport(prefab.snapshot, nextSource, version, instances);
  if (!result.ok || !result.version) {
    return result;
  }
  prefabs[idx].snapshot = nextSource as PrefabSnapshot;
  prefabs[idx].assetVersion = result.version;
  prefabs[idx].updatedAt = result.version.updatedAt;
  savePrefabsToStorage(prefabs);
  return result;
}

// Import built-in prefabs
import { BUILT_IN_PREFABS } from './builtInPrefabs';

export function getBuiltInPrefabs(): Prefab[] {
  return BUILT_IN_PREFABS;
}

// ===========================================================================
// Nested / linked prefab INSTANCES (scene.FR-1.OP-01 .. OP-04)
//
// Instances live in their own localStorage key, separate from the flat prefab
// definitions, so the existing prefab CRUD above is untouched. Every operation
// here delegates the actual data logic to the pure functions in
// `prefabInstance.ts`; this layer only adds persistence and the store lookups
// (source-prefab existence, the nesting graph) those functions need.
// ===========================================================================

const PREFAB_INSTANCES_STORAGE_KEY = 'forge-prefab-instances';

/** Result of a mutating instance/nesting operation. */
export type PrefabInstanceOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; cycle?: string[] };

/** Load the persisted instance registry.
 *
 * @returns Parsed local registry data, or an empty list when absent/unreadable. This accessor does not sanitize individual records.
 */
export function loadPrefabInstances(): PrefabInstance[] {
  try {
    const stored = localStorage.getItem(PREFAB_INSTANCES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

/** Persist the instance registry.
 *
 * @param instances Registry records prepared by the caller.
 * @returns Nothing; replaces the local registry and notifies library subscribers.
 * @throws If serialization or localStorage writing fails.
 */
export function savePrefabInstancesToStorage(instances: PrefabInstance[]): void {
  localStorage.setItem(PREFAB_INSTANCES_STORAGE_KEY, JSON.stringify(instances));
  notifyPrefabsChanged();
}

/** All instances linked to a given source prefab.
 *
 * @param prefabId Canonical source prefab identity.
 * @returns Registry records linked to that exact identity; no engine lookup occurs.
 */
export function getPrefabInstances(prefabId: string): PrefabInstance[] {
  return loadPrefabInstances().filter((i) => i.prefabId === prefabId);
}

/**
 * Create and persist link metadata. This internal foundation does not spawn
 * or bind an engine entity. Rejects missing sources and oversized overrides.
 *
 * @param prefabId Existing source ID or name accepted by getPrefab.
 * @param overrides Optional field overrides bounded to MAX_OVERRIDE_MAP_BYTES.
 * @param entityId Optional entity identity retained as metadata only.
 * @returns The persisted record, or a result error for a missing source/oversized overrides.
 * @throws If registry persistence fails.
 */
export function createPrefabInstance(
  prefabId: string,
  overrides?: PrefabOverrideMap,
  entityId?: string,
): PrefabInstanceOpResult<PrefabInstance> {
  const source = getPrefab(prefabId);
  if (!source) return { ok: false, error: `Prefab not found: ${prefabId}` };
  // Bound persisted metadata even though user-facing mutation entry points
  // remain unavailable until engine integration is implemented.
  if (!isOverrideMapWithinSizeLimit(overrides)) {
    return { ok: false, error: `Overrides exceed the ${MAX_OVERRIDE_MAP_BYTES}-byte size limit` };
  }
  const instance = createInstance(source.id, overrides, entityId);
  const instances = loadPrefabInstances();
  instances.push(instance);
  savePrefabInstancesToStorage(instances);
  return { ok: true, value: instance };
}

/** Delete one instance by id. Returns whether anything was removed.
 *
 * @param instanceId Identity of the metadata record to remove.
 * @returns True when a record was removed and persisted, otherwise false; no engine entity is deleted.
 * @throws If registry persistence fails.
 */
export function deletePrefabInstance(instanceId: string): boolean {
  const instances = loadPrefabInstances();
  const filtered = instances.filter((i) => i.instanceId !== instanceId);
  if (filtered.length === instances.length) return false;
  savePrefabInstancesToStorage(filtered);
  return true;
}

/**
 * Nest a child prefab inside a parent prefab (OP-02). Rejects — with the
 * offending chain and WITHOUT mutating anything — when the edge would close a
 * cycle in the prefab graph, at any depth.
 *
 * @param parentPrefabId User-owned parent ID or name; built-in parents cannot be changed.
 * @param childPrefabId Existing child ID or name, resolved to its canonical identity.
 * @param overrides Optional bounded override metadata for the child reference.
 * @returns The persisted parent or an error for invalid sources, oversized overrides, or cycles. No nested engine entities are created.
 * @throws If library persistence fails.
 */
export function addNestedPrefab(
  parentPrefabId: string,
  childPrefabId: string,
  overrides?: PrefabOverrideMap,
): PrefabInstanceOpResult<Prefab> {
  const child = getPrefab(childPrefabId);
  if (!child) return { ok: false, error: `Child prefab not found: ${childPrefabId}` };
  // Internal callers and imported metadata still need the same size bound.
  if (!isOverrideMapWithinSizeLimit(overrides)) {
    return { ok: false, error: `Overrides exceed the ${MAX_OVERRIDE_MAP_BYTES}-byte size limit` };
  }

  // Only user prefabs are persistable; built-ins are frozen definitions.
  const userPrefabs = loadPrefabs();
  const parentSource = [...userPrefabs, ...getBuiltInPrefabs()].find(
    (prefab) => prefab.id === parentPrefabId || prefab.name === parentPrefabId,
  );
  const idx = userPrefabs.findIndex((p) => p.id === parentSource?.id);
  if (idx === -1) {
    return parentSource
      ? { ok: false, error: `Cannot nest into a built-in prefab: ${parentPrefabId}` }
      : { ok: false, error: `Parent prefab not found: ${parentPrefabId}` };
  }

  // Canonical `child.id`, not the raw (possibly name) input — `getChildPrefabIds`
  // below returns canonical ids from stored `children`, and mixing a name into
  // the same walk could hide a cycle that only manifests via the canonical id.
  const adjacency = new Map([...userPrefabs, ...getBuiltInPrefabs()].map(
    (prefab) => [prefab.id, (prefab.children ?? []).map((entry) => entry.prefabId)] as const,
  ));
  const cycle: CycleCheckResult = wouldCreateCycle(
    userPrefabs[idx].id,
    child.id,
    (id) => adjacency.get(id) ?? [],
  );
  if (cycle.hasCycle) {
    return {
      ok: false,
      error: `Cyclic prefab reference rejected: ${cycle.chain.join(' -> ')}`,
      cycle: cycle.chain,
    };
  }

  // `child.id` — the canonical id — not the raw `childPrefabId` input, which
  // may be a NAME (`getPrefab` resolves both). Storing anything but the
  // canonical id here would make this child ref inconsistent with
  // `createPrefabInstance`'s `source.id`, and fragile against the source
  // prefab later being renamed.
  const childRef: PrefabChildRef = createInstance(child.id, overrides);
  const parent = userPrefabs[idx];
  parent.children = [...(parent.children ?? []), childRef];
  parent.updatedAt = new Date().toISOString();
  savePrefabsToStorage(userPrefabs);
  return { ok: true, value: parent };
}

/**
 * Compute resolved snapshots for saved links to a source. Returns data only:
 * no viewport entities are changed. Non-overridden fields reflect the current
 * source; explicit override fields remain unchanged.
 *
 * @param prefabId Existing source ID or name.
 * @returns Resolved snapshots for saved links, or a missing-source result error; neither storage nor the viewport is changed.
 * @throws If source or override data cannot be cloned.
 */
export function applyPrefabToInstances(
  prefabId: string,
): PrefabInstanceOpResult<Array<{ instanceId: string; snapshot: PrefabSnapshot }>> {
  const source = getPrefab(prefabId);
  if (!source) return { ok: false, error: `Prefab not found: ${prefabId}` };
  const resolved = getPrefabInstances(source.id).map((instance) => ({
    instanceId: instance.instanceId,
    snapshot: resolveInstance(instance, source),
  }));
  return { ok: true, value: resolved };
}

// ===========================================================================
// Portability: embedding user prefab DEFINITIONS in a scene file
// (scene.FR-1 N1 — "portable scenes contain dangling links")
//
// `PrefabInstance.prefabId` and `PrefabChildRef.prefabId` are references into
// THIS browser's `forge-prefabs` localStorage. A scene that links a USER
// prefab is portable (cloud project, downloaded `.forge` file) but the
// definition it links to is not — opening that scene in another browser (or a
// remixed project under a different account, SEC-2) leaves the reference
// dangling: `getPrefab` returns nothing and `applyPrefabToInstances` fails.
// These two functions are the save/load pair that closes that gap by
// embedding the referenced definitions' transitive closure (an instance's
// source, and every prefab that source nests) alongside the instances, and
// merging them back in on load WITHOUT overwriting anything already local.
// Built-ins are never embedded: they ship with the app and resolve anywhere.
// ===========================================================================

/**
 * Every user-prefab `Prefab` transitively reachable from `instances` — each
 * instance's source, and every prefab that source (recursively) nests. Built-
 * in sources resolve everywhere already, so they are left out.
 *
 * @param instances Scene links whose source dependencies should accompany an export.
 * @returns Reachable user definitions, excluding built-ins; does not write storage.
 */
export function collectTransitivePrefabDefinitions(instances: PrefabInstance[]): Prefab[] {
  return collectPrefabDefinitionClosure(instances.map((i) => i.prefabId));
}

/** Cap on how many embedded definitions one scene load will import in one call. */
const MAX_MERGED_DEFINITIONS = 500;

/**
 * Build the complete proposed library before writing anything. Existing and
 * built-in ids win. Explicit deletions also remove incoming references to the
 * deleted id. A missing reference or a cycle *within the subgraph this merge
 * adds or depends on* rejects the entire proposed merge; corruption elsewhere
 * in the existing library is pre-existing and does not (see below).
 */
function prepareImportedDefinitions(definitions: unknown[]): Prefab[] | null {
  if (definitions.length > MAX_MERGED_DEFINITIONS + 1) return null;
  const existing = loadPrefabs();
  const builtIns = getBuiltInPrefabs();
  const existingIds = new Set([...existing, ...builtIns].map((prefab) => prefab.id));
  const deletedIds = loadDeletedPrefabIds();
  const additions: Prefab[] = [];
  for (const raw of definitions) {
    const definition = sanitizePrefabDefinition(raw);
    if (!definition) return null;
    if (existingIds.has(definition.id) || deletedIds.has(definition.id)) continue;
    existingIds.add(definition.id);
    additions.push({
      ...definition,
      ...(definition.children ? {
        children: definition.children.filter((child) => !deletedIds.has(child.prefabId)),
      } : {}),
    });
  }
  const proposed = [...existing, ...additions];
  const adjacency = new Map([...builtIns, ...proposed].map(
    (prefab) => [prefab.id, (prefab.children ?? []).map((child) => child.prefabId)] as const,
  ));
  // Validate only what this merge introduces or depends on: the additions plus
  // everything reachable from them. Sweeping the WHOLE proposed library instead
  // meant one pre-existing corrupt local prefab — an older build's leftover, a
  // cross-tab write, hand-edited localStorage — rejected EVERY merge; and since
  // `restorePrefabInstances` fails hard on a rejected merge, that reads to the
  // user as "no scene carrying embedded prefabs opens at all", with the save
  // gate down too. A dangling edge the merge neither adds nor relies on was
  // already in the library and is not this merge's to refuse. One the merge
  // WOULD rely on still fails here: an id with no `adjacency` entry is exactly
  // an unresolvable reference, and the walk below stops on it.
  const reachable = new Set<string>();
  const pending = additions.map((prefab) => prefab.id);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (reachable.has(id)) continue;
    reachable.add(id);
    const children = adjacency.get(id);
    if (!children) return null;
    for (const child of children) pending.push(child);
  }
  // A synthetic root checks every addition's component in a single DFS. Rooted
  // at the additions for the same reason as the reachability walk: a cycle that
  // predates this merge and that no addition can reach is not introduced by it.
  let graphRoot = '__prefab_graph_root__';
  while (adjacency.has(graphRoot)) graphRoot += '_';
  if (detectCycle(graphRoot, (id) => id === graphRoot ? additions.map((prefab) => prefab.id) : adjacency.get(id) ?? []).hasCycle) {
    return null;
  }
  return proposed;
}

/**
 * Merge a scene's embedded definitions without overwriting local definitions
 * or resurrecting deleted ids. Returns false for invalid, missing-target, or
 * cyclic graphs *that this merge adds or depends on*; rejection makes no
 * writes. A valid merge writes once.
 *
 * @param definitions Untrusted embedded definitions, capped at MAX_MERGED_DEFINITIONS (500).
 * @returns True for an empty input or successful validated merge; false for invalid dependency graphs without writing.
 * @throws If the validated library cannot be persisted.
 */
export function mergeImportedPrefabDefinitions(definitions: unknown[]): boolean {
  if (definitions.length === 0) return true;
  if (definitions.length > MAX_MERGED_DEFINITIONS) return false;
  const proposed = prepareImportedDefinitions(definitions);
  if (!proposed) return false;
  savePrefabsToStorage(proposed);
  return true;
}

// ===========================================================================
// Export-request staging (scene.FR-1 N1 race fix)
//
// `foldPrefabInstancesIntoSceneJson`-style folding used to read the LIVE
// instance registry when the `forge:scene-exported` answer arrived — which
// can be after the user has since loaded a different scene, overwriting the
// registry. Staging the registry at REQUEST time (keyed by the export's
// `requestId`, see `sceneExportWire.ts`) and consuming that snapshot instead
// of the live one closes the race: the fold reflects what was active when the
// save was REQUESTED, not whatever is active when the answer happens to land.
// ===========================================================================

/** Editor metadata captured together before an asynchronous engine export. */
export interface PrefabExportSnapshot {
  instances: PrefabInstance[];
  definitions: Prefab[];
}

const stagedInstancesByRequestId = new Map<string, PrefabExportSnapshot>();

/**
 * Bound on how many pending export requests may have a snapshot staged at
 * once (scene.FR-1 N1 — "failed exports leak instance snapshots"). A
 * successfully-answered export is always consumed by
 * `takeStagedPrefabDataForExport` inside the `SCENE_EXPORTED` handler,
 * and every caller that owns a timeout/abort path (`exportEngine.ts`) also
 * calls `discardStagedPrefabInstancesForExport` on every exit — but an entry
 * whose caller forgets that, or whose answer never arrives and is never
 * timed out, would otherwise retain its (potentially large) instance array
 * for the rest of the page's life. This cap is the defense-in-depth backstop
 * for exactly that case, not the primary cleanup mechanism.
 */
const MAX_STAGED_EXPORTS = 50;

/** Snapshot the current instance registry for a pending export `requestId`.
 *
 * @param requestId Correlation ID of the pending engine export.
 * @param instances Instance metadata to clone together with its transitive definitions.
 * @returns Nothing; replaces this request's staged snapshot, evicting the oldest request when the 50-entry cap is reached.
 * @throws If the snapshot cannot be serialized.
 */
export function stagePrefabInstancesForExport(requestId: string, instances: PrefabInstance[]): void {
  if (!stagedInstancesByRequestId.has(requestId) && stagedInstancesByRequestId.size >= MAX_STAGED_EXPORTS) {
    // `Map` preserves insertion order, so the first key is the oldest —
    // evict it to make room rather than let the map grow unbounded.
    const oldestKey = stagedInstancesByRequestId.keys().next().value;
    if (oldestKey !== undefined) stagedInstancesByRequestId.delete(oldestKey);
  }
  stagedInstancesByRequestId.set(requestId, JSON.parse(JSON.stringify({
    instances,
    definitions: collectTransitivePrefabDefinitions(instances),
  })) as PrefabExportSnapshot);
}

/**
 * Consume (take-once) the complete snapshot staged for `requestId`, including
 * the definitions captured at request time. Returns `undefined` — not the live
 * registry — when nothing was staged for it, so the caller can fall back to
 * `loadPrefabInstances()` itself for the uncorrelated paths (autosave, chat
 * `save_scene`, a pre-PF-1103 engine) that never staged one.
 *
 * This is deliberately the ONLY take-once reader of `stagedInstancesByRequestId`.
 * An instances-only sibling used to sit alongside it, and two take-once
 * consumers over one entry is a footgun: taking the instances silently consumed
 * that request's definitions too, so whichever consumer ran second saw nothing
 * staged and fell back to the live registry. Callers that want only the
 * instances read `.instances` off this snapshot.
 *
 * @param requestId Optional export correlation ID.
 * @returns The complete staged snapshot once, or undefined if absent; deletes the staging entry.
 */
export function takeStagedPrefabDataForExport(requestId: string | undefined): PrefabExportSnapshot | undefined {
  if (requestId === undefined) return undefined;
  const staged = stagedInstancesByRequestId.get(requestId);
  stagedInstancesByRequestId.delete(requestId);
  return staged;
}

/**
 * Discard a staged snapshot WITHOUT consuming it as an answer. Call from
 * every exit path that will never receive the matching `SCENE_EXPORTED`
 * answer — a timeout, an aborted export, an immediate rejection — so that
 * request's entry does not sit in the map for the rest of the page's life.
 * A no-op if nothing was staged for `requestId` (already taken, or never
 * staged), so callers may call this unconditionally on cleanup.
 *
 * @param requestId Correlation ID to release after an export failure or cancellation.
 * @returns Nothing; removes the staging entry if present.
 */
export function discardStagedPrefabInstancesForExport(requestId: string): void {
  stagedInstancesByRequestId.delete(requestId);
}
