/**
 * Utility functions for drag-and-drop operations in the scene hierarchy.
 */

import type { SceneGraph } from '@/stores/editorStore';

/**
 * Compute the set of invalid drop targets for a dragged entity.
 * Invalid targets include the entity itself and all its descendants.
 */
export function computeInvalidTargets(
  draggedId: string,
  sceneGraph: SceneGraph
): Set<string> {
  const invalid = new Set<string>();

  // Add self
  invalid.add(draggedId);

  // Add all descendants recursively
  const addDescendants = (id: string) => {
    const node = sceneGraph.nodes[id];
    if (node) {
      for (const childId of node.children) {
        invalid.add(childId);
        addDescendants(childId);
      }
    }
  };

  addDescendants(draggedId);
  return invalid;
}

/**
 * Drop zone type for the hierarchy.
 */
export type DropZone = 'before' | 'on' | 'after';

/**
 * Drop target information.
 */
export interface DropTarget {
  entityId: string | null; // null for root
  zone: 'before' | 'on' | 'after' | 'root';
  depth: number;
}
