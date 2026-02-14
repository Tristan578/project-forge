import type { MaterialData, LightData, PhysicsData, ScriptData, AudioData, ParticleData } from '@/stores/editorStore';

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
