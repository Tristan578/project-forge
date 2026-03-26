/**
 * Unit tests for PacingAnalyzerPanel utilities.
 *
 * Focuses on the selectPacingKey selector which is the performance-critical
 * path fixed in PF-873: avoid re-running full pacing analysis on every
 * transform or visibility change.
 */

import { describe, it, expect } from 'vitest';
import { selectPacingKey } from '../PacingAnalyzerPanel';

type FakeState = Parameters<typeof selectPacingKey>[0];

function makeState(
  entries: Array<{ id: string; name: string; components: string[]; visible?: boolean }>,
  rootIds?: string[],
): FakeState {
  const nodes: Record<string, { name: string; components: string[]; visible: boolean }> = {};
  for (const e of entries) {
    nodes[e.id] = { name: e.name, components: e.components, visible: e.visible ?? true };
  }
  return {
    sceneGraph: {
      nodes,
      rootIds: rootIds ?? entries.map((e) => e.id),
    },
  };
}

describe('selectPacingKey (PF-873)', () => {
  it('returns empty string when scene is empty', () => {
    const state = makeState([]);
    expect(selectPacingKey(state)).toBe('');
  });

  it('encodes id, name, and first component for each entity', () => {
    const state = makeState([
      { id: 'e1', name: 'Cube', components: ['cube'] },
    ]);
    expect(selectPacingKey(state)).toBe('e1\x02Cube\x02cube');
  });

  it('uses "generic" when components array is empty', () => {
    const state = makeState([
      { id: 'e1', name: 'Empty', components: [] },
    ]);
    expect(selectPacingKey(state)).toBe('e1\x02Empty\x02generic');
  });

  it('joins multiple entities with \\x01 separator', () => {
    const state = makeState([
      { id: 'e1', name: 'Cube', components: ['cube'] },
      { id: 'e2', name: 'Sphere', components: ['sphere'] },
    ]);
    expect(selectPacingKey(state)).toBe('e1\x02Cube\x02cube\x01e2\x02Sphere\x02sphere');
  });

  it('produces identical key when only visibility changes (PF-873 regression)', () => {
    const stateVisible = makeState([
      { id: 'e1', name: 'Cube', components: ['cube'], visible: true },
    ]);
    const stateHidden = makeState([
      { id: 'e1', name: 'Cube', components: ['cube'], visible: false },
    ]);
    expect(selectPacingKey(stateVisible)).toBe(selectPacingKey(stateHidden));
  });

  it('produces a different key when entity name changes', () => {
    const before = makeState([{ id: 'e1', name: 'Cube', components: ['cube'] }]);
    const after = makeState([{ id: 'e1', name: 'BigCube', components: ['cube'] }]);
    expect(selectPacingKey(before)).not.toBe(selectPacingKey(after));
  });

  it('produces a different key when component type changes', () => {
    const before = makeState([{ id: 'e1', name: 'Thing', components: ['cube'] }]);
    const after = makeState([{ id: 'e1', name: 'Thing', components: ['sphere'] }]);
    expect(selectPacingKey(before)).not.toBe(selectPacingKey(after));
  });

  it('produces a different key when entity is added', () => {
    const before = makeState([{ id: 'e1', name: 'Cube', components: ['cube'] }]);
    const after = makeState([
      { id: 'e1', name: 'Cube', components: ['cube'] },
      { id: 'e2', name: 'Sphere', components: ['sphere'] },
    ]);
    expect(selectPacingKey(before)).not.toBe(selectPacingKey(after));
  });

  it('produces a different key when entity is removed', () => {
    const before = makeState([
      { id: 'e1', name: 'Cube', components: ['cube'] },
      { id: 'e2', name: 'Sphere', components: ['sphere'] },
    ]);
    const after = makeState([{ id: 'e1', name: 'Cube', components: ['cube'] }]);
    expect(selectPacingKey(before)).not.toBe(selectPacingKey(after));
  });

  it('orders root IDs first, then non-root IDs', () => {
    // e2 is a child (not in rootIds), e1 is root
    const state: FakeState = {
      sceneGraph: {
        nodes: {
          e1: { name: 'Root', components: ['cube'], visible: true },
          e2: { name: 'Child', components: ['sphere'], visible: true },
        },
        rootIds: ['e1'],
      },
    };
    const key = selectPacingKey(state);
    // e1 should appear before e2
    expect(key.indexOf('e1')).toBeLessThan(key.indexOf('e2'));
  });

  it('uses only the first component, ignoring subsequent ones', () => {
    const state = makeState([
      { id: 'e1', name: 'Multi', components: ['cube', 'physics', 'audio'] },
    ]);
    expect(selectPacingKey(state)).toBe('e1\x02Multi\x02cube');
  });

  it('handles entity names containing colons or pipes without corruption', () => {
    const state = makeState([
      { id: 'e1', name: 'Boss:Phase2|Hard', components: ['enemy'] },
    ]);
    const key = selectPacingKey(state);
    // Should encode cleanly — split on \x01 then \x02, not on : or |
    expect(key).toBe('e1\x02Boss:Phase2|Hard\x02enemy');
    const [id, name, type] = key.split('\x02');
    expect(id).toBe('e1');
    expect(name).toBe('Boss:Phase2|Hard');
    expect(type).toBe('enemy');
  });
});
