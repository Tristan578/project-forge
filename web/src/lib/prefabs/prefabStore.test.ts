import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  savePrefab,
  loadPrefabs,
  savePrefabsToStorage,
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
  createPrefabInstance,
  getPrefabInstances,
  deletePrefabInstance,
  loadPrefabInstances,
  addNestedPrefab,
  applyPrefabToInstances,
  collectTransitivePrefabDefinitions,
  mergeImportedPrefabDefinitions,
  stagePrefabInstancesForExport,
  takeStagedPrefabInstancesForExport,
  discardStagedPrefabInstancesForExport,
  sanitizePrefabDefinition,
  subscribeToPrefabChanges,
  type PrefabSnapshot,
} from './prefabStore';
import { MAX_OVERRIDE_MAP_BYTES } from './prefabInstance';

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

describe('Nested / linked prefab instances', () => {
  it('createPrefabInstance links an existing source and persists it (OP-01)', () => {
    const source = savePrefab('Source', 'cat', '', mockSnapshot);
    const result = createPrefabInstance(source.id, { name: 'Instanced' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prefabId).toBe(source.id);
    expect(result.value.overrides).toEqual({ name: 'Instanced' });
    expect(getPrefabInstances(source.id)).toHaveLength(1);
    expect(loadPrefabInstances()).toHaveLength(1);
  });

  it('createPrefabInstance rejects a dangling link to a missing prefab', () => {
    const result = createPrefabInstance('nope');
    expect(result).toEqual({ ok: false, error: 'Prefab not found: nope' });
    expect(loadPrefabInstances()).toHaveLength(0);
  });

  it('deletePrefabInstance removes by id', () => {
    const source = savePrefab('Source', 'cat', '', mockSnapshot);
    const created = createPrefabInstance(source.id);
    if (!created.ok) throw new Error('setup failed');
    expect(deletePrefabInstance(created.value.instanceId)).toBe(true);
    expect(getPrefabInstances(source.id)).toHaveLength(0);
    expect(deletePrefabInstance('missing')).toBe(false);
  });

  it('applyPrefabToInstances propagates source changes but preserves overrides (OP-04)', () => {
    const source = savePrefab('Source', 'cat', '', { ...mockSnapshot, entityType: 'cube', name: 'Base' });
    const created = createPrefabInstance(source.id, { name: 'Kept' });
    if (!created.ok) throw new Error('setup failed');

    // Update the source prefab: entityType changes, name changes.
    updatePrefab(source.id, { ...mockSnapshot, entityType: 'sphere', name: 'NewBase' });

    const applied = applyPrefabToInstances(source.id);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value).toHaveLength(1);
    const snap = applied.value[0].snapshot;
    expect(snap.entityType).toBe('sphere'); // inherited from updated source
    expect(snap.name).toBe('Kept'); // override preserved
  });

  it('applyPrefabToInstances rejects a missing prefab', () => {
    expect(applyPrefabToInstances('nope')).toEqual({ ok: false, error: 'Prefab not found: nope' });
  });

  it('addNestedPrefab nests a child under a user prefab (OP-02)', () => {
    const parent = savePrefab('Parent', 'cat', '', mockSnapshot);
    const child = savePrefab('Child', 'cat', '', mockSnapshot);
    const result = addNestedPrefab(parent.id, child.id);
    expect(result.ok).toBe(true);
    const updated = getPrefab(parent.id);
    expect(updated?.children).toHaveLength(1);
    expect(updated?.children?.[0].prefabId).toBe(child.id);
  });

  it('addNestedPrefab rejects a missing child with no mutation (OP-02)', () => {
    // The first guard in addNestedPrefab: a child id that resolves to no prefab
    // must be refused before the parent is ever touched, so a dangling link is
    // never written into the parent's children.
    const parent = savePrefab('Parent', 'cat', '', mockSnapshot);
    const result = addNestedPrefab(parent.id, 'nonexistent');
    expect(result).toEqual({ ok: false, error: 'Child prefab not found: nonexistent' });
    expect(getPrefab(parent.id)?.children ?? []).toHaveLength(0); // unmutated
  });

  it('addNestedPrefab rejects a direct self-reference with the chain and no mutation (OP-02)', () => {
    const prefab = savePrefab('SelfRef', 'cat', '', mockSnapshot);
    const result = addNestedPrefab(prefab.id, prefab.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cycle).toEqual([prefab.id, prefab.id]);
    expect(getPrefab(prefab.id)?.children ?? []).toHaveLength(0); // unmutated
  });

  it('addNestedPrefab rejects a multi-level cycle (A->B->A) with no mutation (OP-02)', () => {
    const a = savePrefab('A', 'cat', '', mockSnapshot);
    const b = savePrefab('B', 'cat', '', mockSnapshot);
    expect(addNestedPrefab(a.id, b.id).ok).toBe(true); // A contains B
    const result = addNestedPrefab(b.id, a.id); // B contains A would close the loop
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cycle?.[0]).toBe(b.id);
    expect(result.cycle?.[result.cycle.length - 1]).toBe(b.id);
    expect(getPrefab(b.id)?.children ?? []).toHaveLength(0); // B unmutated
  });

  it('addNestedPrefab rejects nesting into a built-in prefab', () => {
    const builtIn = getBuiltInPrefabs()[0];
    const child = savePrefab('Child', 'cat', '', mockSnapshot);
    const result = addNestedPrefab(builtIn.id, child.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('built-in');
  });

  it('addNestedPrefab stores the canonical child id, even when nested by NAME', () => {
    const parent = savePrefab('Parent', 'cat', '', mockSnapshot);
    const child = savePrefab('ChildByName', 'cat', '', mockSnapshot);
    const result = addNestedPrefab(parent.id, 'ChildByName'); // nested by name, not id
    expect(result.ok).toBe(true);
    const updated = getPrefab(parent.id);
    // Must be the canonical prefab.id, NOT the raw "ChildByName" input, so this
    // child ref stays consistent with createPrefabInstance's source.id and
    // resolves even if the child prefab is later renamed.
    expect(updated?.children?.[0].prefabId).toBe(child.id);
    expect(updated?.children?.[0].prefabId).not.toBe('ChildByName');
  });

  it('createPrefabInstance rejects an overrides map over the byte size bound (SEC)', () => {
    const source = savePrefab('Source', 'cat', '', mockSnapshot);
    const huge = { script: { source: 'x'.repeat(MAX_OVERRIDE_MAP_BYTES + 1) } };
    const result = createPrefabInstance(source.id, huge);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('byte size limit') });
    expect(loadPrefabInstances()).toHaveLength(0);
  });

  it('addNestedPrefab rejects an overrides map over the byte size bound (SEC)', () => {
    const parent = savePrefab('Parent', 'cat', '', mockSnapshot);
    const child = savePrefab('Child', 'cat', '', mockSnapshot);
    const huge = { script: { source: 'x'.repeat(MAX_OVERRIDE_MAP_BYTES + 1) } };
    const result = addNestedPrefab(parent.id, child.id, huge);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('byte size limit') });
    expect(getPrefab(parent.id)?.children ?? []).toHaveLength(0);
  });
});

describe('deletePrefab cascades dangling references (scene.FR-1 N1)', () => {
  it('removes scene-level instances still linked to the deleted source', () => {
    const source = savePrefab('Source', 'cat', '', mockSnapshot);
    const created = createPrefabInstance(source.id);
    if (!created.ok) throw new Error('setup failed');
    expect(loadPrefabInstances()).toHaveLength(1);

    expect(deletePrefab(source.id)).toBe(true);
    expect(loadPrefabInstances()).toHaveLength(0);
  });

  it('leaves instances linked to a DIFFERENT prefab untouched', () => {
    const a = savePrefab('A', 'cat', '', mockSnapshot);
    const b = savePrefab('B', 'cat', '', mockSnapshot);
    createPrefabInstance(a.id);
    createPrefabInstance(b.id);

    deletePrefab(a.id);
    const remaining = loadPrefabInstances();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].prefabId).toBe(b.id);
  });

  it('removes the deleted prefab from every parent that nests it', () => {
    const parent = savePrefab('Parent', 'cat', '', mockSnapshot);
    const child = savePrefab('Child', 'cat', '', mockSnapshot);
    addNestedPrefab(parent.id, child.id);
    expect(getPrefab(parent.id)?.children).toHaveLength(1);

    deletePrefab(child.id);
    expect(getPrefab(parent.id)?.children).toHaveLength(0);
    expect(getPrefab(child.id)).toBeUndefined();
  });
});

describe('importPrefab preserves nested children (export/reimport round-trip)', () => {
  it('round-trips a nested prefab through export -> import without flattening it', () => {
    const child = savePrefab('Child', 'cat', '', mockSnapshot);
    const parent = savePrefab('Parent', 'cat', '', mockSnapshot);
    const nested = addNestedPrefab(parent.id, child.id, { name: 'Overridden Child' });
    expect(nested.ok).toBe(true);

    const json = exportPrefab(parent.id);
    expect(json).toBeTypeOf('string');
    expect(JSON.parse(json!).children).toHaveLength(1);

    storage = {};
    const imported = importPrefab(json!);
    expect(imported).toBeDefined();
    expect(imported?.children).toHaveLength(1);
    expect(imported?.children?.[0].prefabId).toBe(child.id);
    expect(imported?.children?.[0].overrides).toEqual({ name: 'Overridden Child' });
    // Persisted, not just returned in-memory.
    expect(getPrefab(imported!.id)?.children).toHaveLength(1);
  });

  it('rejects malformed children atomically instead of importing a partial prefab', () => {
    const json = JSON.stringify({
      name: 'HasBadChild',
      snapshot: mockSnapshot,
      children: [{ prefabId: 'ok_child' }, { notAPrefabId: true }, null, 'garbage'],
    });
    const imported = importPrefab(json);
    expect(imported).toBeNull();
    expect(loadPrefabs()).toEqual([]);
  });

  it('imports a prefab with no children exactly as before (no regression)', () => {
    const json = JSON.stringify({ name: 'Flat', snapshot: mockSnapshot });
    const imported = importPrefab(json);
    expect(imported?.children).toBeUndefined();
  });
});

describe('collectTransitivePrefabDefinitions / mergeImportedPrefabDefinitions (portability)', () => {
  it('collects an instance source and its nested children, but not built-ins', () => {
    const grandchild = savePrefab('Grandchild', 'cat', '', mockSnapshot);
    const child = savePrefab('Child', 'cat', '', mockSnapshot);
    addNestedPrefab(child.id, grandchild.id);
    const source = savePrefab('Source', 'cat', '', mockSnapshot);
    addNestedPrefab(source.id, child.id);
    const builtIn = getBuiltInPrefabs()[0];

    const created = createPrefabInstance(source.id);
    if (!created.ok) throw new Error('setup failed');
    createPrefabInstance(builtIn.id); // built-in source — must not be collected

    const defs = collectTransitivePrefabDefinitions(loadPrefabInstances());
    const ids = defs.map((d) => d.id).sort();
    expect(ids).toEqual([child.id, grandchild.id, source.id].sort());
    expect(ids).not.toContain(builtIn.id);
  });

  it('mergeImportedPrefabDefinitions adds a definition missing locally', () => {
    const def = savePrefab('WillBeCleared', 'cat', '', mockSnapshot);
    const exported = getPrefab(def.id)!;
    storage = {}; // simulate opening on a browser with an empty library
    expect(getPrefab(def.id)).toBeUndefined();

    mergeImportedPrefabDefinitions([exported]);
    expect(getPrefab(def.id)).toBeDefined();
    expect(getPrefab(def.id)?.name).toBe('WillBeCleared');
  });

  it('mergeImportedPrefabDefinitions never overwrites an existing local definition', () => {
    const local = savePrefab('Local', 'cat', '', mockSnapshot);
    updatePrefab(local.id, { ...mockSnapshot, name: 'Locally Edited' });
    const stale = { ...getPrefab(local.id)!, snapshot: { ...mockSnapshot, name: 'Stale Remote Copy' } };

    mergeImportedPrefabDefinitions([stale]);
    expect(getPrefab(local.id)?.snapshot.name).toBe('Locally Edited');
  });

  it('mergeImportedPrefabDefinitions is a no-op for an empty list', () => {
    const before = loadPrefabs();
    mergeImportedPrefabDefinitions([]);
    expect(loadPrefabs()).toEqual(before);
  });
});

describe('export-request staging (scene.FR-1 N1 race fix)', () => {
  it('take-once returns the staged snapshot exactly once, then undefined', () => {
    const source = savePrefab('Source', 'cat', '', mockSnapshot);
    const created = createPrefabInstance(source.id);
    if (!created.ok) throw new Error('setup failed');
    const snapshot = loadPrefabInstances();

    stagePrefabInstancesForExport('req-1', snapshot);
    expect(takeStagedPrefabInstancesForExport('req-1')).toEqual(snapshot);
    expect(takeStagedPrefabInstancesForExport('req-1')).toBeUndefined();
  });

  it('returns undefined for an unstaged or undefined requestId', () => {
    expect(takeStagedPrefabInstancesForExport('never-staged')).toBeUndefined();
    expect(takeStagedPrefabInstancesForExport(undefined)).toBeUndefined();
  });

  it('is unaffected by the LIVE registry changing after staging (the race this fixes)', () => {
    const a = savePrefab('A', 'cat', '', mockSnapshot);
    const b = savePrefab('B', 'cat', '', mockSnapshot);
    createPrefabInstance(a.id);
    const stagedAtRequestTime = loadPrefabInstances();
    stagePrefabInstancesForExport('req-2', stagedAtRequestTime);

    // Simulate a scene load overwriting the live registry before the export answers.
    createPrefabInstance(b.id);
    expect(loadPrefabInstances()).toHaveLength(2);

    const taken = takeStagedPrefabInstancesForExport('req-2');
    expect(taken).toHaveLength(1);
    expect(taken?.[0].prefabId).toBe(a.id);
  });

  it('discardStagedPrefabInstancesForExport removes an entry without treating it as taken', () => {
    stagePrefabInstancesForExport('req-3', [{ instanceId: 'i', prefabId: 'p', overrides: {} }]);
    discardStagedPrefabInstancesForExport('req-3');
    expect(takeStagedPrefabInstancesForExport('req-3')).toBeUndefined();
  });

  it('discarding an unstaged/already-taken requestId is a harmless no-op', () => {
    expect(() => discardStagedPrefabInstancesForExport('never-staged')).not.toThrow();
  });

  it('evicts the OLDEST entry once the bound is reached, rather than growing unbounded (SEC)', () => {
    // MAX_STAGED_EXPORTS is 50 — fill past it and confirm the earliest request
    // is gone while the most recent ones survive.
    for (let i = 0; i < 60; i++) {
      stagePrefabInstancesForExport(`req-${i}`, [{ instanceId: `i${i}`, prefabId: 'p', overrides: {} }]);
    }
    expect(takeStagedPrefabInstancesForExport('req-0')).toBeUndefined(); // evicted
    expect(takeStagedPrefabInstancesForExport('req-59')).toBeDefined(); // most recent survives
  });
});

describe('deletePrefab tombstones an id so it cannot resurrect (scene.FR-1 N1)', () => {
  it('mergeImportedPrefabDefinitions refuses to re-add a definition whose id was deleted', () => {
    const prefab = savePrefab('ToDelete', 'cat', '', mockSnapshot);
    const embeddedCopy = getPrefab(prefab.id)!; // as a saved-but-inactive scene would carry it
    expect(deletePrefab(prefab.id)).toBe(true);
    expect(getPrefab(prefab.id)).toBeUndefined();

    mergeImportedPrefabDefinitions([embeddedCopy]);
    expect(getPrefab(prefab.id)).toBeUndefined(); // still gone — not resurrected
  });

  it('does not tombstone a DIFFERENT prefab', () => {
    const kept = savePrefab('Kept', 'cat', '', mockSnapshot);
    const keptCopy = getPrefab(kept.id)!;
    const deleted = savePrefab('Deleted', 'cat', '', mockSnapshot);
    deletePrefab(deleted.id);

    // `kept` is now only known via an embedded copy (as if a scene carrying
    // it were opened somewhere that never had it locally) — clear only the
    // library, leaving the tombstone set (and everything else) untouched.
    savePrefabsToStorage([]);
    mergeImportedPrefabDefinitions([keptCopy]);
    expect(getPrefab(kept.id)).toBeDefined();
  });
});

describe('exportPrefab / importPrefab carry nested definitions (scene.FR-1 N1)', () => {
  it('exportPrefab embeds the transitive definitions of nested children', () => {
    const grandchild = savePrefab('Grandchild', 'cat', '', mockSnapshot);
    const child = savePrefab('Child', 'cat', '', mockSnapshot);
    addNestedPrefab(child.id, grandchild.id);
    const parent = savePrefab('Parent', 'cat', '', mockSnapshot);
    addNestedPrefab(parent.id, child.id);

    const json = exportPrefab(parent.id);
    const parsed = JSON.parse(json!);
    const nestedIds = parsed.nestedDefinitions.map((d: { id: string }) => d.id).sort();
    expect(nestedIds).toEqual([child.id, grandchild.id].sort());
  });

  it('exportPrefab omits nestedDefinitions entirely for a flat prefab (byte-identical to before)', () => {
    const flat = savePrefab('Flat', 'cat', '', mockSnapshot);
    const json = exportPrefab(flat.id);
    expect(JSON.parse(json!).nestedDefinitions).toBeUndefined();
  });

  it('importPrefab installs nested definitions so a reimported nested prefab actually resolves', () => {
    const child = savePrefab('Child', 'cat', '', mockSnapshot);
    const parent = savePrefab('Parent', 'cat', '', mockSnapshot);
    addNestedPrefab(parent.id, child.id);
    const json = exportPrefab(parent.id);

    storage = {}; // fresh browser — nothing local
    const imported = importPrefab(json!);
    expect(imported).toBeDefined();
    expect(imported?.children).toHaveLength(1);
    const childId = imported!.children![0].prefabId;
    // The point of the fix: the child's DEFINITION is now resolvable locally,
    // not just a dangling id reference.
    expect(getPrefab(childId)).toBeDefined();
    expect(getPrefab(childId)?.name).toBe('Child');
  });

  it('importPrefab never overwrites a local definition with a same-id nested one', () => {
    const child = savePrefab('Child', 'cat', '', mockSnapshot);
    addNestedPrefab(savePrefab('Parent', 'cat', '', mockSnapshot).id, child.id);
    const json = exportPrefab(loadPrefabs().find((p) => p.name === 'Parent')!.id);

    // `updatePrefab` only touches `snapshot` (the top-level `name` is set once
    // at creation) — edit the entity name it carries and confirm that survives.
    updatePrefab(child.id, { ...mockSnapshot, name: 'Locally Edited' });
    importPrefab(json!);
    expect(getPrefab(child.id)?.snapshot.name).toBe('Locally Edited');
  });
});

describe('sanitizePrefabDefinition (scene.FR-1 N1 SEC — structural validation)', () => {
  const validSnapshot: PrefabSnapshot = mockSnapshot;

  it('accepts a well-formed definition', () => {
    const def = {
      id: 'prefab_x', name: 'X', category: 'cat', description: '',
      snapshot: validSnapshot, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    expect(sanitizePrefabDefinition(def)).toEqual(def);
  });

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['missing id', { name: 'X', snapshot: validSnapshot }],
    ['missing name', { id: 'p', snapshot: validSnapshot }],
    ['missing snapshot', { id: 'p', name: 'X' }],
    ['snapshot missing transform', { id: 'p', name: 'X', snapshot: { entityType: 'cube', name: 'X' } }],
    ['snapshot with a non-vec3 position', { id: 'p', name: 'X', snapshot: { entityType: 'cube', name: 'X', transform: { position: [0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } }],
    ['snapshot with a non-finite position', { id: 'p', name: 'X', snapshot: { entityType: 'cube', name: 'X', transform: { position: [0, 0, Infinity], rotation: [0, 0, 0], scale: [1, 1, 1] } } }],
  ])('rejects: %s', (_label, raw) => {
    expect(sanitizePrefabDefinition(raw)).toBeNull();
  });

  it('rejects a definition whose overall serialized size exceeds the bound (SEC)', () => {
    const huge = {
      id: 'prefab_x', name: 'X',
      snapshot: { ...validSnapshot, script: { source: 'x'.repeat(300 * 1024) } },
    };
    expect(sanitizePrefabDefinition(huge)).toBeNull();
  });

  it('validates nested children through the same untrusted-child sanitizer', () => {
    const def = {
      id: 'prefab_x', name: 'X', snapshot: validSnapshot,
      children: [{ prefabId: 'child_1' }, { notAPrefabId: true }],
    };
    const sanitized = sanitizePrefabDefinition(def);
    expect(sanitized).toBeNull();
  });
});

describe('subscribeToPrefabChanges notifies on every mutation (scene.FR-1 N1)', () => {
  it('notifies on a prefab-library write', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPrefabChanges(listener);
    savePrefab('X', 'cat', '', mockSnapshot);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies on an instance-registry write', () => {
    const source = savePrefab('X', 'cat', '', mockSnapshot);
    const listener = vi.fn();
    const unsubscribe = subscribeToPrefabChanges(listener);
    createPrefabInstance(source.id);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPrefabChanges(listener);
    unsubscribe();
    savePrefab('X', 'cat', '', mockSnapshot);
    expect(listener).not.toHaveBeenCalled();
  });
});
