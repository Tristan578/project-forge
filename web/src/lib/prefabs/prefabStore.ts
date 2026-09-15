import type { MaterialData, LightData, PhysicsData, ScriptData, AudioData, ParticleData } from '@/stores/editorStore';
import {
  createInstance,
  resolveInstance,
  wouldCreateCycle,
  isOverrideMapWithinSizeLimit,
  MAX_OVERRIDE_MAP_BYTES,
  type PrefabInstance,
  type PrefabChildRef,
  type PrefabOverrideMap,
  type CycleCheckResult,
} from './prefabInstance';

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
}

const PREFAB_STORAGE_KEY = 'forge-prefabs';

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

/** Update an existing prefab's snapshot */
export function updatePrefab(id: string, snapshot: PrefabSnapshot): boolean {
  const prefabs = loadPrefabs();
  const idx = prefabs.findIndex(p => p.id === id);
  if (idx === -1) return false;
  prefabs[idx].snapshot = snapshot;
  prefabs[idx].updatedAt = new Date().toISOString();
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

/** Export prefab as JSON string */
export function exportPrefab(id: string): string | null {
  const prefab = getPrefab(id);
  return prefab ? JSON.stringify(prefab, null, 2) : null;
}

/** Cap on how many nested children one imported prefab may carry (defense in depth). */
const MAX_IMPORTED_CHILDREN = 200;

/**
 * Validate and sanitize the `children` array out of an imported prefab's JSON.
 * Untrusted input (a file from disk, or another user's export), so every field
 * is checked rather than trusted — same posture as `sanitizeInstanceRecord`
 * for scene-file `prefabInstances`. A malformed entry is dropped, not the
 * whole import, since a partially-nested prefab is still useful; the flat
 * `snapshot` this prefab was created from is never affected either way.
 */
function sanitizeImportedChildren(raw: unknown): PrefabChildRef[] {
  if (!Array.isArray(raw)) return [];
  const out: PrefabChildRef[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_IMPORTED_CHILDREN) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.prefabId !== 'string' || candidate.prefabId.length === 0) continue;
    const overrides =
      typeof candidate.overrides === 'object' && candidate.overrides !== null && !Array.isArray(candidate.overrides)
        ? (candidate.overrides as PrefabOverrideMap)
        : undefined;
    if (overrides && !isOverrideMapWithinSizeLimit(overrides)) continue;
    // Mint a fresh instanceId rather than trust the imported one — instanceIds
    // are meant to be unique per nesting edge within THIS library, and a
    // reimported file could otherwise collide with an id already in use.
    out.push(createInstance(candidate.prefabId, overrides));
  }
  return out;
}

/**
 * Import prefab from JSON string, including nested `children` when present
 * (scene.FR-1 N1) — a flat `savePrefab` would otherwise silently discard them,
 * flattening any nested prefab on export/reimport round-trip.
 */
export function importPrefab(json: string): Prefab | null {
  try {
    const data = JSON.parse(json);
    if (!data.name || !data.snapshot) return null;
    const created = savePrefab(data.name, data.category || 'imported', data.description || '', data.snapshot);
    const children = sanitizeImportedChildren(data.children);
    if (children.length > 0) {
      const prefabs = loadPrefabs();
      const idx = prefabs.findIndex((p) => p.id === created.id);
      if (idx !== -1) {
        prefabs[idx] = { ...prefabs[idx], children };
        savePrefabsToStorage(prefabs);
        created.children = children;
      }
    }
    return created;
  } catch { return null; }
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

/** Load the persisted instance registry. */
export function loadPrefabInstances(): PrefabInstance[] {
  try {
    const stored = localStorage.getItem(PREFAB_INSTANCES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

/** Persist the instance registry. */
export function savePrefabInstancesToStorage(instances: PrefabInstance[]): void {
  localStorage.setItem(PREFAB_INSTANCES_STORAGE_KEY, JSON.stringify(instances));
}

/** All instances linked to a given source prefab. */
export function getPrefabInstances(prefabId: string): PrefabInstance[] {
  return loadPrefabInstances().filter((i) => i.prefabId === prefabId);
}

/**
 * Create and persist a linked instance of a source prefab (OP-01). Rejects when
 * the source prefab does not exist rather than persisting a dangling link.
 */
export function createPrefabInstance(
  prefabId: string,
  overrides?: PrefabOverrideMap,
  entityId?: string,
): PrefabInstanceOpResult<PrefabInstance> {
  const source = getPrefab(prefabId);
  if (!source) return { ok: false, error: `Prefab not found: ${prefabId}` };
  // Rejected explicitly (SEC) rather than silently truncated: both the manual
  // "Create Instance" control and the `create_prefab_instance` chat command
  // reach this, and an oversized override reaching `localStorage`
  // serialization on every future save is exactly the resource-exhaustion
  // vector the bound exists to prevent.
  if (!isOverrideMapWithinSizeLimit(overrides)) {
    return { ok: false, error: `Overrides exceed the ${MAX_OVERRIDE_MAP_BYTES}-byte size limit` };
  }
  const instance = createInstance(source.id, overrides, entityId);
  const instances = loadPrefabInstances();
  instances.push(instance);
  savePrefabInstancesToStorage(instances);
  return { ok: true, value: instance };
}

/** Delete one instance by id. Returns whether anything was removed. */
export function deletePrefabInstance(instanceId: string): boolean {
  const instances = loadPrefabInstances();
  const filtered = instances.filter((i) => i.instanceId !== instanceId);
  if (filtered.length === instances.length) return false;
  savePrefabInstancesToStorage(filtered);
  return true;
}

/** The prefab ids a prefab directly nests — the nesting graph edge set. */
function getChildPrefabIds(prefabId: string): string[] {
  const prefab = getPrefab(prefabId);
  return (prefab?.children ?? []).map((c) => c.prefabId);
}

/**
 * Nest a child prefab inside a parent prefab (OP-02). Rejects — with the
 * offending chain and WITHOUT mutating anything — when the edge would close a
 * cycle in the prefab graph, at any depth.
 */
export function addNestedPrefab(
  parentPrefabId: string,
  childPrefabId: string,
  overrides?: PrefabOverrideMap,
): PrefabInstanceOpResult<Prefab> {
  const child = getPrefab(childPrefabId);
  if (!child) return { ok: false, error: `Child prefab not found: ${childPrefabId}` };
  // SEC: same resource-exhaustion bound as `createPrefabInstance` — this is the
  // other public entry point (manual "Nest Prefab" control + `nest_prefab` chat
  // command) that lets a caller attach an override map.
  if (!isOverrideMapWithinSizeLimit(overrides)) {
    return { ok: false, error: `Overrides exceed the ${MAX_OVERRIDE_MAP_BYTES}-byte size limit` };
  }

  // Only user prefabs are persistable; built-ins are frozen definitions.
  const userPrefabs = loadPrefabs();
  const idx = userPrefabs.findIndex((p) => p.id === parentPrefabId);
  if (idx === -1) {
    return getPrefab(parentPrefabId)
      ? { ok: false, error: `Cannot nest into a built-in prefab: ${parentPrefabId}` }
      : { ok: false, error: `Parent prefab not found: ${parentPrefabId}` };
  }

  // Canonical `child.id`, not the raw (possibly name) input — `getChildPrefabIds`
  // below returns canonical ids from stored `children`, and mixing a name into
  // the same walk could hide a cycle that only manifests via the canonical id.
  const cycle: CycleCheckResult = wouldCreateCycle(parentPrefabId, child.id, getChildPrefabIds);
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
 * Propagate the current source prefab onto all of its linked instances (OP-04)
 * — the operation behind the manual "Apply to Instances" control and the
 * equivalent AI command. Returns one resolved snapshot per instance: every
 * non-overridden field reflects the source, every overridden field is
 * preserved. Instances keep their durable override sets untouched.
 */
export function applyPrefabToInstances(
  prefabId: string,
): PrefabInstanceOpResult<Array<{ instanceId: string; snapshot: PrefabSnapshot }>> {
  const source = getPrefab(prefabId);
  if (!source) return { ok: false, error: `Prefab not found: ${prefabId}` };
  const resolved = getPrefabInstances(prefabId).map((instance) => ({
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
 */
export function collectTransitivePrefabDefinitions(instances: PrefabInstance[]): Prefab[] {
  const userPrefabs = loadPrefabs();
  const byId = new Map(userPrefabs.map((p) => [p.id, p] as const));
  const collected = new Map<string, Prefab>();
  const visit = (id: string): void => {
    if (collected.has(id)) return;
    const prefab = byId.get(id);
    if (!prefab) return; // built-in, or a dangling id — nothing local to embed
    collected.set(id, prefab);
    for (const child of prefab.children ?? []) visit(child.prefabId);
  };
  for (const instance of instances) visit(instance.prefabId);
  return Array.from(collected.values());
}

/** Cap on how many embedded definitions one scene load will import in one call. */
const MAX_MERGED_DEFINITIONS = 500;

/**
 * Merge prefab definitions embedded in a loaded scene into the local prefab
 * library, adding only those whose id is not already present. A local
 * definition — whether pre-existing or since edited — always wins: this never
 * overwrites, so opening a scene can only ADD prefabs to the library, never
 * silently revert one the user has since changed.
 */
export function mergeImportedPrefabDefinitions(definitions: Prefab[]): void {
  if (definitions.length === 0) return;
  const existing = loadPrefabs();
  const existingIds = new Set(existing.map((p) => p.id));
  const toAdd: Prefab[] = [];
  for (const def of definitions) {
    if (toAdd.length >= MAX_MERGED_DEFINITIONS) break;
    if (!def || typeof def.id !== 'string' || typeof def.name !== 'string' || !def.snapshot) continue;
    if (existingIds.has(def.id)) continue;
    existingIds.add(def.id);
    toAdd.push(def);
  }
  if (toAdd.length === 0) return;
  savePrefabsToStorage([...existing, ...toAdd]);
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

const stagedInstancesByRequestId = new Map<string, PrefabInstance[]>();

/** Snapshot the current instance registry for a pending export `requestId`. */
export function stagePrefabInstancesForExport(requestId: string, instances: PrefabInstance[]): void {
  stagedInstancesByRequestId.set(requestId, instances);
}

/**
 * Consume (take-once) the snapshot staged for `requestId`. Returns `undefined`
 * — not the live registry — when nothing was staged for it, so the caller can
 * fall back to `loadPrefabInstances()` itself for the uncorrelated paths
 * (autosave, chat `save_scene`, a pre-PF-1103 engine) that never staged one.
 */
export function takeStagedPrefabInstancesForExport(requestId: string | undefined): PrefabInstance[] | undefined {
  if (requestId === undefined) return undefined;
  const staged = stagedInstancesByRequestId.get(requestId);
  stagedInstancesByRequestId.delete(requestId);
  return staged;
}
