/** Linked-prefab AI commands must not claim scene changes while only metadata is implemented. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { gameplayHandlers } from '../gameplayHandlers';
import {
  savePrefab,
  createPrefabInstance,
  loadPrefabs,
  loadPrefabInstances,
  type PrefabSnapshot,
} from '@/lib/prefabs/prefabStore';

let storage: Record<string, string> = {};
beforeEach(() => {
  storage = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { storage[key] = value; }),
    removeItem: vi.fn((key: string) => { delete storage[key]; }),
  });
});

const snapshot: PrefabSnapshot = {
  entityType: 'cube',
  name: 'Source',
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
};

describe('linked prefab availability', () => {
  it.each(['create_prefab_instance', 'nest_prefab', 'apply_prefab_to_instances'])(
    '%s rejects valid requests without changing stored or engine state',
    async (command) => {
      const source = savePrefab('Source', 'test', '', snapshot);
      const child = savePrefab('Child', 'test', '', snapshot);
      createPrefabInstance(source.id, { name: 'Kept' }, 'existing-entity');
      const before = { prefabs: loadPrefabs(), instances: loadPrefabInstances() };
      const { result, store } = await invokeHandler(gameplayHandlers, command, {
        prefabId: source.id, parentPrefabId: source.id, childPrefabId: child.id,
        overrides: { name: 'Changed' }, entityId: 'existing-entity',
      });
      expect(result.success).toBe(false);
      expect(result.result).toEqual({ code: 'unavailable' });
      expect(result.error).toContain('instantiate_prefab');
      expect(result.error).toContain('not available yet');
      expect(loadPrefabs()).toEqual(before.prefabs);
      expect(loadPrefabInstances()).toEqual(before.instances);
      expect(store.spawnEntity).not.toHaveBeenCalled();
      expect(store.updateTransform).not.toHaveBeenCalled();
      expect(store.updateMaterial).not.toHaveBeenCalled();
    },
  );

  it.each(['create_prefab_instance', 'nest_prefab', 'apply_prefab_to_instances'])(
    '%s still validates missing arguments',
    async (command) => {
      const { result } = await invokeHandler(gameplayHandlers, command, {});
      expect(result.success).toBe(false);
      expect(result.error).toBeTypeOf('string');
      expect(result.result).not.toEqual({ code: 'unavailable' });
    },
  );
});

describe('saved link inspection', () => {
  it('reports stored override fields and explicitly identifies the result as metadata', async () => {
    const source = savePrefab('Source', 'test', '', snapshot);
    const instance = createPrefabInstance(source.id, { name: 'Custom' });
    expect(instance.ok).toBe(true);
    const { result } = await invokeHandler(gameplayHandlers, 'list_prefab_instances', { prefabId: source.id });
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      scope: 'editor_metadata',
      instances: [{ prefabId: source.id, overriddenFields: ['name'] }],
    });
    expect((result.result as { message: string }).message).toContain('do not verify scene placement');
  });

  it('resolves a source by name using its canonical id', async () => {
    const source = savePrefab('NamedSource', 'test', '', snapshot);
    createPrefabInstance(source.id);
    const { result } = await invokeHandler(gameplayHandlers, 'list_prefab_instances', { prefabId: source.name });
    expect(result.success).toBe(true);
    expect((result.result as { instances: unknown[] }).instances).toHaveLength(1);
  });

  it('rejects a missing source instead of an empty success', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'list_prefab_instances', { prefabId: 'missing' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Prefab not found');
  });
});
