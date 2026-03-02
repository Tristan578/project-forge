/**
 * Tests for edit mode (polygon modeling) chat handlers.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { editModeHandlers } from '../editModeHandlers';
import { invokeHandler } from './handlerTestUtils';

describe('editModeHandlers', () => {
  describe('enter_edit_mode', () => {
    it('calls enterEditMode', async () => {
      const { result, store } = await invokeHandler(editModeHandlers, 'enter_edit_mode', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.enterEditMode).toHaveBeenCalledWith('ent-1');
    });
  });

  describe('exit_edit_mode', () => {
    it('calls exitEditMode', async () => {
      const { result, store } = await invokeHandler(editModeHandlers, 'exit_edit_mode', {});
      expect(result.success).toBe(true);
      expect(store.exitEditMode).toHaveBeenCalled();
    });
  });

  describe('set_selection_mode', () => {
    it('calls setSelectionMode', async () => {
      const { result, store } = await invokeHandler(editModeHandlers, 'set_selection_mode', { mode: 'vertex' });
      expect(result.success).toBe(true);
      expect(store.setSelectionMode).toHaveBeenCalledWith('vertex');
    });
  });

  describe('mesh_extrude', () => {
    it('calls performMeshOperation with extrude', async () => {
      const { result, store } = await invokeHandler(editModeHandlers, 'mesh_extrude', {
        indices: [0, 1, 2], distance: 2.0, direction: [0, 0, 1],
      });
      expect(result.success).toBe(true);
      expect(store.performMeshOperation).toHaveBeenCalledWith('extrude', {
        indices: [0, 1, 2], distance: 2.0, direction: [0, 0, 1],
      });
    });

    it('uses defaults when not provided', async () => {
      const { store } = await invokeHandler(editModeHandlers, 'mesh_extrude', {});
      expect(store.performMeshOperation).toHaveBeenCalledWith('extrude', {
        indices: [], distance: 1.0, direction: [0, 1, 0],
      });
    });
  });

  describe('mesh_inset', () => {
    it('calls performMeshOperation with inset', async () => {
      const { result, store } = await invokeHandler(editModeHandlers, 'mesh_inset', {
        indices: [3, 4], amount: 0.2,
      });
      expect(result.success).toBe(true);
      expect(store.performMeshOperation).toHaveBeenCalledWith('inset', {
        indices: [3, 4], amount: 0.2,
      });
    });
  });

  describe('mesh_bevel', () => {
    it('calls performMeshOperation with bevel', async () => {
      const { result, store } = await invokeHandler(editModeHandlers, 'mesh_bevel', {
        indices: [0], width: 0.3, segments: 3,
      });
      expect(result.success).toBe(true);
      expect(store.performMeshOperation).toHaveBeenCalledWith('bevel', {
        indices: [0], width: 0.3, segments: 3,
      });
    });

    it('uses default width and segments', async () => {
      const { store } = await invokeHandler(editModeHandlers, 'mesh_bevel', {});
      expect(store.performMeshOperation).toHaveBeenCalledWith('bevel', {
        indices: [], width: 0.1, segments: 1,
      });
    });
  });

  describe('mesh_loop_cut', () => {
    it('calls performMeshOperation with loop_cut', async () => {
      const { result, store } = await invokeHandler(editModeHandlers, 'mesh_loop_cut', {
        edgeIndex: 5, cuts: 3,
      });
      expect(result.success).toBe(true);
      expect(store.performMeshOperation).toHaveBeenCalledWith('loop_cut', {
        edgeIndex: 5, cuts: 3,
      });
    });
  });

  describe('mesh_subdivide', () => {
    it('calls performMeshOperation with subdivide', async () => {
      const { result, store } = await invokeHandler(editModeHandlers, 'mesh_subdivide', {
        indices: [0, 1], level: 2,
      });
      expect(result.success).toBe(true);
      expect(store.performMeshOperation).toHaveBeenCalledWith('subdivide', {
        indices: [0, 1], level: 2,
      });
    });
  });

  describe('mesh_delete', () => {
    it('calls performMeshOperation with delete', async () => {
      const { result, store } = await invokeHandler(editModeHandlers, 'mesh_delete', {
        indices: [2, 5], mode: 'edge',
      });
      expect(result.success).toBe(true);
      expect(store.performMeshOperation).toHaveBeenCalledWith('delete', {
        indices: [2, 5], mode: 'edge',
      });
    });

    it('defaults mode to face', async () => {
      const { store } = await invokeHandler(editModeHandlers, 'mesh_delete', {});
      expect(store.performMeshOperation).toHaveBeenCalledWith('delete', {
        indices: [], mode: 'face',
      });
    });
  });

  describe('recalc_normals', () => {
    it('calls recalcNormals with smooth', async () => {
      const { result, store } = await invokeHandler(editModeHandlers, 'recalc_normals', { smooth: false });
      expect(result.success).toBe(true);
      expect(store.recalcNormals).toHaveBeenCalledWith(false);
    });

    it('defaults smooth to true', async () => {
      const { store } = await invokeHandler(editModeHandlers, 'recalc_normals', {});
      expect(store.recalcNormals).toHaveBeenCalledWith(true);
    });
  });
});
