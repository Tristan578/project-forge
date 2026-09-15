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
  getPrefabAssetVersion,
  getPrefabReferenceCrosswalk,
  previewPrefabReimport,
  reimportPrefab,
  type PrefabSnapshot,
} from './prefabStore';
import { hashSnapshot, type PrefabInstance } from './assetVersion';

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
    expect(prefab.createdAt).not.toBe('');
    expect(prefab.updatedAt).not.toBe('');
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
    expect(found).toBeDefined();
    expect(found?.name).toBe('FindMe');
  });

  it('getPrefab finds by name', () => {
    savePrefab('UniqueName', 'cat', '', mockSnapshot);
    const found = getPrefab('UniqueName');
    expect(found).toBeDefined();
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
      expect(prefab.id).not.toBe('');
      expect(prefab.name).not.toBe('');
      expect(prefab.category).not.toBe('');
      expect(prefab.description).not.toBe('');
      expect(prefab.snapshot).toBeDefined();
      expect(prefab.snapshot.entityType).not.toBe('');
      expect(prefab.snapshot.name).not.toBe('');
      expect(prefab.snapshot.transform).toBeDefined();
      expect(prefab.createdAt).not.toBe('');
      expect(prefab.updatedAt).not.toBe('');
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
    expect(found).toBeDefined();
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
    expect(json).toBeTypeOf('string');
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
    expect(imported).toBeDefined();
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

// ---------------------------------------------------------------------------
// Asset version tracking + reimport (#9812 / scene.FR-2)
// ---------------------------------------------------------------------------

const richSnapshot: PrefabSnapshot = {
  entityType: 'cube',
  name: 'Crate',
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  material: {
    baseColor: [0.5, 0.3, 0.15, 1], metallic: 0, perceptualRoughness: 0.7, reflectance: 0.5,
    emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5,
    doubleSided: false, unlit: false, uvOffset: [0, 0], uvScale: [1, 1], uvRotation: 0,
    parallaxDepthScale: 0.1, parallaxMappingMethod: 'occlusion', maxParallaxLayerCount: 16,
    parallaxReliefMaxSteps: 5, clearcoat: 0, clearcoatPerceptualRoughness: 0.5,
    specularTransmission: 0, diffuseTransmission: 0, ior: 1.5, thickness: 0,
    attenuationDistance: null, attenuationColor: [1, 1, 1],
  },
  script: { source: 'function onUpdate(dt) {}', enabled: true, template: 'noop' },
};

function nextSourceFrom(base: PrefabSnapshot): PrefabSnapshot {
  return {
    ...base,
    material: { ...base.material!, baseColor: [0.1, 0.8, 0.2, 1] },
    script: { source: 'function onUpdate(dt) { forge.rotate(entityId, 0, dt, 0); }', enabled: true, template: 'spin' },
  };
}

describe('scene.FR-2.OP-01 asset version records', () => {
  it('savePrefab initializes a version-1 record whose hash matches the snapshot', () => {
    const prefab = savePrefab('Crate', 'Props', '', richSnapshot);
    expect(prefab.assetVersion).toBeDefined();
    expect(prefab.assetVersion!.versionNumber).toBe(1);
    expect(prefab.assetVersion!.sourceHash).toBe(hashSnapshot(richSnapshot));
  });

  it('built-in prefabs carry a version-1 record with the sentinel date', () => {
    const builtIn = getBuiltInPrefabs()[0];
    expect(builtIn.assetVersion).toBeDefined();
    expect(builtIn.assetVersion!.versionNumber).toBe(1);
    expect(builtIn.assetVersion!.createdAt).toBe('2024-01-01T00:00:00Z');
  });

  it('updatePrefab bumps the version and refreshes the hash', () => {
    const prefab = savePrefab('Crate', 'Props', '', richSnapshot);
    const next = nextSourceFrom(richSnapshot);
    expect(updatePrefab(prefab.id, next)).toBe(true);
    const version = getPrefabAssetVersion(prefab.id)!;
    expect(version.versionNumber).toBe(2);
    expect(version.sourceHash).toBe(hashSnapshot(next));
  });

  it('getPrefabAssetVersion synthesizes a version for a legacy record without one', () => {
    savePrefab('Legacy', 'Props', '', richSnapshot);
    // Simulate a pre-versioning record persisted to storage.
    const raw = loadPrefabs();
    delete raw[0].assetVersion;
    localStorage.setItem('forge-prefabs', JSON.stringify(raw));
    const version = getPrefabAssetVersion(raw[0].id)!;
    expect(version.versionNumber).toBe(1);
    expect(version.sourceHash).toBe(hashSnapshot(richSnapshot));
  });

  it('getPrefabReferenceCrosswalk maps a prefab to its referencing instances', () => {
    const prefab = savePrefab('Crate', 'Props', '', richSnapshot);
    const instances: PrefabInstance[] = [
      { id: 'i1', prefabId: prefab.id, snapshot: richSnapshot, overrides: [] },
      { id: 'i2', prefabId: 'other', snapshot: richSnapshot, overrides: [] },
    ];
    const crosswalk = getPrefabReferenceCrosswalk(prefab.id, instances);
    expect(crosswalk.instanceIds).toEqual(['i1']);
    expect(crosswalk.referenceCount).toBe(1);
  });
});

describe('scene.FR-2.OP-02 previewPrefabReimport', () => {
  it('previews affected fields for a known prefab without persisting', () => {
    const prefab = savePrefab('Crate', 'Props', '', richSnapshot);
    const instances: PrefabInstance[] = [{ id: 'i1', prefabId: prefab.id, snapshot: richSnapshot, overrides: [] }];
    const preview = previewPrefabReimport(prefab.id, nextSourceFrom(richSnapshot), instances);
    expect(preview.ok).toBe(true);
    expect(preview.affectedInstanceIds).toEqual(['i1']);
    // storage version unchanged by a preview
    expect(getPrefabAssetVersion(prefab.id)!.versionNumber).toBe(1);
  });

  it('reports unknown-prefab rather than throwing', () => {
    const preview = previewPrefabReimport('does_not_exist', richSnapshot, []);
    expect(preview.ok).toBe(false);
    expect(preview.reason).toBe('unknown-prefab');
  });
});

describe('scene.FR-2.OP-03 reimportPrefab transactional apply', () => {
  it('replaces the source, bumps the version, and preserves protected/override fields', () => {
    const prefab = savePrefab('Crate', 'Props', '', richSnapshot);
    const next = nextSourceFrom(richSnapshot);
    const instances: PrefabInstance[] = [
      { id: 'i1', prefabId: prefab.id, snapshot: richSnapshot, overrides: [] },
      { id: 'i2', prefabId: prefab.id, snapshot: richSnapshot, overrides: ['material'] },
    ];
    const result = reimportPrefab(prefab.id, next, instances);
    expect(result.ok).toBe(true);
    expect(result.version!.versionNumber).toBe(2);
    expect(result.affectedInstanceIds).toEqual(['i1']);

    // persisted: prefab source is now the re-read asset at version 2
    const stored = getPrefab(prefab.id)!;
    expect(stored.snapshot.material!.baseColor).toEqual([0.1, 0.8, 0.2, 1]);
    expect(stored.assetVersion!.versionNumber).toBe(2);

    const i1 = result.updatedInstances.find(i => i.id === 'i1')!;
    expect(i1.snapshot.material!.baseColor).toEqual([0.1, 0.8, 0.2, 1]);
    expect(i1.snapshot.script!.template).toBe('noop'); // script protected by default
    const i2 = result.updatedInstances.find(i => i.id === 'i2')!;
    expect(i2.snapshot.material!.baseColor).toEqual([0.5, 0.3, 0.15, 1]); // override preserved
  });

  it('rejects a missing source and leaves the persisted version untouched', () => {
    const prefab = savePrefab('Crate', 'Props', '', richSnapshot);
    const result = reimportPrefab(prefab.id, null, []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-source');
    const stored = getPrefab(prefab.id)!;
    expect(stored.assetVersion!.versionNumber).toBe(1);
    expect(stored.snapshot.material!.baseColor).toEqual([0.5, 0.3, 0.15, 1]);
  });

  it('rejects an incompatible source and retains the prior playable version', () => {
    const prefab = savePrefab('Crate', 'Props', '', richSnapshot);
    const incompatible: PrefabSnapshot = { ...nextSourceFrom(richSnapshot), entityType: 'sphere' };
    const result = reimportPrefab(prefab.id, incompatible, []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('incompatible-source');
    expect(getPrefab(prefab.id)!.assetVersion!.versionNumber).toBe(1);
  });

  it('rejects reimport of a read-only built-in prefab', () => {
    const builtIn = getBuiltInPrefabs()[0];
    const result = reimportPrefab(builtIn.id, builtIn.snapshot, []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('read-only-prefab');
  });

  it('reports unknown-prefab for an id in neither storage nor built-ins', () => {
    const result = reimportPrefab('does_not_exist', richSnapshot, []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown-prefab');
  });
});
