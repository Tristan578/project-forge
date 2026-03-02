import { describe, it, expect } from 'vitest';
import { filterHierarchy, escapeRegExp } from '../hierarchyFilter';
import type { SceneGraph } from '@/stores/editorStore';

function makeGraph(): SceneGraph {
  return {
    nodes: {
      root1: { entityId: 'root1', name: 'Player', parentId: null, children: ['child1', 'child2'], components: [], visible: true },
      root2: { entityId: 'root2', name: 'Camera', parentId: null, children: [], components: [], visible: true },
      root3: { entityId: 'root3', name: 'Ground', parentId: null, children: ['child3'], components: [], visible: true },
      child1: { entityId: 'child1', name: 'PlayerModel', parentId: 'root1', children: [], components: [], visible: true },
      child2: { entityId: 'child2', name: 'PlayerLight', parentId: 'root1', children: ['grandchild1'], components: [], visible: true },
      child3: { entityId: 'child3', name: 'GroundTexture', parentId: 'root3', children: [], components: [], visible: true },
      grandchild1: { entityId: 'grandchild1', name: 'LightGlow', parentId: 'child2', children: [], components: [], visible: true },
    },
    rootIds: ['root1', 'root2', 'root3'],
  } as unknown as SceneGraph;
}

describe('filterHierarchy', () => {
  it('should return all entities when filter is empty', () => {
    const result = filterHierarchy(makeGraph(), '');
    expect(result.visibleIds.size).toBe(7);
    expect(result.matchingIds.size).toBe(0);
    expect(result.matchCount).toBe(0);
    expect(result.filteredRootIds).toEqual(['root1', 'root2', 'root3']);
  });

  it('should return all entities when filter is whitespace', () => {
    const result = filterHierarchy(makeGraph(), '   ');
    expect(result.visibleIds.size).toBe(7);
    expect(result.matchCount).toBe(0);
  });

  it('should find matching entities (case-insensitive)', () => {
    const result = filterHierarchy(makeGraph(), 'player');
    expect(result.matchingIds.has('root1')).toBe(true);    // "Player"
    expect(result.matchingIds.has('child1')).toBe(true);    // "PlayerModel"
    expect(result.matchingIds.has('child2')).toBe(true);    // "PlayerLight"
    expect(result.matchCount).toBe(3);
  });

  it('should make ancestors visible for context', () => {
    const result = filterHierarchy(makeGraph(), 'lightglow');
    // "LightGlow" matches
    expect(result.matchingIds.has('grandchild1')).toBe(true);
    expect(result.matchCount).toBe(1);
    // Ancestors: child2 (parent), root1 (grandparent)
    expect(result.visibleIds.has('child2')).toBe(true);
    expect(result.visibleIds.has('root1')).toBe(true);
  });

  it('should filter root IDs to only visible ones', () => {
    const result = filterHierarchy(makeGraph(), 'ground');
    // "Ground" and "GroundTexture" match
    expect(result.filteredRootIds).toContain('root3');
    expect(result.filteredRootIds).not.toContain('root1');
    expect(result.filteredRootIds).not.toContain('root2');
  });

  it('should return empty when no entities match', () => {
    const result = filterHierarchy(makeGraph(), 'nonexistent');
    expect(result.matchCount).toBe(0);
    expect(result.visibleIds.size).toBe(0);
    expect(result.filteredRootIds).toEqual([]);
  });

  it('should handle single-character filter', () => {
    const result = filterHierarchy(makeGraph(), 'l');
    // "Player", "PlayerModel", "PlayerLight", "LightGlow", "Ground" (contains nothing), "GroundTexture" (nothing)
    // Actually: Player, PlayerModel, PlayerLight, LightGlow all contain "l"
    expect(result.matchCount).toBeGreaterThan(0);
  });

  it('should handle empty graph', () => {
    const emptyGraph: SceneGraph = { nodes: {}, rootIds: [] } as unknown as SceneGraph;
    const result = filterHierarchy(emptyGraph, 'test');
    expect(result.matchCount).toBe(0);
    expect(result.visibleIds.size).toBe(0);
  });
});

describe('escapeRegExp', () => {
  it('should escape special regex characters', () => {
    expect(escapeRegExp('hello.world')).toBe('hello\\.world');
    expect(escapeRegExp('test*')).toBe('test\\*');
    expect(escapeRegExp('a+b')).toBe('a\\+b');
    expect(escapeRegExp('[test]')).toBe('\\[test\\]');
  });

  it('should escape all special characters', () => {
    const input = '.*+?^${}()|[]\\';
    const escaped = escapeRegExp(input);
    // Each character should be escaped with backslash
    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('should leave normal text unchanged', () => {
    expect(escapeRegExp('hello world')).toBe('hello world');
    expect(escapeRegExp('test123')).toBe('test123');
  });

  it('should handle empty string', () => {
    expect(escapeRegExp('')).toBe('');
  });
});
