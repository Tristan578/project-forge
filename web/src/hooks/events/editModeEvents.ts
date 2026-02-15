/**
 * Event handlers for edit mode events from the engine.
 */

import type { SetFn, GetFn } from './types';

export function handleEditModeEvent(type: string, data: unknown, set: SetFn, _get: GetFn): boolean {
  const d = data as Record<string, unknown>;

  switch (type) {
    case 'edit_mode_entered':
      set({ editModeActive: true, editModeEntityId: d.entityId as string });
      return true;

    case 'edit_mode_exited':
      set({ editModeActive: false, editModeEntityId: null, selectedIndices: [] });
      return true;

    case 'edit_mode_selection_changed':
      set({ selectedIndices: d.indices as number[] });
      return true;

    case 'edit_mode_mesh_stats':
      set({
        vertexCount: d.vertexCount as number,
        edgeCount: d.edgeCount as number,
        faceCount: d.faceCount as number,
      });
      return true;

    default:
      return false;
  }
}
