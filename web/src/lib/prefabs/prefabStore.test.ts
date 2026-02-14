import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  savePrefab,
  loadPrefabs,
  deletePrefab,
  getPrefab,
  updatePrefab,
  listAllPrefabs,
  searchPrefabs,
  getPrefabsByCategory,
  getPrefabCategories,
  exportPrefab,
  importPrefab,
  getBuiltInPrefabs,
  type PrefabSnapshot,
} from './prefabStore';

// Mock localStorage
let storage: Record<string, string> = {};
beforeEach(() => {
  storage = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { storage[key] = value; }),
    removeItem: vi.fn((key: string) => { delete storage[key]; }),
  });
});

const mockSnapshot: PrefabSnapshot = {
  entityType: 'cube',
  name: 'Test Cube',
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
};

describe('CRUD Operations', () => {
  it('savePrefab creates prefab with correct fields', () => {
    const prefab = savePrefab('TestPrefab', 'TestCategory', 'Test description', mockSnapshot);
    expect(prefab.id).toMatch(/^prefab_\d+_[a-z0-9]+$/);
    expect(prefab.name).toBe('TestPrefab');
    expect(prefab.category).toBe('TestCategory');
    expect(prefab.description).toBe('Test description');
    expect(prefab.snapshot).toEqual(mockSnapshot);
    expect(prefab.createdAt).toBeTruthy();
    expect(prefab.updatedAt).toBeTruthy();
  });

  it('savePrefab generates unique IDs', () => {
    const p1 = savePrefab('Prefab1', 'cat', '', mockSnapshot);
    const p2 = savePrefab('Prefab2', 'cat', '', mockSnapshot);
    expect(p1.id).not.toBe(p2.id);
  });

  it('loadPrefabs returns empty array initially', () => {
    const prefabs = loadPrefabs();
    expect(prefabs).toEqual([]);
  });

  it('loadPrefabs returns saved prefabs', () => {
    savePrefab('P1', 'cat', '', mockSnapshot);
    savePrefab('P2', 'cat', '', mockSnapshot);
    const prefabs = loadPrefabs();
    expect(prefabs).toHaveLength(2);
    expect(prefabs[0].name).toBe('P1');
    expect(prefabs[1].name).toBe('P2');
  });

  it('deletePrefab removes by ID', () => {
    const prefab = savePrefab('ToDelete', 'cat', '', mockSnapshot);
    const result = deletePrefab(prefab.id);
    expect(result).toBe(true);
    const prefabs = loadPrefabs();
    expect(prefabs).toHaveLength(0);
  });

  it('deletePrefab returns false for nonexistent ID', () => {
    const result = deletePrefab('nonexistent_id');
    expect(result).toBe(false);
  });

  it('getPrefab finds by ID', () => {
    const prefab = savePrefab('FindMe', 'cat', '', mockSnapshot);
    const found = getPrefab(prefab.id);
    expect(found).toBeTruthy();
    expect(found?.name).toBe('FindMe');
  });

  it('getPrefab finds by name', () => {
    savePrefab('UniqueName', 'cat', '', mockSnapshot);
    const found = getPrefab('UniqueName');
    expect(found).toBeTruthy();
    expect(found?.name).toBe('UniqueName');
  });

  it('updatePrefab modifies snapshot', () => {
    const prefab = savePrefab('Original', 'cat', '', mockSnapshot);
    const originalUpdatedAt = prefab.updatedAt;
    const newSnapshot: PrefabSnapshot = {
      ...mockSnapshot,
      name: 'Updated Cube',
    };
    const result = updatePrefab(prefab.id, newSnapshot);
    expect(result).toBe(true);
    const updated = getPrefab(prefab.id);
    expect(updated?.snapshot.name).toBe('Updated Cube');
    // Updated timestamp should be different (or at least >= original)
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(originalUpdatedAt).getTime());
  });

  it('updatePrefab returns false for nonexistent ID', () => {
    const result = updatePrefab('nonexistent', mockSnapshot);
    expect(result).toBe(false);
  });
});

describe('Built-in Prefabs', () => {
  it('getBuiltInPrefabs returns 8 prefabs', () => {
    const builtIns = getBuiltInPrefabs();
    expect(builtIns).toHaveLength(8);
  });

  it('All built-ins have required fields', () => {
    const builtIns = getBuiltInPrefabs();
    builtIns.forEach(prefab => {
      expect(prefab.id).toBeTruthy();
      expect(prefab.name).toBeTruthy();
      expect(prefab.category).toBeTruthy();
      expect(prefab.description).toBeTruthy();
      expect(prefab.snapshot).toBeTruthy();
      expect(prefab.snapshot.entityType).toBeTruthy();
      expect(prefab.snapshot.name).toBeTruthy();
      expect(prefab.snapshot.transform).toBeTruthy();
      expect(prefab.createdAt).toBeTruthy();
      expect(prefab.updatedAt).toBeTruthy();
    });
  });

  it('No duplicate built-in IDs', () => {
    const builtIns = getBuiltInPrefabs();
    const ids = builtIns.map(p => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('Built-in prefabs not deletable from user storage', () => {
    const builtIn = getBuiltInPrefabs()[0];
    const result = deletePrefab(builtIn.id);
    expect(result).toBe(false);
  });

  it('getPrefab finds built-in by name', () => {
    const found = getPrefab('Basic Player');
    expect(found).toBeTruthy();
    expect(found?.id).toBe('builtin_player');
  });

  it('Built-in prefabs have expected categories', () => {
    const builtIns = getBuiltInPrefabs();
    const categories = new Set(builtIns.map(p => p.category));
    expect(categories.has('Characters')).toBe(true);
    expect(categories.has('Items')).toBe(true);
    expect(categories.has('Props')).toBe(true);
    expect(categories.has('Lights')).toBe(true);
    expect(categories.has('Effects')).toBe(true);
  });
});

describe('Search & Filter', () => {
  beforeEach(() => {
    savePrefab('PlayerCharacter', 'Characters', '', mockSnapshot);
    savePrefab('EnemyBot', 'Characters', '', mockSnapshot);
    savePrefab('WoodenCrate', 'Props', '', mockSnapshot);
    savePrefab('MetalBarrel', 'Props', '', mockSnapshot);
  });

  it('searchPrefabs with empty query returns all', () => {
    const results = searchPrefabs('');
    expect(results.length).toBeGreaterThanOrEqual(4 + 8); // 4 custom + 8 built-in
  });

  it('searchPrefabs matches by name', () => {
    const results = searchPrefabs('Player');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(p => p.name.includes('Player'))).toBe(true);
  });

  it('searchPrefabs is case-insensitive', () => {
    const results = searchPrefabs('player');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(p => p.name.toLowerCase().includes('player'))).toBe(true);
  });

  it('searchPrefabs matches by category', () => {
    const results = searchPrefabs('Props');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every(p => p.category === 'Props')).toBe(true);
  });

  it('getPrefabsByCategory returns correct subset', () => {
    const props = getPrefabsByCategory('Props');
    expect(props.length).toBeGreaterThanOrEqual(2);
    expect(props.every(p => p.category === 'Props')).toBe(true);
  });

  it('getPrefabCategories returns unique categories', () => {
    const categories = getPrefabCategories();
    expect(categories.includes('Characters')).toBe(true);
    expect(categories.includes('Props')).toBe(true);
    expect(categories.includes('Items')).toBe(true);
    expect(categories.includes('Lights')).toBe(true);
    expect(categories.includes('Effects')).toBe(true);
    const uniqueCategories = new Set(categories);
    expect(uniqueCategories.size).toBe(categories.length);
  });

  it('listAllPrefabs includes both user and built-in', () => {
    const all = listAllPrefabs();
    expect(all.length).toBeGreaterThanOrEqual(4 + 8);
    expect(all.some(p => p.id.startsWith('builtin_'))).toBe(true);
    expect(all.some(p => p.id.startsWith('prefab_'))).toBe(true);
  });
});

describe('Import/Export', () => {
  it('exportPrefab returns JSON string', () => {
    const prefab = savePrefab('ExportTest', 'cat', 'desc', mockSnapshot);
    const json = exportPrefab(prefab.id);
    expect(json).toBeTruthy();
    expect(() => JSON.parse(json!)).not.toThrow();
    const parsed = JSON.parse(json!);
    expect(parsed.name).toBe('ExportTest');
    expect(parsed.snapshot).toEqual(mockSnapshot);
  });

  it('exportPrefab returns null for nonexistent ID', () => {
    const json = exportPrefab('nonexistent');
    expect(json).toBeNull();
  });

  it('importPrefab creates new prefab from JSON', () => {
    const prefab = savePrefab('Original', 'TestCat', 'desc', mockSnapshot);
    const json = exportPrefab(prefab.id);

    // Clear storage and re-import
    storage = {};
    const imported = importPrefab(json!);
    expect(imported).toBeTruthy();
    expect(imported?.name).toBe('Original');
    // Should preserve the original category from the JSON
    expect(imported?.category).toBe('TestCat');
    expect(imported?.snapshot).toEqual(mockSnapshot);
  });

  it('importPrefab returns null for invalid JSON', () => {
    const result = importPrefab('not valid json');
    expect(result).toBeNull();
  });

  it('importPrefab returns null for JSON missing required fields', () => {
    const invalidJson = JSON.stringify({ name: 'Test' }); // missing snapshot
    const result = importPrefab(invalidJson);
    expect(result).toBeNull();
  });

  it('importPrefab uses default category if missing', () => {
    const json = JSON.stringify({
      name: 'NoCategory',
      snapshot: mockSnapshot,
    });
    const imported = importPrefab(json);
    expect(imported?.category).toBe('imported');
  });
});

describe('Edge Cases', () => {
  it('savePrefab defaults empty category to uncategorized', () => {
    const prefab = savePrefab('Test', '', '', mockSnapshot);
    expect(prefab.category).toBe('uncategorized');
  });

  it('savePrefab defaults empty description to empty string', () => {
    const prefab = savePrefab('Test', 'cat', '', mockSnapshot);
    expect(prefab.description).toBe('');
  });

  it('loadPrefabs handles corrupted storage gracefully', () => {
    storage['forge-prefabs'] = 'not json';
    const prefabs = loadPrefabs();
    expect(prefabs).toEqual([]);
  });

  it('searchPrefabs handles whitespace-only query', () => {
    const results = searchPrefabs('   ');
    expect(results.length).toBeGreaterThanOrEqual(8);
  });

  it('getPrefab returns undefined for nonexistent prefab', () => {
    const found = getPrefab('DoesNotExist');
    expect(found).toBeUndefined();
  });
});
