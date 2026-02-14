import { describe, it, expect } from 'vitest';
import { computeInvalidTargets } from './dndUtils';
import type { SceneGraph } from '@/stores/editorStore';

describe('computeInvalidTargets', () => {
  it('returns set containing dragged entity itself', () => {
    const sceneGraph: SceneGraph = {
      nodes: {
        'entity1': { entityId: 'entity1', name: 'Entity1', parentId: null, children: [], components: [], visible: true },
      },
      rootIds: ['entity1'],
    };

    const result = computeInvalidTargets('entity1', sceneGraph);

    expect(result.has('entity1')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('returns set with direct children', () => {
    const sceneGraph: SceneGraph = {
      nodes: {
        'entity1': { entityId: 'entity1', name: 'Parent', parentId: null, children: ['entity2', 'entity3'], components: [], visible: true },
        'entity2': { entityId: 'entity2', name: 'Child1', parentId: 'entity1', children: [], components: [], visible: true },
        'entity3': { entityId: 'entity3', name: 'Child2', parentId: 'entity1', children: [], components: [], visible: true },
      },
      rootIds: ['entity1'],
    };

    const result = computeInvalidTargets('entity1', sceneGraph);

    expect(result.has('entity1')).toBe(true);
    expect(result.has('entity2')).toBe(true);
    expect(result.has('entity3')).toBe(true);
    expect(result.size).toBe(3);
  });

  it('returns set with deep descendants', () => {
    const sceneGraph: SceneGraph = {
      nodes: {
        'entity1': { entityId: 'entity1', name: 'Root', parentId: null, children: ['entity2'], components: [], visible: true },
        'entity2': { entityId: 'entity2', name: 'Child', parentId: 'entity1', children: ['entity3'], components: [], visible: true },
        'entity3': { entityId: 'entity3', name: 'GrandChild', parentId: 'entity2', children: ['entity4'], components: [], visible: true },
        'entity4': { entityId: 'entity4', name: 'GreatGrandChild', parentId: 'entity3', children: [], components: [], visible: true },
      },
      rootIds: ['entity1'],
    };

    const result = computeInvalidTargets('entity1', sceneGraph);

    expect(result.has('entity1')).toBe(true);
    expect(result.has('entity2')).toBe(true);
    expect(result.has('entity3')).toBe(true);
    expect(result.has('entity4')).toBe(true);
    expect(result.size).toBe(4);
  });

  it('only includes self for leaf nodes', () => {
    const sceneGraph: SceneGraph = {
      nodes: {
        'entity1': { entityId: 'entity1', name: 'Parent', parentId: null, children: ['entity2'], components: [], visible: true },
        'entity2': { entityId: 'entity2', name: 'Leaf', parentId: 'entity1', children: [], components: [], visible: true },
      },
      rootIds: ['entity1'],
    };

    const result = computeInvalidTargets('entity2', sceneGraph);

    expect(result.has('entity2')).toBe(true);
    expect(result.has('entity1')).toBe(false);
    expect(result.size).toBe(1);
  });

  it('handles empty scene graph', () => {
    const sceneGraph: SceneGraph = {
      nodes: {},
      rootIds: [],
    };

    const result = computeInvalidTargets('entity1', sceneGraph);

    expect(result.has('entity1')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('handles entity not in graph', () => {
    const sceneGraph: SceneGraph = {
      nodes: {
        'entity1': { entityId: 'entity1', name: 'Entity1', parentId: null, children: [], components: [], visible: true },
      },
      rootIds: ['entity1'],
    };

    const result = computeInvalidTargets('nonexistent', sceneGraph);

    expect(result.has('nonexistent')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('correct for root entities', () => {
    const sceneGraph: SceneGraph = {
      nodes: {
        'root1': { entityId: 'root1', name: 'Root1', parentId: null, children: ['child1'], components: [], visible: true },
        'child1': { entityId: 'child1', name: 'Child1', parentId: 'root1', children: [], components: [], visible: true },
        'root2': { entityId: 'root2', name: 'Root2', parentId: null, children: [], components: [], visible: true },
      },
      rootIds: ['root1', 'root2'],
    };

    const result = computeInvalidTargets('root1', sceneGraph);

    expect(result.has('root1')).toBe(true);
    expect(result.has('child1')).toBe(true);
    expect(result.has('root2')).toBe(false);
    expect(result.size).toBe(2);
  });

  it('correct for nested multi-branch entities', () => {
    const sceneGraph: SceneGraph = {
      nodes: {
        'entity1': { entityId: 'entity1', name: 'Root', parentId: null, children: ['entity2', 'entity3'], components: [], visible: true },
        'entity2': { entityId: 'entity2', name: 'Branch1', parentId: 'entity1', children: ['entity4', 'entity5'], components: [], visible: true },
        'entity3': { entityId: 'entity3', name: 'Branch2', parentId: 'entity1', children: ['entity6'], components: [], visible: true },
        'entity4': { entityId: 'entity4', name: 'Leaf1', parentId: 'entity2', children: [], components: [], visible: true },
        'entity5': { entityId: 'entity5', name: 'Leaf2', parentId: 'entity2', children: [], components: [], visible: true },
        'entity6': { entityId: 'entity6', name: 'Leaf3', parentId: 'entity3', children: [], components: [], visible: true },
      },
      rootIds: ['entity1'],
    };

    const result = computeInvalidTargets('entity1', sceneGraph);

    expect(result.has('entity1')).toBe(true);
    expect(result.has('entity2')).toBe(true);
    expect(result.has('entity3')).toBe(true);
    expect(result.has('entity4')).toBe(true);
    expect(result.has('entity5')).toBe(true);
    expect(result.has('entity6')).toBe(true);
    expect(result.size).toBe(6);
  });
});
