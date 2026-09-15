import { describe, it, expect } from 'vitest';
import {
  createInstance,
  resolveInstance,
  applyPrefabUpdate,
  setOverride,
  clearOverride,
  getOverriddenFields,
  detectCycle,
  wouldCreateCycle,
} from './prefabInstance';
import type { Prefab, PrefabSnapshot } from './prefabStore';

function makeSnapshot(over: Partial<PrefabSnapshot> = {}): PrefabSnapshot {
  return {
    entityType: 'cube',
    name: 'Source',
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    ...over,
  };
}

function makePrefab(id: string, snapshot: PrefabSnapshot): Prefab {
  const now = new Date().toISOString();
  return { id, name: id, category: 'test', description: '', snapshot, createdAt: now, updatedAt: now };
}

describe('createInstance (OP-01)', () => {
  it('generates a stable, unique instanceId and links the source prefab', () => {
    const a = createInstance('prefab_1');
    const b = createInstance('prefab_1');
    expect(a.instanceId).toMatch(/^pfi_\d+_[a-z0-9]+$/);
    expect(a.instanceId).not.toBe(b.instanceId);
    expect(a.prefabId).toBe('prefab_1');
    expect(a.overrides).toEqual({});
  });

  it('keeps only known snapshot fields in the seed overrides', () => {
    const inst = createInstance('prefab_1', {
      name: 'Custom',
      // @ts-expect-error — deliberately passing an unknown key to prove it is dropped
      bogus: 'x',
    });
    expect(inst.overrides).toEqual({ name: 'Custom' });
  });

  it('binds an entityId when supplied', () => {
    expect(createInstance('p', undefined, 'ent_9').entityId).toBe('ent_9');
    expect(createInstance('p').entityId).toBeUndefined();
  });
});

describe('resolveInstance + applyPrefabUpdate (OP-04 propagation)', () => {
  it('inherits non-overridden fields and preserves overridden ones', () => {
    const prefab = makePrefab('p', makeSnapshot({ name: 'Base', entityType: 'cube' }));
    const inst = setOverride(createInstance('p'), 'name', 'Overridden');

    const resolved = resolveInstance(inst, prefab);
    expect(resolved.name).toBe('Overridden'); // override wins
    expect(resolved.entityType).toBe('cube'); // inherited
  });

  it('propagates a source change to un-overridden fields while the override stays intact', () => {
    const inst = setOverride(createInstance('p'), 'name', 'Kept');

    // Source prefab updated: entityType changed, name changed.
    const updated = makePrefab('p', makeSnapshot({ name: 'NewBase', entityType: 'sphere' }));
    const { instance, snapshot } = applyPrefabUpdate(inst, updated);

    expect(snapshot.entityType).toBe('sphere'); // un-overridden field followed the source
    expect(snapshot.name).toBe('Kept'); // overridden field preserved
    expect(instance.overrides).toEqual({ name: 'Kept' }); // override set unchanged
  });

  it('does not mutate the source prefab when the resolved snapshot is edited', () => {
    const prefab = makePrefab('p', makeSnapshot({ name: 'Base' }));
    const resolved = resolveInstance(createInstance('p'), prefab);
    resolved.name = 'mutated';
    resolved.transform.position[0] = 99;
    expect(prefab.snapshot.name).toBe('Base');
    expect(prefab.snapshot.transform.position[0]).toBe(0);
  });
});

describe('setOverride / clearOverride (immutable) + inspection (OP-03)', () => {
  it('setOverride returns a new instance and leaves the original untouched', () => {
    const inst = createInstance('p');
    const next = setOverride(inst, 'name', 'X');
    expect(inst.overrides).toEqual({});
    expect(next.overrides).toEqual({ name: 'X' });
    expect(next).not.toBe(inst);
  });

  it('clearOverride removes the field so it inherits again', () => {
    const prefab = makePrefab('p', makeSnapshot({ name: 'Base' }));
    const overridden = setOverride(createInstance('p'), 'name', 'X');
    const cleared = clearOverride(overridden, 'name');
    expect(getOverriddenFields(overridden)).toEqual(['name']);
    expect(getOverriddenFields(cleared)).toEqual([]);
    expect(resolveInstance(cleared, prefab).name).toBe('Base');
  });
});

describe('detectCycle (OP-02)', () => {
  it('reports no cycle for an acyclic chain', () => {
    const graph: Record<string, string[]> = { A: ['B'], B: ['C'], C: [] };
    expect(detectCycle('A', (id) => graph[id] ?? []).hasCycle).toBe(false);
  });

  it('detects a direct self-reference with the offending chain', () => {
    const graph: Record<string, string[]> = { A: ['A'] };
    const result = detectCycle('A', (id) => graph[id] ?? []);
    expect(result.hasCycle).toBe(true);
    expect(result.chain).toEqual(['A', 'A']);
  });

  it('detects a multi-level cycle (A -> B -> C -> A) with the full chain', () => {
    const graph: Record<string, string[]> = { A: ['B'], B: ['C'], C: ['A'] };
    const result = detectCycle('A', (id) => graph[id] ?? []);
    expect(result.hasCycle).toBe(true);
    expect(result.chain).toEqual(['A', 'B', 'C', 'A']);
  });
});

describe('wouldCreateCycle (OP-02 pre-commit guard)', () => {
  const graph: Record<string, string[]> = { A: [], B: ['A'], C: [] };
  const getChildren = (id: string) => graph[id] ?? [];

  it('accepts a child that introduces no loop', () => {
    expect(wouldCreateCycle('A', 'C', getChildren).hasCycle).toBe(false);
  });

  it('rejects a child that closes a loop back to the parent, with the chain', () => {
    // A already appears under B; nesting B under A closes A -> B -> A.
    const result = wouldCreateCycle('A', 'B', getChildren);
    expect(result.hasCycle).toBe(true);
    expect(result.chain[0]).toBe('A');
    expect(result.chain[result.chain.length - 1]).toBe('A');
  });

  it('leaves the input graph unmutated after the check', () => {
    wouldCreateCycle('A', 'B', getChildren);
    expect(graph.A).toEqual([]);
  });
});
