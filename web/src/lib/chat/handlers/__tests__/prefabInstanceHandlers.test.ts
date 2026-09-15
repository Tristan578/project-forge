/**
 * AI-path tests for the nested / linked prefab instance commands
 * (scene.FR-1 OP-01 .. OP-04).
 *
 * These exercise the REAL `prefabStore` (localStorage stubbed, no module mock),
 * so the assertions prove the AI handlers drive the same validated operation
 * contract the manual `PrefabLibraryPanel` control drives — the F2 parity
 * requirement. The final `describe` block asserts that directly: for one set of
 * inputs, the AI command's result equals the result of calling the store
 * function the manual control calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { gameplayHandlers } from '../gameplayHandlers';
import {
  savePrefab,
  updatePrefab,
  getPrefabInstances,
  applyPrefabToInstances,
  getPrefab,
  type PrefabSnapshot,
} from '@/lib/prefabs/prefabStore';

// Real store, stubbed storage — the same seam prefabStore.test.ts uses.
let storage: Record<string, string> = {};
beforeEach(() => {
  storage = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { storage[key] = value; }),
    removeItem: vi.fn((key: string) => { delete storage[key]; }),
  });
});

function snap(over: Partial<PrefabSnapshot> = {}): PrefabSnapshot {
  return {
    entityType: 'cube',
    name: 'Source',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ...over,
  };
}

describe('create_prefab_instance (OP-01)', () => {
  it('creates and persists a linked instance of an existing prefab', async () => {
    const src = savePrefab('Src', 'test', '', snap());
    const { result } = await invokeHandler(gameplayHandlers, 'create_prefab_instance', { prefabId: src.id });
    expect(result.success).toBe(true);
    const value = (result.result as { instance: { instanceId: string; prefabId: string } }).instance;
    expect(value.prefabId).toBe(src.id);
    // Persisted where the manual control reads it — one shared registry.
    expect(getPrefabInstances(src.id).map((i) => i.instanceId)).toContain(value.instanceId);
  });

  it('rejects a dangling link to a missing prefab with an actionable error', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'create_prefab_instance', { prefabId: 'nope' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Prefab not found');
  });

  it('drops unknown override keys via the shared sanitizer', async () => {
    const src = savePrefab('Src', 'test', '', snap());
    const { result } = await invokeHandler(gameplayHandlers, 'create_prefab_instance', {
      prefabId: src.id,
      overrides: { name: 'Custom', bogus: 'x' },
    });
    const inst = (result.result as { instance: { overrides: Record<string, unknown> } }).instance;
    expect(inst.overrides).toEqual({ name: 'Custom' });
  });
});

describe('apply_prefab_to_instances (OP-04 propagation)', () => {
  it('propagates un-overridden fields and preserves overrides', async () => {
    const src = savePrefab('Src', 'test', '', snap({ name: 'Base', entityType: 'cube' }));
    await invokeHandler(gameplayHandlers, 'create_prefab_instance', {
      prefabId: src.id,
      overrides: { name: 'Kept' },
    });

    // Source prefab changes: both name and entityType move.
    updatePrefab(src.id, snap({ name: 'NewBase', entityType: 'sphere' }));

    const { result } = await invokeHandler(gameplayHandlers, 'apply_prefab_to_instances', { prefabId: src.id });
    expect(result.success).toBe(true);
    const applied = (result.result as { applied: Array<{ snapshot: PrefabSnapshot }> }).applied;
    expect(applied).toHaveLength(1);
    expect(applied[0].snapshot.entityType).toBe('sphere'); // un-overridden followed source
    expect(applied[0].snapshot.name).toBe('Kept'); // override preserved
  });

  it('rejects a missing prefab', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'apply_prefab_to_instances', { prefabId: 'nope' });
    expect(result.success).toBe(false);
  });
});

describe('nest_prefab (OP-02 cycle validation)', () => {
  it('nests a child under a user prefab', async () => {
    const parent = savePrefab('Parent', 'test', '', snap());
    const child = savePrefab('Child', 'test', '', snap());
    const { result } = await invokeHandler(gameplayHandlers, 'nest_prefab', {
      parentPrefabId: parent.id,
      childPrefabId: child.id,
    });
    expect(result.success).toBe(true);
    expect(getPrefab(parent.id)?.children?.map((c) => c.prefabId)).toContain(child.id);
  });

  it('rejects a cyclic reference with the offending chain and no mutation', async () => {
    const a = savePrefab('A', 'test', '', snap());
    const b = savePrefab('B', 'test', '', snap());
    // A now contains B.
    await invokeHandler(gameplayHandlers, 'nest_prefab', { parentPrefabId: a.id, childPrefabId: b.id });
    // Nesting A under B would close B -> A -> B.
    const { result } = await invokeHandler(gameplayHandlers, 'nest_prefab', { parentPrefabId: b.id, childPrefabId: a.id });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cyclic prefab reference');
    const cycle = (result.result as { cycle: string[] }).cycle;
    expect(cycle[0]).toBe(b.id);
    expect(cycle[cycle.length - 1]).toBe(b.id);
    // No mutation: B still has no children.
    expect(getPrefab(b.id)?.children ?? []).toHaveLength(0);
  });
});

describe('list_prefab_instances (OP-03 inspection)', () => {
  it('reports each instance with the fields it overrides', async () => {
    const src = savePrefab('Src', 'test', '', snap());
    await invokeHandler(gameplayHandlers, 'create_prefab_instance', { prefabId: src.id, overrides: { name: 'X' } });
    const { result } = await invokeHandler(gameplayHandlers, 'list_prefab_instances', { prefabId: src.id });
    const instances = (result.result as { instances: Array<{ overriddenFields: string[] }> }).instances;
    expect(instances).toHaveLength(1);
    expect(instances[0].overriddenFields).toEqual(['name']);
  });
});

describe('manual/AI parity (F2 shared contract)', () => {
  it('apply_prefab_to_instances returns the same resolved snapshots as the direct store call', async () => {
    const src = savePrefab('Src', 'test', '', snap({ name: 'Base' }));
    await invokeHandler(gameplayHandlers, 'create_prefab_instance', { prefabId: src.id, overrides: { name: 'Kept' } });
    updatePrefab(src.id, snap({ name: 'NewBase', entityType: 'sphere' }));

    // Manual control path: the component calls this exact function.
    const manual = applyPrefabToInstances(src.id);
    // AI path: the handler calls the same function under the hood.
    const { result } = await invokeHandler(gameplayHandlers, 'apply_prefab_to_instances', { prefabId: src.id });

    expect(manual.ok).toBe(true);
    expect(result.success).toBe(true);
    const aiApplied = (result.result as { applied: unknown }).applied;
    // Same instance registry, same source: byte-for-byte identical results.
    expect(aiApplied).toEqual(manual.ok ? manual.value : null);
  });
});
