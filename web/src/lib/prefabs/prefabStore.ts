import type { MaterialData, LightData, PhysicsData, ScriptData, AudioData, ParticleData } from '@/stores/editorStore';
import {
  createInstance,
  resolveInstance,
  wouldCreateCycle,
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

/** Delete a prefab by ID */
export function deletePrefab(id: string): boolean {
  const prefabs = loadPrefabs();
  const filtered = prefabs.filter(p => p.id !== id);
  if (filtered.length === prefabs.length) return false;
  savePrefabsToStorage(filtered);
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

/** Import prefab from JSON string */
export function importPrefab(json: string): Prefab | null {
  try {
    const data = JSON.parse(json);
    if (!data.name || !data.snapshot) return null;
    return savePrefab(data.name, data.category || 'imported', data.description || '', data.snapshot);
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

  // Only user prefabs are persistable; built-ins are frozen definitions.
  const userPrefabs = loadPrefabs();
  const idx = userPrefabs.findIndex((p) => p.id === parentPrefabId);
  if (idx === -1) {
    return getPrefab(parentPrefabId)
      ? { ok: false, error: `Cannot nest into a built-in prefab: ${parentPrefabId}` }
      : { ok: false, error: `Parent prefab not found: ${parentPrefabId}` };
  }

  const cycle: CycleCheckResult = wouldCreateCycle(parentPrefabId, childPrefabId, getChildPrefabIds);
  if (cycle.hasCycle) {
    return {
      ok: false,
      error: `Cyclic prefab reference rejected: ${cycle.chain.join(' -> ')}`,
      cycle: cycle.chain,
    };
  }

  const childRef: PrefabChildRef = createInstance(childPrefabId, overrides);
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
