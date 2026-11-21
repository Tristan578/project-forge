/**
 * Tests for SceneHierarchy keyboard navigation helpers.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { flattenVisibleNodes } from '../SceneHierarchy';
import type { SceneGraph } from '@/stores/editorStore';

function makeGraph(nodes: Record<string, { name: string; parentId: string | null; children: string[] }>): SceneGraph {
  const sceneNodes: SceneGraph['nodes'] = {};
  const rootIds: string[] = [];

  for (const [id, data] of Object.entries(nodes)) {
    sceneNodes[id] = {
      entityId: id,
      name: data.name,
      visible: true,
      parentId: data.parentId,
      children: data.children,
      components: [],
    };
    if (!data.parentId) {
      rootIds.push(id);
    }
  }

  return { nodes: sceneNodes, rootIds };
}

describe('flattenVisibleNodes', () => {
  const graph = makeGraph({
    a: { name: 'A', parentId: null, children: ['b', 'c'] },
    b: { name: 'B', parentId: 'a', children: ['d'] },
    c: { name: 'C', parentId: 'a', children: [] },
    d: { name: 'D', parentId: 'b', children: [] },
    e: { name: 'E', parentId: null, children: [] },
  });

  it('should return all nodes when all are expanded', () => {
    const expanded = new Set(['a', 'b', 'c', 'd', 'e']);
    const result = flattenVisibleNodes(graph.rootIds, graph, expanded);
    expect(result).toEqual(['a', 'b', 'd', 'c', 'e']);
  });

  it('should skip children of collapsed nodes', () => {
    // Collapse node 'a' — its children b, c, d should be hidden
    const expanded = new Set(['b', 'c', 'd', 'e']); // 'a' not expanded
    const result = flattenVisibleNodes(graph.rootIds, graph, expanded);
    expect(result).toEqual(['a', 'e']);
  });

  it('should skip children of deeply collapsed nodes', () => {
    // Collapse node 'b' — its child d should be hidden, but c is still visible
    const expanded = new Set(['a', 'c', 'd', 'e']); // 'b' not expanded
    const result = flattenVisibleNodes(graph.rootIds, graph, expanded);
    expect(result).toEqual(['a', 'b', 'c', 'e']);
  });

  it('should handle empty graph', () => {
    const emptyGraph = makeGraph({});
    const result = flattenVisibleNodes([], emptyGraph, new Set());
    expect(result).toEqual([]);
  });

  it('should handle single root with no children', () => {
    const singleGraph = makeGraph({
      x: { name: 'X', parentId: null, children: [] },
    });
    const result = flattenVisibleNodes(singleGraph.rootIds, singleGraph, new Set(['x']));
    expect(result).toEqual(['x']);
  });

  it('should respect visibleIds filter', () => {
    const expanded = new Set(['a', 'b', 'c', 'd', 'e']);
    const visibleIds = new Set(['a', 'b', 'd']); // Only these are visible (filter result)
    const result = flattenVisibleNodes(graph.rootIds, graph, expanded, visibleIds);
    expect(result).toEqual(['a', 'b', 'd']);
  });

  it('should filter out non-visible root nodes', () => {
    const expanded = new Set(['a', 'b', 'c', 'd', 'e']);
    const visibleIds = new Set(['e']); // Only 'e' is visible
    const result = flattenVisibleNodes(graph.rootIds, graph, expanded, visibleIds);
    expect(result).toEqual(['e']);
  });

  it('should handle multiple root nodes in order', () => {
    const multiRootGraph = makeGraph({
      x: { name: 'X', parentId: null, children: [] },
      y: { name: 'Y', parentId: null, children: [] },
      z: { name: 'Z', parentId: null, children: [] },
    });
    const result = flattenVisibleNodes(multiRootGraph.rootIds, multiRootGraph, new Set(['x', 'y', 'z']));
    expect(result).toEqual(['x', 'y', 'z']);
  });
});
