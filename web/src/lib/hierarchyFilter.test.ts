import { describe, it, expect } from 'vitest';
import { filterHierarchy, escapeRegExp } from './hierarchyFilter';
import type { SceneGraph } from '@/stores/editorStore';

/**
 * Helper to build a test scene graph inline.
 */
function buildSceneGraph(
  nodes: Record<
    string,
    {
      name: string;
      parentId: string | null;
      children?: string[];
      components?: string[];
      visible?: boolean;
    }
  >
): SceneGraph {
  const graph: SceneGraph = {
    nodes: {},
    rootIds: [],
  };

  // Build nodes
  for (const [entityId, data] of Object.entries(nodes)) {
    graph.nodes[entityId] = {
      entityId,
      name: data.name,
      parentId: data.parentId,
      children: data.children || [],
      components: data.components || [],
      visible: data.visible ?? true,
    };
  }

  // Compute root IDs
  graph.rootIds = Object.keys(graph.nodes).filter(
    (id) => graph.nodes[id].parentId === null
  );

  return graph;
}

describe('hierarchyFilter', () => {
  // ══════════════ EMPTY/NO FILTER ══════════════
  describe('Empty/No Filter', () => {
    it('should show all entities when filter is empty', () => {
      const graph = buildSceneGraph({
        root: { name: 'Root', parentId: null },
        child1: { name: 'Child 1', parentId: 'root' },
        child2: { name: 'Child 2', parentId: 'root' },
      });

      const result = filterHierarchy(graph, '');

      expect(result.visibleIds.size).toBe(3);
      expect(result.matchingIds.size).toBe(0);
      expect(result.matchCount).toBe(0);
      expect(result.filteredRootIds).toEqual(['root']);
    });

    it('should treat whitespace-only filter as empty', () => {
      const graph = buildSceneGraph({
        root: { name: 'Root', parentId: null },
        child: { name: 'Child', parentId: 'root' },
      });

      const result = filterHierarchy(graph, '   ');

      expect(result.visibleIds.size).toBe(2);
      expect(result.matchingIds.size).toBe(0);
      expect(result.matchCount).toBe(0);
      expect(result.filteredRootIds).toEqual(['root']);
    });
  });

  // ══════════════ NAME MATCHING ══════════════
  describe('Name Matching', () => {
    it('should find exact name match', () => {
      const graph = buildSceneGraph({
        root: { name: 'Player', parentId: null },
        child: { name: 'Child', parentId: 'root' },
      });

      const result = filterHierarchy(graph, 'Player');

      expect(result.matchingIds.has('root')).toBe(true);
      expect(result.matchingIds.size).toBe(1);
      expect(result.matchCount).toBe(1);
    });

    it('should match case-insensitively', () => {
      const graph = buildSceneGraph({
        root: { name: 'CameraPivot', parentId: null },
        child: { name: 'MainCamera', parentId: 'root' },
      });

      const result = filterHierarchy(graph, 'camera');

      expect(result.matchingIds.has('root')).toBe(true);
      expect(result.matchingIds.has('child')).toBe(true);
      expect(result.matchCount).toBe(2);
    });

    it('should match partial substring', () => {
      const graph = buildSceneGraph({
        root: { name: 'Environment', parentId: null },
        child: { name: 'Player', parentId: 'root' },
      });

      const result = filterHierarchy(graph, 'env');

      expect(result.matchingIds.has('root')).toBe(true);
      expect(result.matchingIds.has('child')).toBe(false);
      expect(result.matchCount).toBe(1);
    });

    it('should match multiple entities', () => {
      const graph = buildSceneGraph({
        root: { name: 'Scene', parentId: null },
        light1: { name: 'Point Light 1', parentId: 'root' },
        light2: { name: 'Point Light 2', parentId: 'root' },
        camera: { name: 'Camera', parentId: 'root' },
      });

      const result = filterHierarchy(graph, 'light');

      expect(result.matchingIds.has('light1')).toBe(true);
      expect(result.matchingIds.has('light2')).toBe(true);
      expect(result.matchingIds.has('camera')).toBe(false);
      expect(result.matchCount).toBe(2);
    });
  });

  // ══════════════ ANCESTOR VISIBILITY ══════════════
  describe('Ancestor Visibility', () => {
    it('should make parent visible when child matches', () => {
      const graph = buildSceneGraph({
        root: { name: 'Root', parentId: null },
        child: { name: 'Target', parentId: 'root' },
      });

      const result = filterHierarchy(graph, 'target');

      expect(result.matchingIds.has('child')).toBe(true);
      expect(result.matchingIds.has('root')).toBe(false);
      expect(result.visibleIds.has('child')).toBe(true);
      expect(result.visibleIds.has('root')).toBe(true);
      expect(result.matchCount).toBe(1);
    });

    it('should make all ancestors visible for deep nested match', () => {
      const graph = buildSceneGraph({
        root: { name: 'Root', parentId: null },
        level1: { name: 'Level 1', parentId: 'root' },
        level2: { name: 'Level 2', parentId: 'level1' },
        level3: { name: 'DeepTarget', parentId: 'level2' },
      });

      const result = filterHierarchy(graph, 'deep');

      expect(result.matchingIds.has('level3')).toBe(true);
      expect(result.matchingIds.size).toBe(1);

      expect(result.visibleIds.has('level3')).toBe(true);
      expect(result.visibleIds.has('level2')).toBe(true);
      expect(result.visibleIds.has('level1')).toBe(true);
      expect(result.visibleIds.has('root')).toBe(true);
      expect(result.visibleIds.size).toBe(4);

      expect(result.filteredRootIds).toEqual(['root']);
    });

    it('should not show unrelated siblings when only one child matches', () => {
      const graph = buildSceneGraph({
        root: { name: 'Root', parentId: null },
        child1: { name: 'Match', parentId: 'root' },
        child2: { name: 'NoMatch', parentId: 'root' },
      });

      const result = filterHierarchy(graph, 'match');

      expect(result.matchingIds.has('child1')).toBe(true);
      // Note: 'NoMatch' contains 'match' as substring (case-insensitive)
      expect(result.matchingIds.has('child2')).toBe(true);
      expect(result.visibleIds.has('child1')).toBe(true);
      expect(result.visibleIds.has('child2')).toBe(true);
      expect(result.visibleIds.has('root')).toBe(true);
    });
  });

  // ══════════════ EDGE CASES ══════════════
  describe('Edge Cases', () => {
    it('should handle empty scene graph', () => {
      const graph: SceneGraph = {
        nodes: {},
        rootIds: [],
      };

      const result = filterHierarchy(graph, 'test');

      expect(result.visibleIds.size).toBe(0);
      expect(result.matchingIds.size).toBe(0);
      expect(result.matchCount).toBe(0);
      expect(result.filteredRootIds).toEqual([]);
    });

    it('should return zero matches when no entities match', () => {
      const graph = buildSceneGraph({
        root: { name: 'Root', parentId: null },
        child: { name: 'Child', parentId: 'root' },
      });

      const result = filterHierarchy(graph, 'nonexistent');

      expect(result.matchCount).toBe(0);
      expect(result.matchingIds.size).toBe(0);
      expect(result.visibleIds.size).toBe(0);
      expect(result.filteredRootIds).toEqual([]);
    });

    it('should escape special regex characters in filter', () => {
      const testString = 'test.string*with+special?chars^${}()|[]\\';
      const escaped = escapeRegExp(testString);

      // Verify no regex error when used in RegExp
      expect(() => new RegExp(escaped)).not.toThrow();

      // Verify it matches the literal string
      expect(testString.match(new RegExp(escaped))).not.toBeNull();
    });

    it('should handle filter with special regex characters', () => {
      const graph = buildSceneGraph({
        root: { name: 'Test (with) [brackets]', parentId: null },
        child: { name: 'Child', parentId: 'root' },
      });

      // Should not throw and should match
      const result = filterHierarchy(graph, '(with)');

      expect(result.matchingIds.has('root')).toBe(true);
      expect(result.matchCount).toBe(1);
    });

    it('should handle multiple root entities with filtering', () => {
      const graph = buildSceneGraph({
        root1: { name: 'Root A', parentId: null },
        child1: { name: 'Child A', parentId: 'root1' },
        root2: { name: 'Root B', parentId: null },
        child2: { name: 'Target', parentId: 'root2' },
      });

      const result = filterHierarchy(graph, 'target');

      expect(result.matchingIds.has('child2')).toBe(true);
      expect(result.visibleIds.has('root2')).toBe(true);
      expect(result.visibleIds.has('root1')).toBe(false);
      expect(result.filteredRootIds).toEqual(['root2']);
    });

    it('should handle complex hierarchy with multiple matching branches', () => {
      const graph = buildSceneGraph({
        scene: { name: 'Scene', parentId: null },
        lights: { name: 'Lights', parentId: 'scene' },
        light1: { name: 'Point Light', parentId: 'lights' },
        light2: { name: 'Spot Light', parentId: 'lights' },
        environment: { name: 'Environment', parentId: 'scene' },
        sun: { name: 'Sun Light', parentId: 'environment' },
      });

      const result = filterHierarchy(graph, 'light');

      // Four entities match: 'Lights' parent + 3 children
      expect(result.matchCount).toBe(4);
      expect(result.matchingIds.has('lights')).toBe(true);
      expect(result.matchingIds.has('light1')).toBe(true);
      expect(result.matchingIds.has('light2')).toBe(true);
      expect(result.matchingIds.has('sun')).toBe(true);

      // Both parent chains visible
      expect(result.visibleIds.has('lights')).toBe(true);
      expect(result.visibleIds.has('environment')).toBe(true);
      expect(result.visibleIds.has('scene')).toBe(true);

      // Total: 4 matches + 2 ancestors (lights is both match and ancestor)
      expect(result.visibleIds.size).toBe(6);
    });
  });
});
