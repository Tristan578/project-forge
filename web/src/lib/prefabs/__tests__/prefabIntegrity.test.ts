/** Regression coverage for graph integrity and export snapshot consistency. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addNestedPrefab, applyPrefabToInstances, createPrefabInstance, deletePrefab,
  exportPrefab, getPrefab, importPrefab, loadPrefabs, mergeImportedPrefabDefinitions,
  sanitizePrefabDefinition, savePrefab, savePrefabsToStorage, stagePrefabInstancesForExport,
  takeStagedPrefabDataForExport, updatePrefab, type Prefab, type PrefabSnapshot,
} from '@/lib/prefabs/prefabStore';
import { detectCycle } from '@/lib/prefabs/prefabInstance';
import { readPrefabDefinitions, writePrefabDefinitions, type SceneFileData } from '@/lib/scenes/sceneManager';

let storage: Record<string, string>;
beforeEach(() => {
  storage = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { storage[key] = value; }),
  });
});

const snapshot: PrefabSnapshot = {
  entityType: 'cube', name: 'Original',
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
};
const definition = (id: string, children: string[] = []): Prefab => ({
  id, name: id, category: 'test', description: '', snapshot,
  createdAt: '2026-09-15T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z',
  ...(children.length ? { children: children.map((prefabId, i) => ({ prefabId, instanceId: `${id}-edge-${i}` })) } : {}),
});

describe('atomic imported graphs', () => {
  it.each([
    ['self cycle', [definition('A', ['A'])]],
    ['indirect cycle', [definition('A', ['B']), definition('B', ['A'])]],
    ['missing dependency', [definition('A', ['absent'])]],
    ['malformed definition', [definition('A'), { id: 'bad', snapshot: null }]],
  ])('rejects %s without persisting any additions', (_label, input) => {
    savePrefab('Existing', 'test', '', snapshot);
    const before = { ...storage };
    expect(mergeImportedPrefabDefinitions(input)).toBe(false);
    expect(storage).toEqual(before);
  });

  it('checks dependencies against the local-wins proposed graph', () => {
    savePrefabsToStorage([definition('A', ['B']), definition('B')]);
    const before = { ...storage };
    // Incoming A cannot replace local A; adding C -> A is safe with local B,
    // even though the ignored incoming A advertises C.
    expect(mergeImportedPrefabDefinitions([definition('A', ['C']), definition('C', ['A'])])).toBe(true);
    expect(getPrefab('A')?.children?.[0].prefabId).toBe('B');
    expect(getPrefab('C')?.children?.[0].prefabId).toBe('A');
    expect(storage).not.toEqual(before);
  });

  // #10056. `loadPrefabs()` is a raw localStorage read with no validation, so an
  // older build, a hand edit or a concurrent tab can leave a LOCAL prefab
  // pointing at an id that is no longer there. Validating the whole proposed
  // library made that one stale edge reject every merge — and a rejected merge
  // fails `restorePrefabInstances`, which fails `loadScene`, which raises
  // `sceneLoadError` and locks saving. One corrupt prefab therefore locked the
  // user out of every scene carrying embedded definitions, including scenes
  // that had opened fine the day before.
  it('does not let a pre-existing corrupt local prefab block an unrelated merge', () => {
    savePrefabsToStorage([definition('Corrupt', ['vanished'])]);
    expect(mergeImportedPrefabDefinitions([definition('Incoming')])).toBe(true);
    expect(getPrefab('Incoming')).toBeDefined();
    // The pre-existing corruption is left exactly as it was — not silently
    // "repaired" into something the user never asked for.
    expect(getPrefab('Corrupt')?.children?.[0].prefabId).toBe('vanished');
  });

  it('still rejects an import that DEPENDS on a corrupt existing prefab', () => {
    savePrefabsToStorage([definition('Corrupt', ['vanished'])]);
    const before = { ...storage };
    expect(mergeImportedPrefabDefinitions([definition('Incoming', ['Corrupt'])])).toBe(false);
    expect(storage).toEqual(before);
  });

  it('rejects a cycle the import closes through existing prefabs', () => {
    // P -> Q -> New was merely dangling while New did not exist; the addition is
    // what turns it into a loop, so this one IS the merge's to refuse.
    savePrefabsToStorage([definition('P', ['Q']), definition('Q', ['New'])]);
    const before = { ...storage };
    expect(mergeImportedPrefabDefinitions([definition('New', ['P'])])).toBe(false);
    expect(storage).toEqual(before);
  });

  it('removes tombstoned dependencies from incoming parents without resurrecting them', () => {
    savePrefabsToStorage([definition('Deleted')]);
    expect(deletePrefab('Deleted')).toBe(true);
    expect(mergeImportedPrefabDefinitions([definition('Parent', ['Deleted']), definition('Deleted')])).toBe(true);
    expect(getPrefab('Deleted')).toBeUndefined();
    expect(getPrefab('Parent')?.children).toEqual([]);
  });

  it('rejects a cyclic explicit import before root or dependencies are written', () => {
    const before = { ...storage };
    expect(importPrefab(JSON.stringify({
      ...definition('A', ['B']),
      nestedDefinitions: [definition('B', ['A'])],
    }))).toBeNull();
    expect(storage).toEqual(before);
  });

  it('rejects explicit import with a missing dependency without creating a flat substitute', () => {
    expect(importPrefab(JSON.stringify(definition('A', ['missing'])))).toBeNull();
    expect(loadPrefabs()).toEqual([]);
  });

  it('validates the root snapshot before importing otherwise valid dependencies', () => {
    expect(importPrefab(JSON.stringify({
      ...definition('A', ['B']), snapshot: null, nestedDefinitions: [definition('B')],
    }))).toBeNull();
    expect(loadPrefabs()).toEqual([]);
  });
});

describe('stable nesting identity', () => {
  it('preserves edge ids through repeated scene save/read validation', () => {
    const parent = definition('A', ['B']);
    const scene: SceneFileData = { formatVersion: 1, sceneName: 'Test', entities: [] };
    const once = readPrefabDefinitions(writePrefabDefinitions(scene, [parent, definition('B')]));
    const twice = readPrefabDefinitions(writePrefabDefinitions(scene, once));
    expect(once).toEqual([parent, definition('B')]);
    expect(twice).toEqual(once);
    expect(sanitizePrefabDefinition(parent)?.children?.[0].instanceId).toBe('A-edge-0');
  });

  it('remints root and edge identities only on explicit prefab import', () => {
    savePrefabsToStorage([definition('A', ['B']), definition('B')]);
    const imported = importPrefab(exportPrefab('A')!);
    expect(imported).not.toBeNull();
    expect(imported?.id).not.toBe('A');
    expect(imported?.children?.[0].instanceId).not.toBe('A-edge-0');
    expect(imported?.children?.[0].prefabId).toBe('B');
    expect(getPrefab('A')?.children?.[0].instanceId).toBe('A-edge-0');
  });

  it('rejects duplicate nesting-edge ids instead of silently changing them', () => {
    const parent = definition('A', ['B', 'B']);
    parent.children![1].instanceId = parent.children![0].instanceId;
    expect(sanitizePrefabDefinition(parent)).toBeNull();
  });
});

describe('canonical ids and bounded graph traversal', () => {
  it('accepts a user parent by name and still rejects the reverse edge', () => {
    const parent = savePrefab('Parent', 'test', '', snapshot);
    const child = savePrefab('Child', 'test', '', snapshot);
    const nested = addNestedPrefab('Parent', 'Child');
    expect(nested.ok).toBe(true);
    expect(getPrefab(parent.id)?.children?.[0].prefabId).toBe(child.id);
    const reverse = addNestedPrefab('Child', 'Parent');
    expect(reverse.ok).toBe(false);
    if (!reverse.ok) expect(reverse.cycle).toEqual([child.id, parent.id, child.id]);
  });

  it('resolves linked snapshots by source name without returning an empty success', () => {
    const source = savePrefab('Source', 'test', '', snapshot);
    createPrefabInstance(source.id, { name: 'Kept' });
    updatePrefab(source.id, { ...snapshot, entityType: 'sphere' });
    const resolved = applyPrefabToInstances('Source');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.value.map((entry) => entry.snapshot)).toEqual([{ ...snapshot, name: 'Kept', entityType: 'sphere' }]);
  });

  it('visits shared descendants once instead of enumerating exponentially many DAG paths', () => {
    const calls = new Map<number, number>();
    const result = detectCycle('0', (id) => {
      const index = Number(id);
      calls.set(index, (calls.get(index) ?? 0) + 1);
      // Fibonacci-shaped DAG: a naive path-only walk revisits shared suffixes.
      return index >= 25 ? [] : [String(index + 1), String(index + 2)];
    });
    expect(result).toEqual({ hasCycle: false, chain: [] });
    expect(calls.size).toBe(27);
    expect([...calls.values()]).toEqual(Array(27).fill(1));
  });

  it('handles a chain deeper than the JavaScript call stack', () => {
    const result = detectCycle('0', (id) => Number(id) < 20000 ? [String(Number(id) + 1)] : []);
    expect(result).toEqual({ hasCycle: false, chain: [] });
  });
});

describe('complete export staging', () => {
  it('captures definitions and deeply copies overrides at request time', () => {
    const source = savePrefab('Source', 'test', '', snapshot);
    const child = savePrefab('Child', 'test', '', snapshot);
    addNestedPrefab(source.id, child.id);
    const created = createPrefabInstance(source.id, { transform: { ...snapshot.transform, position: [1, 2, 3] } });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const original = JSON.parse(JSON.stringify(created.value));
    stagePrefabInstancesForExport('snapshot-regression', [created.value]);
    (created.value.overrides.transform as PrefabSnapshot['transform']).position[0] = 999;
    updatePrefab(source.id, { ...snapshot, name: 'Changed after request' });
    deletePrefab(child.id);
    const staged = takeStagedPrefabDataForExport('snapshot-regression');
    expect(staged?.instances).toEqual([original]);
    expect(staged?.definitions.map((prefab) => prefab.id)).toEqual([source.id, child.id]);
    expect(staged?.definitions[0].snapshot.name).toBe('Original');
    expect(staged?.definitions[0].children?.[0].prefabId).toBe(child.id);
    expect(takeStagedPrefabDataForExport('snapshot-regression')).toBeUndefined();
  });
});
