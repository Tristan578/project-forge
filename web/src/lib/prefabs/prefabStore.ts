import type { MaterialData, LightData, PhysicsData, ScriptData, AudioData, ParticleData } from '@/stores/editorStore';
import {
  createAssetVersion,
  bumpAssetVersion,
  buildReferenceCrosswalk,
  reimportPreview,
  applyReimport,
  type AssetVersion,
  type PrefabInstance,
  type ReimportPreview,
  type ReimportResult,
  type ReferenceCrosswalk,
} from './assetVersion';

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
   * Version record for the prefab's source asset (#9812 / scene.FR-2). Optional
   * so prefabs persisted before version tracking still load; readers should
   * fall back to `createAssetVersion(prefab.snapshot)` when it is absent.
   */
  assetVersion?: AssetVersion;
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
    assetVersion: createAssetVersion(snapshot, undefined, now),
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
  instances: readonly PrefabInstance[],
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
  instances: readonly PrefabInstance[],
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
  instances: readonly PrefabInstance[],
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
