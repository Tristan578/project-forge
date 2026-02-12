/**
 * Hierarchy filtering utilities for the Scene Hierarchy panel.
 *
 * Provides case-insensitive filtering of entities by name,
 * preserving parent chain visibility for context.
 */

import type { SceneGraph } from '@/stores/editorStore';

/**
 * Result of filtering the hierarchy.
 */
export interface FilterResult {
  /** All entities to show (matches + their ancestors) */
  visibleIds: Set<string>;
  /** Only the entities that directly match the filter */
  matchingIds: Set<string>;
  /** Root-level IDs that should be rendered */
  filteredRootIds: string[];
  /** Number of matching entities */
  matchCount: number;
}

/**
 * Get all ancestor IDs for an entity.
 */
function getAncestorIds(
  entityId: string,
  nodes: SceneGraph['nodes']
): string[] {
  const ancestors: string[] = [];
  let currentId = nodes[entityId]?.parentId;

  while (currentId) {
    ancestors.push(currentId);
    currentId = nodes[currentId]?.parentId;
  }

  return ancestors;
}

/**
 * Filter the hierarchy by entity name.
 *
 * When filtering:
 * - Entities whose names contain the filter (case-insensitive) are "matches"
 * - All ancestors of matches are "visible" (shown for context, but dimmed)
 * - Children of matches that don't match are hidden
 *
 * @param sceneGraph - The full scene graph
 * @param filter - The filter string (case-insensitive substring match)
 * @returns FilterResult with visible and matching entity IDs
 */
export function filterHierarchy(
  sceneGraph: SceneGraph,
  filter: string
): FilterResult {
  const trimmedFilter = filter.trim().toLowerCase();

  // If no filter, show everything
  if (!trimmedFilter) {
    const allIds = new Set(Object.keys(sceneGraph.nodes));
    return {
      visibleIds: allIds,
      matchingIds: new Set(),
      filteredRootIds: sceneGraph.rootIds,
      matchCount: 0,
    };
  }

  const matchingIds = new Set<string>();
  const visibleIds = new Set<string>();

  // Find all matching entities
  for (const [entityId, node] of Object.entries(sceneGraph.nodes)) {
    if (node.name.toLowerCase().includes(trimmedFilter)) {
      matchingIds.add(entityId);
      visibleIds.add(entityId);

      // Add all ancestors to visible set
      const ancestors = getAncestorIds(entityId, sceneGraph.nodes);
      for (const ancestorId of ancestors) {
        visibleIds.add(ancestorId);
      }
    }
  }

  // Filter root IDs to only include visible ones
  const filteredRootIds = sceneGraph.rootIds.filter((id) => visibleIds.has(id));

  return {
    visibleIds,
    matchingIds,
    filteredRootIds,
    matchCount: matchingIds.size,
  };
}

/**
 * Escape special regex characters in a string.
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
