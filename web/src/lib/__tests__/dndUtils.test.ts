import { describe, it, expect } from 'vitest';
import { computeInvalidTargets } from '../dndUtils';
import type { SceneGraph } from '@/stores/editorStore';

function makeGraph(): SceneGraph {
  return {
    nodes: {
      A: { entityId: 'A', name: 'A', parentId: null, children: ['B', 'C'], components: [], visible: true },
      B: { entityId: 'B', name: 'B', parentId: 'A', children: ['D'], components: [], visible: true },
      C: { entityId: 'C', name: 'C', parentId: 'A', children: [], components: [], visible: true },
      D: { entityId: 'D', name: 'D', parentId: 'B', children: [], components: [], visible: true },
      E: { entityId: 'E', name: 'E', parentId: null, children: [], components: [], visible: true },
    },
    rootIds: ['A', 'E'],
  } as unknown as SceneGraph;
}

describe('computeInvalidTargets', () => {
  it('should include the dragged entity itself', () => {
    const result = computeInvalidTargets('A', makeGraph());
    expect(result.has('A')).toBe(true);
  });

  it('should include direct children', () => {
    const result = computeInvalidTargets('A', makeGraph());
    expect(result.has('B')).toBe(true);
    expect(result.has('C')).toBe(true);
  });

  it('should include deep descendants', () => {
    const result = computeInvalidTargets('A', makeGraph());
    expect(result.has('D')).toBe(true);
  });

  it('should not include unrelated nodes', () => {
    const result = computeInvalidTargets('A', makeGraph());
    expect(result.has('E')).toBe(false);
  });

  it('should return only self for leaf node', () => {
    const result = computeInvalidTargets('D', makeGraph());
    expect(result.size).toBe(1);
    expect(result.has('D')).toBe(true);
  });

  it('should handle mid-level node with descendants', () => {
    const result = computeInvalidTargets('B', makeGraph());
    expect(result.has('B')).toBe(true);
    expect(result.has('D')).toBe(true);
    expect(result.has('A')).toBe(false); // parent not included
    expect(result.has('C')).toBe(false); // sibling not included
    expect(result.size).toBe(2);
  });

  it('should handle node not in graph gracefully', () => {
    const result = computeInvalidTargets('nonexistent', makeGraph());
    expect(result.size).toBe(1);
    expect(result.has('nonexistent')).toBe(true);
  });
});
