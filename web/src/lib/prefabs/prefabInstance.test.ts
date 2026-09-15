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
  isOverrideMapWithinSizeLimit,
  overrideMapByteSize,
  sanitizeInstanceRecord,
  MAX_OVERRIDE_MAP_BYTES,
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

describe('override size bound (SEC — resource exhaustion)', () => {
  it('accepts a typical multi-field override', () => {
    const overrides = { name: 'Custom', transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } };
    expect(isOverrideMapWithinSizeLimit(overrides)).toBe(true);
  });

  it('accepts undefined (no overrides at all)', () => {
    expect(isOverrideMapWithinSizeLimit(undefined)).toBe(true);
  });

  it('rejects an override map over the byte bound', () => {
    const huge = { script: { source: 'x'.repeat(MAX_OVERRIDE_MAP_BYTES + 1) } };
    expect(overrideMapByteSize(huge)).toBeGreaterThan(MAX_OVERRIDE_MAP_BYTES);
    expect(isOverrideMapWithinSizeLimit(huge)).toBe(false);
  });

  it('respects a custom bound', () => {
    const overrides = { name: 'x'.repeat(100) };
    expect(isOverrideMapWithinSizeLimit(overrides, 10)).toBe(false);
    expect(isOverrideMapWithinSizeLimit(overrides, 10_000)).toBe(true);
  });
});

describe('sanitizeInstanceRecord (SEC — untrusted scene-file input)', () => {
  it('accepts a well-formed record', () => {
    const raw = { instanceId: 'pfi_1', prefabId: 'prefab_1', overrides: { name: 'X' }, entityId: 'e1' };
    expect(sanitizeInstanceRecord(raw)).toEqual(raw);
  });

  it('accepts a record with no overrides/entityId', () => {
    const raw = { instanceId: 'pfi_1', prefabId: 'prefab_1' };
    expect(sanitizeInstanceRecord(raw)).toEqual({ instanceId: 'pfi_1', prefabId: 'prefab_1', overrides: {} });
  });

  it('drops unknown override keys rather than rejecting the record', () => {
    const raw = { instanceId: 'pfi_1', prefabId: 'prefab_1', overrides: { name: 'X', bogus: 'y' } };
    expect(sanitizeInstanceRecord(raw)).toEqual({ instanceId: 'pfi_1', prefabId: 'prefab_1', overrides: { name: 'X' } });
  });

  it.each([
    ['not an object', 'a string'],
    ['null', null],
    ['missing instanceId', { prefabId: 'p' }],
    ['missing prefabId', { instanceId: 'i' }],
    ['non-string instanceId', { instanceId: 42, prefabId: 'p' }],
    ['empty instanceId', { instanceId: '', prefabId: 'p' }],
    ['instanceId over the length bound', { instanceId: 'x'.repeat(201), prefabId: 'p' }],
    ['non-string entityId', { instanceId: 'i', prefabId: 'p', entityId: 42 }],
    ['overrides is an array', { instanceId: 'i', prefabId: 'p', overrides: [] }],
    ['overrides is a string', { instanceId: 'i', prefabId: 'p', overrides: 'x' }],
  ])('rejects: %s', (_label, raw) => {
    expect(sanitizeInstanceRecord(raw)).toBeNull();
  });

  it('rejects a record whose overrides exceed the byte bound', () => {
    const raw = {
      instanceId: 'pfi_1',
      prefabId: 'prefab_1',
      overrides: { script: { source: 'x'.repeat(MAX_OVERRIDE_MAP_BYTES + 1) } },
    };
    expect(sanitizeInstanceRecord(raw)).toBeNull();
  });

  it('rejects a record whose overrides hide an oversized UNKNOWN key (SEC)', () => {
    // `bogus` is not a real snapshot field, so `sanitizeOverrides` drops it —
    // the size bound must be checked against the RAW map (before that drop),
    // or this multi-megabyte payload would measure as `{}` and pass.
    const raw = {
      instanceId: 'pfi_1',
      prefabId: 'prefab_1',
      overrides: { bogus: 'x'.repeat(MAX_OVERRIDE_MAP_BYTES + 1) },
    };
    expect(sanitizeInstanceRecord(raw)).toBeNull();
  });
});
