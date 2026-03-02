// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler, createMockStore } from './handlerTestUtils';
import { entityHandlers } from '../entityHandlers';
import { materialHandlers } from '../materialHandlers';
import { shaderHandlers } from '../shaderHandlers';

// ---------------------------------------------------------------------------
// Mock external dependencies used by shaderHandlers
// ---------------------------------------------------------------------------

// vi.hoisted runs before vi.mock hoisting, making these available in mock factories
const { mockShaderEditorStore, mockCompileToWgsl } = vi.hoisted(() => ({
  mockShaderEditorStore: { getState: vi.fn() },
  mockCompileToWgsl: vi.fn(),
}));

vi.mock('@/stores/shaderEditorStore', () => ({
  useShaderEditorStore: mockShaderEditorStore,
}));

vi.mock('@/lib/shaders/shaderNodeTypes', () => ({
  SHADER_NODE_DEFINITIONS: {
    vertex_position: {
      type: 'vertex_position',
      category: 'input',
      label: 'Vertex Position',
      description: 'World-space vertex position',
      inputs: [],
      outputs: [{ id: 'position', label: 'Position', type: 'vec3' }],
    },
    pbr_output: {
      type: 'pbr_output',
      category: 'output',
      label: 'PBR Output',
      description: 'Material output node',
      inputs: [{ id: 'base_color', label: 'Base Color', type: 'vec4' }],
      outputs: [],
    },
    multiply: {
      type: 'multiply',
      category: 'math',
      label: 'Multiply',
      description: 'Multiplies two values',
      inputs: [
        { id: 'a', label: 'A', type: 'float' },
        { id: 'b', label: 'B', type: 'float' },
      ],
      outputs: [{ id: 'result', label: 'Result', type: 'float' }],
    },
  },
}));

vi.mock('@/lib/shaders/wgslCompiler', () => ({
  compileToWgsl: (...args: unknown[]) => mockCompileToWgsl(...args),
}));

vi.mock('@/lib/materialPresets', () => ({
  getPresetById: (id: string) => {
    const presets: Record<string, { id: string; name: string; data: Record<string, unknown> }> = {
      default_gray: {
        id: 'default_gray',
        name: 'Default Gray',
        data: {
          baseColor: [0.5, 0.5, 0.5, 1.0],
          metallic: 0.0,
          perceptualRoughness: 0.5,
          reflectance: 0.5,
        },
      },
      shiny_gold: {
        id: 'shiny_gold',
        name: 'Shiny Gold',
        data: {
          baseColor: [1.0, 0.84, 0.0, 1.0],
          metallic: 1.0,
          perceptualRoughness: 0.1,
          reflectance: 0.8,
        },
      },
    };
    return presets[id] ?? undefined;
  },
}));

// ==========================================================================
// ENTITY HANDLERS
// ==========================================================================

describe('entityHandlers', () => {
  // -----------------------------------------------------------------------
  // spawn_entity
  // -----------------------------------------------------------------------
  describe('spawn_entity', () => {
    it('calls spawnEntity with type and name', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'spawn_entity', {
        entityType: 'cube',
        name: 'MyCube',
      });
      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'MyCube');
    });

    it('calls spawnEntity with type only (no name)', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'spawn_entity', {
        entityType: 'sphere',
      });
      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('sphere', undefined);
    });

    it('returns a message containing the entity type', async () => {
      const { result } = await invokeHandler(entityHandlers, 'spawn_entity', {
        entityType: 'cylinder',
      });
      expect(result.success).toBe(true);
      expect((result.result as { message: string }).message).toContain('cylinder');
    });

    it('supports different entity types', async () => {
      const types = ['cube', 'sphere', 'plane', 'capsule', 'torus', 'cone', 'point_light', 'directional_light', 'spot_light', 'empty'];
      for (const entityType of types) {
        const { result, store } = await invokeHandler(entityHandlers, 'spawn_entity', { entityType });
        expect(result.success).toBe(true);
        expect(store.spawnEntity).toHaveBeenCalledWith(entityType, undefined);
      }
    });
  });

  // -----------------------------------------------------------------------
  // despawn_entity
  // -----------------------------------------------------------------------
  describe('despawn_entity', () => {
    it('deletes multiple entities via entityIds', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'despawn_entity', {
        entityIds: ['a', 'b', 'c'],
      });
      expect(result.success).toBe(true);
      expect(store.setSelection).toHaveBeenCalledWith(['a', 'b', 'c'], 'a', null);
      expect(store.deleteSelectedEntities).toHaveBeenCalled();
      expect((result.result as { deleted: number }).deleted).toBe(3);
    });

    it('falls back to single entityId when entityIds is absent', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'despawn_entity', {
        entityId: 'solo',
      });
      expect(result.success).toBe(true);
      expect(store.setSelection).toHaveBeenCalledWith(['solo'], 'solo', null);
      expect(store.deleteSelectedEntities).toHaveBeenCalled();
      expect((result.result as { deleted: number }).deleted).toBe(1);
    });

    it('does nothing when no ids are provided', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'despawn_entity', {});
      expect(result.success).toBe(true);
      expect(store.setSelection).not.toHaveBeenCalled();
      expect(store.deleteSelectedEntities).not.toHaveBeenCalled();
      expect((result.result as { deleted: number }).deleted).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // delete_entities
  // -----------------------------------------------------------------------
  describe('delete_entities', () => {
    it('deletes entities via entityIds array', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'delete_entities', {
        entityIds: ['x', 'y'],
      });
      expect(result.success).toBe(true);
      expect(store.setSelection).toHaveBeenCalledWith(['x', 'y'], 'x', null);
      expect(store.deleteSelectedEntities).toHaveBeenCalled();
    });

    it('falls back to single entityId', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'delete_entities', {
        entityId: 'only',
      });
      expect(result.success).toBe(true);
      expect(store.setSelection).toHaveBeenCalledWith(['only'], 'only', null);
      expect(store.deleteSelectedEntities).toHaveBeenCalled();
    });

    it('does nothing when no ids are provided', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'delete_entities', {});
      expect(result.success).toBe(true);
      expect(store.setSelection).not.toHaveBeenCalled();
      expect(store.deleteSelectedEntities).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // duplicate_entity
  // -----------------------------------------------------------------------
  describe('duplicate_entity', () => {
    it('selects the entity and calls duplicateSelectedEntity', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'duplicate_entity', {
        entityId: 'ent1',
      });
      expect(result.success).toBe(true);
      expect(store.selectEntity).toHaveBeenCalledWith('ent1', 'replace');
      expect(store.duplicateSelectedEntity).toHaveBeenCalled();
    });

    it('returns a message indicating duplication', async () => {
      const { result } = await invokeHandler(entityHandlers, 'duplicate_entity', {
        entityId: 'ent2',
      });
      expect(result.success).toBe(true);
      expect((result.result as { message: string }).message).toContain('Duplicated');
    });
  });

  // -----------------------------------------------------------------------
  // update_transform
  // -----------------------------------------------------------------------
  describe('update_transform', () => {
    it('updates position only', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'update_transform', {
        entityId: 'ent1',
        position: { x: 1, y: 2, z: 3 },
      });
      expect(result.success).toBe(true);
      expect(store.updateTransform).toHaveBeenCalledWith('ent1', 'position', { x: 1, y: 2, z: 3 });
      expect(store.updateTransform).toHaveBeenCalledTimes(1);
    });

    it('updates rotation only', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'update_transform', {
        entityId: 'ent1',
        rotation: { x: 0, y: 90, z: 0 },
      });
      expect(result.success).toBe(true);
      expect(store.updateTransform).toHaveBeenCalledWith('ent1', 'rotation', { x: 0, y: 90, z: 0 });
      expect(store.updateTransform).toHaveBeenCalledTimes(1);
    });

    it('updates scale only', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'update_transform', {
        entityId: 'ent1',
        scale: { x: 2, y: 2, z: 2 },
      });
      expect(result.success).toBe(true);
      expect(store.updateTransform).toHaveBeenCalledWith('ent1', 'scale', { x: 2, y: 2, z: 2 });
      expect(store.updateTransform).toHaveBeenCalledTimes(1);
    });

    it('updates position, rotation, and scale simultaneously', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'update_transform', {
        entityId: 'ent1',
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 45, z: 0 },
        scale: { x: 3, y: 3, z: 3 },
      });
      expect(result.success).toBe(true);
      expect(store.updateTransform).toHaveBeenCalledTimes(3);
      expect(store.updateTransform).toHaveBeenCalledWith('ent1', 'position', { x: 1, y: 2, z: 3 });
      expect(store.updateTransform).toHaveBeenCalledWith('ent1', 'rotation', { x: 0, y: 45, z: 0 });
      expect(store.updateTransform).toHaveBeenCalledWith('ent1', 'scale', { x: 3, y: 3, z: 3 });
    });

    it('does not call updateTransform when no transform fields provided', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'update_transform', {
        entityId: 'ent1',
      });
      expect(result.success).toBe(true);
      expect(store.updateTransform).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // rename_entity
  // -----------------------------------------------------------------------
  describe('rename_entity', () => {
    it('calls renameEntity with the correct arguments', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'rename_entity', {
        entityId: 'ent1',
        name: 'NewName',
      });
      expect(result.success).toBe(true);
      expect(store.renameEntity).toHaveBeenCalledWith('ent1', 'NewName');
    });
  });

  // -----------------------------------------------------------------------
  // reparent_entity
  // -----------------------------------------------------------------------
  describe('reparent_entity', () => {
    it('calls reparentEntity with parent and insert index', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'reparent_entity', {
        entityId: 'child',
        newParentId: 'parent',
        insertIndex: 2,
      });
      expect(result.success).toBe(true);
      expect(store.reparentEntity).toHaveBeenCalledWith('child', 'parent', 2);
    });

    it('calls reparentEntity with null parent (root)', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'reparent_entity', {
        entityId: 'child',
        newParentId: null,
      });
      expect(result.success).toBe(true);
      expect(store.reparentEntity).toHaveBeenCalledWith('child', null, undefined);
    });

    it('calls reparentEntity without insertIndex', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'reparent_entity', {
        entityId: 'child',
        newParentId: 'parent2',
      });
      expect(result.success).toBe(true);
      expect(store.reparentEntity).toHaveBeenCalledWith('child', 'parent2', undefined);
    });
  });

  // -----------------------------------------------------------------------
  // set_visibility
  // -----------------------------------------------------------------------
  describe('set_visibility', () => {
    it('calls toggleVisibility with the entity id', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'set_visibility', {
        entityId: 'ent1',
      });
      expect(result.success).toBe(true);
      expect(store.toggleVisibility).toHaveBeenCalledWith('ent1');
    });
  });

  // -----------------------------------------------------------------------
  // select_entity
  // -----------------------------------------------------------------------
  describe('select_entity', () => {
    it('selects with replace mode by default', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'select_entity', {
        entityId: 'ent1',
      });
      expect(result.success).toBe(true);
      expect(store.selectEntity).toHaveBeenCalledWith('ent1', 'replace');
    });

    it('selects with add mode', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'select_entity', {
        entityId: 'ent1',
        mode: 'add',
      });
      expect(result.success).toBe(true);
      expect(store.selectEntity).toHaveBeenCalledWith('ent1', 'add');
    });

    it('selects with toggle mode', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'select_entity', {
        entityId: 'ent1',
        mode: 'toggle',
      });
      expect(result.success).toBe(true);
      expect(store.selectEntity).toHaveBeenCalledWith('ent1', 'toggle');
    });
  });

  // -----------------------------------------------------------------------
  // select_entities
  // -----------------------------------------------------------------------
  describe('select_entities', () => {
    it('calls setSelection with entity ids', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'select_entities', {
        entityIds: ['e1', 'e2', 'e3'],
      });
      expect(result.success).toBe(true);
      expect(store.setSelection).toHaveBeenCalledWith(['e1', 'e2', 'e3'], 'e1', null);
    });

    it('does not call setSelection for empty array', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'select_entities', {
        entityIds: [],
      });
      expect(result.success).toBe(true);
      expect(store.setSelection).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // clear_selection
  // -----------------------------------------------------------------------
  describe('clear_selection', () => {
    it('calls clearSelection', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'clear_selection');
      expect(result.success).toBe(true);
      expect(store.clearSelection).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // set_gizmo_mode
  // -----------------------------------------------------------------------
  describe('set_gizmo_mode', () => {
    it('calls setGizmoMode with translate', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'set_gizmo_mode', {
        mode: 'translate',
      });
      expect(result.success).toBe(true);
      expect(store.setGizmoMode).toHaveBeenCalledWith('translate');
    });

    it('calls setGizmoMode with rotate', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'set_gizmo_mode', {
        mode: 'rotate',
      });
      expect(result.success).toBe(true);
      expect(store.setGizmoMode).toHaveBeenCalledWith('rotate');
    });

    it('calls setGizmoMode with scale', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'set_gizmo_mode', {
        mode: 'scale',
      });
      expect(result.success).toBe(true);
      expect(store.setGizmoMode).toHaveBeenCalledWith('scale');
    });
  });

  // -----------------------------------------------------------------------
  // set_coordinate_mode
  // -----------------------------------------------------------------------
  describe('set_coordinate_mode', () => {
    it('toggles when mode differs from current', async () => {
      const { result, store } = await invokeHandler(
        entityHandlers,
        'set_coordinate_mode',
        { mode: 'local' },
        { coordinateMode: 'world' }
      );
      expect(result.success).toBe(true);
      expect(store.toggleCoordinateMode).toHaveBeenCalled();
    });

    it('does not toggle when mode matches current', async () => {
      const { result, store } = await invokeHandler(
        entityHandlers,
        'set_coordinate_mode',
        { mode: 'world' },
        { coordinateMode: 'world' }
      );
      expect(result.success).toBe(true);
      expect(store.toggleCoordinateMode).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // toggle_grid
  // -----------------------------------------------------------------------
  describe('toggle_grid', () => {
    it('calls toggleGrid', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'toggle_grid');
      expect(result.success).toBe(true);
      expect(store.toggleGrid).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // set_snap_settings
  // -----------------------------------------------------------------------
  describe('set_snap_settings', () => {
    it('calls setSnapSettings with the provided args', async () => {
      const args = { positionSnap: 0.5, rotationSnap: 15, scaleSnap: 0.1 };
      const { result, store } = await invokeHandler(entityHandlers, 'set_snap_settings', args);
      expect(result.success).toBe(true);
      expect(store.setSnapSettings).toHaveBeenCalledWith(args);
    });
  });

  // -----------------------------------------------------------------------
  // set_camera_preset
  // -----------------------------------------------------------------------
  describe('set_camera_preset', () => {
    it('calls setCameraPreset with preset name', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'set_camera_preset', {
        preset: 'top',
      });
      expect(result.success).toBe(true);
      expect(store.setCameraPreset).toHaveBeenCalledWith('top');
    });
  });

  // -----------------------------------------------------------------------
  // focus_camera
  // -----------------------------------------------------------------------
  describe('focus_camera', () => {
    it('selects entity so user can press F to focus', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'focus_camera', {
        entityId: 'ent1',
      });
      expect(result.success).toBe(true);
      expect(store.selectEntity).toHaveBeenCalledWith('ent1', 'replace');
      expect((result.result as { message: string }).message).toContain('focus');
    });
  });

  // -----------------------------------------------------------------------
  // undo / redo
  // -----------------------------------------------------------------------
  describe('undo', () => {
    it('calls undo on the store', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'undo');
      expect(result.success).toBe(true);
      expect(store.undo).toHaveBeenCalled();
    });
  });

  describe('redo', () => {
    it('calls redo on the store', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'redo');
      expect(result.success).toBe(true);
      expect(store.redo).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // get_scene_graph (query via entityHandlers)
  // -----------------------------------------------------------------------
  describe('get_scene_graph', () => {
    it('returns empty entities when graph has no nodes', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_scene_graph');
      expect(result.success).toBe(true);
      const data = result.result as { entities: unknown[]; count: number };
      expect(data.entities).toEqual([]);
      expect(data.count).toBe(0);
    });

    it('returns mapped entity summaries', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_scene_graph', {}, {
        sceneGraph: {
          nodes: {
            ent1: {
              entityId: 'ent1', name: 'Cube', parentId: null,
              children: ['ent2'], components: ['Transform', 'Mesh'], visible: true,
            },
            ent2: {
              entityId: 'ent2', name: 'Child', parentId: 'ent1',
              children: [], components: ['Transform'], visible: false,
            },
          },
          rootIds: ['ent1'],
        },
      });
      expect(result.success).toBe(true);
      const data = result.result as { entities: unknown[]; count: number };
      expect(data.count).toBe(2);
      expect(data.entities).toEqual(
        expect.arrayContaining([
          { id: 'ent1', name: 'Cube', parent: null, children: ['ent2'], visible: true },
          { id: 'ent2', name: 'Child', parent: 'ent1', children: [], visible: false },
        ])
      );
    });
  });

  // -----------------------------------------------------------------------
  // get_entity_details
  // -----------------------------------------------------------------------
  describe('get_entity_details', () => {
    it('returns error when entity is not found', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_entity_details', { entityId: 'missing' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('missing');
    });

    it('returns entity details when found', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_entity_details', { entityId: 'e1' }, {
        sceneGraph: {
          nodes: {
            e1: {
              entityId: 'e1', name: 'Box', parentId: null,
              children: [], components: ['Transform', 'Mesh'], visible: true,
            },
          },
          rootIds: ['e1'],
        },
      });
      expect(result.success).toBe(true);
      const data = result.result as { name: string; components: string[]; visible: boolean; children: string[] };
      expect(data.name).toBe('Box');
      expect(data.components).toEqual(['Transform', 'Mesh']);
      expect(data.visible).toBe(true);
      expect(data.children).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // get_selection
  // -----------------------------------------------------------------------
  describe('get_selection', () => {
    it('returns empty selection by default', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_selection');
      expect(result.success).toBe(true);
      const data = result.result as { selectedIds: string[]; primaryId: string | null };
      expect(data.selectedIds).toEqual([]);
      expect(data.primaryId).toBeNull();
    });

    it('returns current selection state', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_selection', {}, {
        selectedIds: new Set(['a', 'b']),
        primaryId: 'a',
      });
      expect(result.success).toBe(true);
      const data = result.result as { selectedIds: string[]; primaryId: string | null };
      expect(data.selectedIds).toHaveLength(2);
      expect(data.selectedIds).toEqual(expect.arrayContaining(['a', 'b']));
      expect(data.primaryId).toBe('a');
    });

    it('returns a plain array (not a Set)', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_selection', {}, {
        selectedIds: new Set(['x']),
        primaryId: 'x',
      });
      const data = result.result as { selectedIds: unknown };
      expect(Array.isArray(data.selectedIds)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // get_camera_state
  // -----------------------------------------------------------------------
  describe('get_camera_state', () => {
    it('returns current camera preset', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_camera_state');
      expect(result.success).toBe(true);
      expect((result.result as { preset: string }).preset).toBe('perspective');
    });

    it('returns overridden camera preset', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_camera_state', {}, {
        currentCameraPreset: 'top',
      });
      expect(result.success).toBe(true);
      expect((result.result as { preset: string }).preset).toBe('top');
    });
  });

  // -----------------------------------------------------------------------
  // play / stop / pause / resume
  // -----------------------------------------------------------------------
  describe('play', () => {
    it('calls play when in edit mode', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'play', {}, {
        engineMode: 'edit',
      });
      expect(result.success).toBe(true);
      expect(store.play).toHaveBeenCalled();
      expect((result.result as { message: string }).message).toContain('play');
    });

    it('returns error when already in play mode', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'play', {}, {
        engineMode: 'play',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Already');
      expect(store.play).not.toHaveBeenCalled();
    });

    it('returns error when in paused mode', async () => {
      const { result } = await invokeHandler(entityHandlers, 'play', {}, {
        engineMode: 'paused',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('stop', () => {
    it('calls stop when in play mode', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'stop', {}, {
        engineMode: 'play',
      });
      expect(result.success).toBe(true);
      expect(store.stop).toHaveBeenCalled();
    });

    it('calls stop when in paused mode', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'stop', {}, {
        engineMode: 'paused',
      });
      expect(result.success).toBe(true);
      expect(store.stop).toHaveBeenCalled();
    });

    it('returns error when already in edit mode', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'stop', {}, {
        engineMode: 'edit',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Already');
      expect(store.stop).not.toHaveBeenCalled();
    });
  });

  describe('pause', () => {
    it('calls pause when in play mode', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'pause', {}, {
        engineMode: 'play',
      });
      expect(result.success).toBe(true);
      expect(store.pause).toHaveBeenCalled();
    });

    it('returns error when not in play mode', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'pause', {}, {
        engineMode: 'edit',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not in play');
      expect(store.pause).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('calls resume when in paused mode', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'resume', {}, {
        engineMode: 'paused',
      });
      expect(result.success).toBe(true);
      expect(store.resume).toHaveBeenCalled();
    });

    it('returns error when not paused', async () => {
      const { result, store } = await invokeHandler(entityHandlers, 'resume', {}, {
        engineMode: 'play',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not paused');
      expect(store.resume).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // get_mode
  // -----------------------------------------------------------------------
  describe('get_mode', () => {
    it('returns edit mode by default', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_mode');
      expect(result.success).toBe(true);
      expect((result.result as { mode: string }).mode).toBe('edit');
    });

    it('returns play mode', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_mode', {}, { engineMode: 'play' });
      expect(result.success).toBe(true);
      expect((result.result as { mode: string }).mode).toBe('play');
    });

    it('returns paused mode', async () => {
      const { result } = await invokeHandler(entityHandlers, 'get_mode', {}, { engineMode: 'paused' });
      expect(result.success).toBe(true);
      expect((result.result as { mode: string }).mode).toBe('paused');
    });
  });
});

// ==========================================================================
// MATERIAL HANDLERS
// ==========================================================================

describe('materialHandlers', () => {
  // -----------------------------------------------------------------------
  // update_material
  // -----------------------------------------------------------------------
  describe('update_material', () => {
    it('merges partial material with defaults and calls updateMaterial', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'update_material', {
        entityId: 'ent1',
        metallic: 1.0,
        perceptualRoughness: 0.2,
      });
      expect(result.success).toBe(true);
      expect(store.updateMaterial).toHaveBeenCalledTimes(1);
      const call = (store.updateMaterial as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe('ent1');
      expect(call[1].metallic).toBe(1.0);
      expect(call[1].perceptualRoughness).toBe(0.2);
      // Default values should still be present
      expect(call[1].baseColor).toEqual([1, 1, 1, 1]);
    });

    it('uses primaryMaterial as base when available', async () => {
      const existingMaterial = {
        baseColor: [1, 0, 0, 1],
        metallic: 0.5,
        perceptualRoughness: 0.3,
        reflectance: 0.5,
        emissive: [0, 0, 0, 1],
        emissiveExposureWeight: 1,
        alphaMode: 'opaque',
        alphaCutoff: 0.5,
        doubleSided: false,
        unlit: false,
        uvOffset: [0, 0],
        uvScale: [1, 1],
        uvRotation: 0,
        parallaxDepthScale: 0.1,
        parallaxMappingMethod: 'occlusion',
        maxParallaxLayerCount: 16,
        parallaxReliefMaxSteps: 5,
        clearcoat: 0,
        clearcoatPerceptualRoughness: 0.5,
        specularTransmission: 0,
        diffuseTransmission: 0,
        ior: 1.5,
        thickness: 0,
        attenuationDistance: null,
        attenuationColor: [1, 1, 1],
      };
      const { result, store } = await invokeHandler(
        materialHandlers,
        'update_material',
        { entityId: 'ent1', metallic: 0.9 },
        { primaryMaterial: existingMaterial }
      );
      expect(result.success).toBe(true);
      const call = (store.updateMaterial as ReturnType<typeof vi.fn>).mock.calls[0];
      // Should use existing base color, not default
      expect(call[1].baseColor).toEqual([1, 0, 0, 1]);
      // Should override metallic
      expect(call[1].metallic).toBe(0.9);
      // Should keep existing roughness
      expect(call[1].perceptualRoughness).toBe(0.3);
    });

    it('strips entityId from the merged material data', async () => {
      const { store } = await invokeHandler(materialHandlers, 'update_material', {
        entityId: 'ent1',
        baseColor: [0, 1, 0, 1],
      });
      const call = (store.updateMaterial as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].entityId).toBeUndefined();
    });

    it('handles multiple material fields at once', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'update_material', {
        entityId: 'ent1',
        baseColor: [0.2, 0.3, 0.4, 1.0],
        metallic: 0.8,
        emissive: [1, 0, 0, 1],
        doubleSided: true,
        unlit: true,
      });
      expect(result.success).toBe(true);
      const call = (store.updateMaterial as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].baseColor).toEqual([0.2, 0.3, 0.4, 1.0]);
      expect(call[1].metallic).toBe(0.8);
      expect(call[1].emissive).toEqual([1, 0, 0, 1]);
      expect(call[1].doubleSided).toBe(true);
      expect(call[1].unlit).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // apply_material_preset
  // -----------------------------------------------------------------------
  describe('apply_material_preset', () => {
    it('applies a valid preset', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'apply_material_preset', {
        entityId: 'ent1',
        presetId: 'default_gray',
      });
      expect(result.success).toBe(true);
      expect(store.updateMaterial).toHaveBeenCalledTimes(1);
      const call = (store.updateMaterial as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe('ent1');
      expect(call[1].baseColor).toEqual([0.5, 0.5, 0.5, 1.0]);
    });

    it('applies a different preset', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'apply_material_preset', {
        entityId: 'ent2',
        presetId: 'shiny_gold',
      });
      expect(result.success).toBe(true);
      const call = (store.updateMaterial as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].metallic).toBe(1.0);
    });

    it('returns error for unknown preset', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'apply_material_preset', {
        entityId: 'ent1',
        presetId: 'nonexistent_preset',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent_preset');
      expect(store.updateMaterial).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // set_custom_shader
  // -----------------------------------------------------------------------
  describe('set_custom_shader', () => {
    it('calls updateShaderEffect with shader type and params', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'set_custom_shader', {
        entityId: 'ent1',
        shaderType: 'dissolve',
        threshold: 0.5,
        edgeColor: [1, 0, 0],
      });
      expect(result.success).toBe(true);
      expect(store.updateShaderEffect).toHaveBeenCalledTimes(1);
      const call = (store.updateShaderEffect as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe('ent1');
      expect(call[1].shaderType).toBe('dissolve');
      expect(call[1].threshold).toBe(0.5);
      expect(call[1].edgeColor).toEqual([1, 0, 0]);
    });

    it('returns a message containing the shader type and entity id', async () => {
      const { result } = await invokeHandler(materialHandlers, 'set_custom_shader', {
        entityId: 'ent1',
        shaderType: 'hologram',
      });
      expect(result.success).toBe(true);
      const msg = (result.result as { message: string }).message;
      expect(msg).toContain('hologram');
      expect(msg).toContain('ent1');
    });
  });

  // -----------------------------------------------------------------------
  // remove_custom_shader
  // -----------------------------------------------------------------------
  describe('remove_custom_shader', () => {
    it('calls removeShaderEffect', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'remove_custom_shader', {
        entityId: 'ent1',
      });
      expect(result.success).toBe(true);
      expect(store.removeShaderEffect).toHaveBeenCalledWith('ent1');
    });

    it('returns a message confirming removal', async () => {
      const { result } = await invokeHandler(materialHandlers, 'remove_custom_shader', {
        entityId: 'ent2',
      });
      expect(result.success).toBe(true);
      const msg = (result.result as { message: string }).message;
      expect(msg).toContain('Removed');
      expect(msg).toContain('ent2');
    });
  });

  // -----------------------------------------------------------------------
  // list_shaders
  // -----------------------------------------------------------------------
  describe('list_shaders', () => {
    it('returns a list of available shader types', async () => {
      const { result } = await invokeHandler(materialHandlers, 'list_shaders');
      expect(result.success).toBe(true);
      const data = result.result as { shaders: { type: string; name: string; description: string }[]; count: number };
      expect(data.count).toBe(6);
      expect(data.shaders).toHaveLength(6);
    });

    it('includes dissolve, hologram, force_field, lava_flow, toon, fresnel_glow', async () => {
      const { result } = await invokeHandler(materialHandlers, 'list_shaders');
      const data = result.result as { shaders: { type: string }[] };
      const types = data.shaders.map((s) => s.type);
      expect(types).toContain('dissolve');
      expect(types).toContain('hologram');
      expect(types).toContain('force_field');
      expect(types).toContain('lava_flow');
      expect(types).toContain('toon');
      expect(types).toContain('fresnel_glow');
    });

    it('each shader has type, name, and description strings', async () => {
      const { result } = await invokeHandler(materialHandlers, 'list_shaders');
      const data = result.result as { shaders: { type: string; name: string; description: string }[] };
      for (const shader of data.shaders) {
        expect(typeof shader.type).toBe('string');
        expect(typeof shader.name).toBe('string');
        expect(typeof shader.description).toBe('string');
        expect(shader.type.length).toBeGreaterThan(0);
        expect(shader.name.length).toBeGreaterThan(0);
        expect(shader.description.length).toBeGreaterThan(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // update_light
  // -----------------------------------------------------------------------
  describe('update_light', () => {
    it('merges partial light with defaults and calls updateLight', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'update_light', {
        entityId: 'light1',
        intensity: 1600,
        color: [1, 0, 0],
      });
      expect(result.success).toBe(true);
      expect(store.updateLight).toHaveBeenCalledTimes(1);
      const call = (store.updateLight as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe('light1');
      expect(call[1].intensity).toBe(1600);
      expect(call[1].color).toEqual([1, 0, 0]);
      // Defaults should persist
      expect(call[1].lightType).toBe('point');
    });

    it('uses primaryLight as base when available', async () => {
      const existingLight = {
        lightType: 'directional',
        color: [1, 1, 0],
        intensity: 1000,
        shadowsEnabled: true,
        shadowDepthBias: 0.02,
        shadowNormalBias: 1.8,
        range: 20,
        radius: 0,
        innerAngle: 0.4,
        outerAngle: 0.8,
      };
      const { result, store } = await invokeHandler(
        materialHandlers,
        'update_light',
        { entityId: 'light1', intensity: 2000 },
        { primaryLight: existingLight }
      );
      expect(result.success).toBe(true);
      const call = (store.updateLight as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].lightType).toBe('directional');
      expect(call[1].intensity).toBe(2000);
      expect(call[1].color).toEqual([1, 1, 0]);
      expect(call[1].shadowsEnabled).toBe(true);
    });

    it('strips entityId from the merged light data', async () => {
      const { store } = await invokeHandler(materialHandlers, 'update_light', {
        entityId: 'light1',
        intensity: 500,
      });
      const call = (store.updateLight as ReturnType<typeof vi.fn>).mock.calls[0];
      // entityId should not be in the merged object (it's not "in" the baseLight keys)
      expect(call[1].entityId).toBeUndefined();
    });

    it('only merges known light keys', async () => {
      const { store } = await invokeHandler(materialHandlers, 'update_light', {
        entityId: 'light1',
        unknownField: 'should be ignored',
        intensity: 999,
      });
      const call = (store.updateLight as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].intensity).toBe(999);
      // unknownField is not in baseLightData, so won't be merged
      expect(call[1].unknownField).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // update_ambient_light
  // -----------------------------------------------------------------------
  describe('update_ambient_light', () => {
    it('calls updateAmbientLight with color', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'update_ambient_light', {
        color: [0.1, 0.2, 0.3],
      });
      expect(result.success).toBe(true);
      expect(store.updateAmbientLight).toHaveBeenCalledWith({ color: [0.1, 0.2, 0.3] });
    });

    it('calls updateAmbientLight with brightness', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'update_ambient_light', {
        brightness: 0.5,
      });
      expect(result.success).toBe(true);
      expect(store.updateAmbientLight).toHaveBeenCalledWith({ brightness: 0.5 });
    });

    it('calls updateAmbientLight with both color and brightness', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'update_ambient_light', {
        color: [1, 1, 1],
        brightness: 1.0,
      });
      expect(result.success).toBe(true);
      expect(store.updateAmbientLight).toHaveBeenCalledWith({ color: [1, 1, 1], brightness: 1.0 });
    });

    it('calls updateAmbientLight with empty partial when neither provided', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'update_ambient_light', {});
      expect(result.success).toBe(true);
      expect(store.updateAmbientLight).toHaveBeenCalledWith({});
    });
  });

  // -----------------------------------------------------------------------
  // update_environment
  // -----------------------------------------------------------------------
  describe('update_environment', () => {
    it('passes args to updateEnvironment', async () => {
      const args = { clearColor: [0.1, 0.2, 0.3, 1.0], fogEnabled: true };
      const { result, store } = await invokeHandler(materialHandlers, 'update_environment', args);
      expect(result.success).toBe(true);
      expect(store.updateEnvironment).toHaveBeenCalledWith(args);
    });
  });

  // -----------------------------------------------------------------------
  // set_skybox
  // -----------------------------------------------------------------------
  describe('set_skybox', () => {
    it('calls setSkybox with preset name', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'set_skybox', {
        preset: 'sunset',
      });
      expect(result.success).toBe(true);
      expect(store.setSkybox).toHaveBeenCalledWith('sunset');
    });

    it('does not call setSkybox when preset is not provided', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'set_skybox', {});
      expect(result.success).toBe(true);
      expect(store.setSkybox).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // remove_skybox
  // -----------------------------------------------------------------------
  describe('remove_skybox', () => {
    it('calls removeSkybox', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'remove_skybox', {});
      expect(result.success).toBe(true);
      expect(store.removeSkybox).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // update_skybox
  // -----------------------------------------------------------------------
  describe('update_skybox', () => {
    it('calls updateSkybox with brightness', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'update_skybox', {
        brightness: 1.5,
      });
      expect(result.success).toBe(true);
      expect(store.updateSkybox).toHaveBeenCalledWith({ brightness: 1.5 });
    });

    it('calls updateSkybox with multiple params', async () => {
      const args = { brightness: 0.8, iblIntensity: 0.5, rotation: 45 };
      const { result, store } = await invokeHandler(materialHandlers, 'update_skybox', args);
      expect(result.success).toBe(true);
      expect(store.updateSkybox).toHaveBeenCalledWith(args);
    });
  });

  // -----------------------------------------------------------------------
  // set_custom_skybox
  // -----------------------------------------------------------------------
  describe('set_custom_skybox', () => {
    it('calls setCustomSkybox with assetId and data', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'set_custom_skybox', {
        assetId: 'sky-123',
        dataBase64: 'base64encodeddata',
      });
      expect(result.success).toBe(true);
      expect(store.setCustomSkybox).toHaveBeenCalledWith('sky-123', 'base64encodeddata');
    });

    it('returns error when assetId is missing', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'set_custom_skybox', {
        dataBase64: 'base64encodeddata',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('assetId');
      expect(store.setCustomSkybox).not.toHaveBeenCalled();
    });

    it('returns error when dataBase64 is missing', async () => {
      const { result, store } = await invokeHandler(materialHandlers, 'set_custom_skybox', {
        assetId: 'sky-123',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('dataBase64');
      expect(store.setCustomSkybox).not.toHaveBeenCalled();
    });

    it('returns error when both are missing', async () => {
      const { result } = await invokeHandler(materialHandlers, 'set_custom_skybox', {});
      expect(result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // update_post_processing
  // -----------------------------------------------------------------------
  describe('update_post_processing', () => {
    it('passes args to updatePostProcessing', async () => {
      const args = {
        bloomEnabled: true,
        bloomIntensity: 0.5,
        chromaticAberration: 0.1,
      };
      const { result, store } = await invokeHandler(materialHandlers, 'update_post_processing', args);
      expect(result.success).toBe(true);
      expect(store.updatePostProcessing).toHaveBeenCalledWith(args);
    });
  });

  // -----------------------------------------------------------------------
  // get_post_processing
  // -----------------------------------------------------------------------
  describe('get_post_processing', () => {
    it('returns null post processing by default', async () => {
      const { result } = await invokeHandler(materialHandlers, 'get_post_processing');
      expect(result.success).toBe(true);
      expect(result.result).toBeNull();
    });

    it('returns post processing settings when available', async () => {
      const ppSettings = {
        bloomEnabled: true,
        bloomIntensity: 0.3,
        chromaticAberration: 0.05,
      };
      const { result } = await invokeHandler(materialHandlers, 'get_post_processing', {}, {
        postProcessing: ppSettings,
      });
      expect(result.success).toBe(true);
      expect(result.result).toEqual(ppSettings);
    });
  });
});

// ==========================================================================
// SHADER HANDLERS
// ==========================================================================

describe('shaderHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // create_shader_graph
  // -----------------------------------------------------------------------
  describe('create_shader_graph', () => {
    it('creates a new shader graph with a given name', async () => {
      const createNewGraph = vi.fn().mockReturnValue('graph-1');
      mockShaderEditorStore.getState.mockReturnValue({ createNewGraph });

      const store = createMockStore();
      const result = await shaderHandlers.create_shader_graph(
        { name: 'My Shader' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(createNewGraph).toHaveBeenCalledWith('My Shader');
      expect(result.result).toContain('My Shader');
      expect(result.result).toContain('graph-1');
    });

    it('uses "Untitled Shader" as default name', async () => {
      const createNewGraph = vi.fn().mockReturnValue('graph-2');
      mockShaderEditorStore.getState.mockReturnValue({ createNewGraph });

      const store = createMockStore();
      const result = await shaderHandlers.create_shader_graph(
        {},
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(createNewGraph).toHaveBeenCalledWith('Untitled Shader');
    });
  });

  // -----------------------------------------------------------------------
  // add_shader_node
  // -----------------------------------------------------------------------
  describe('add_shader_node', () => {
    it('adds a node to the active graph', async () => {
      const addNode = vi.fn().mockReturnValue('node-1');
      const loadGraph = vi.fn();
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        addNode,
        loadGraph,
      });

      const store = createMockStore();
      const result = await shaderHandlers.add_shader_node(
        { nodeType: 'vertex_position', position: { x: 100, y: 200 } },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(addNode).toHaveBeenCalledWith('vertex_position', { x: 100, y: 200 }, {});
      expect(result.result).toContain('Vertex Position');
      expect(result.result).toContain('node-1');
    });

    it('uses default position {x:0, y:0} when position is not provided', async () => {
      const addNode = vi.fn().mockReturnValue('node-2');
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        addNode,
        loadGraph: vi.fn(),
      });

      const store = createMockStore();
      const result = await shaderHandlers.add_shader_node(
        { nodeType: 'multiply' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(addNode).toHaveBeenCalledWith('multiply', { x: 0, y: 0 }, {});
    });

    it('passes custom data to addNode', async () => {
      const addNode = vi.fn().mockReturnValue('node-3');
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        addNode,
        loadGraph: vi.fn(),
      });

      const store = createMockStore();
      await shaderHandlers.add_shader_node(
        { nodeType: 'multiply', data: { customParam: 42 } },
        { store, dispatchCommand: vi.fn() }
      );
      expect(addNode).toHaveBeenCalledWith('multiply', { x: 0, y: 0 }, { customParam: 42 });
    });

    it('returns error for unknown node type', async () => {
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        addNode: vi.fn(),
        loadGraph: vi.fn(),
      });

      const store = createMockStore();
      const result = await shaderHandlers.add_shader_node(
        { nodeType: 'nonexistent_node' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent_node');
      expect(result.error).toContain('Available types');
    });

    it('returns error when no active graph and no graphId specified', async () => {
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: null,
        addNode: vi.fn(),
        loadGraph: vi.fn(),
      });

      const store = createMockStore();
      const result = await shaderHandlers.add_shader_node(
        { nodeType: 'vertex_position' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active shader graph');
    });

    it('loads graph when graphId differs from activeGraphId', async () => {
      const addNode = vi.fn().mockReturnValue('node-4');
      const loadGraph = vi.fn();
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-old',
        addNode,
        loadGraph,
      });

      const store = createMockStore();
      await shaderHandlers.add_shader_node(
        { graphId: 'graph-new', nodeType: 'multiply' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(loadGraph).toHaveBeenCalledWith('graph-new');
    });

    it('does not load graph when graphId matches activeGraphId', async () => {
      const loadGraph = vi.fn();
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        addNode: vi.fn().mockReturnValue('node-5'),
        loadGraph,
      });

      const store = createMockStore();
      await shaderHandlers.add_shader_node(
        { graphId: 'graph-1', nodeType: 'multiply' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(loadGraph).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // connect_shader_nodes
  // -----------------------------------------------------------------------
  describe('connect_shader_nodes', () => {
    it('connects two nodes in the active graph', async () => {
      const addEdge = vi.fn();
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: {
          'graph-1': {
            id: 'graph-1',
            name: 'Test Graph',
            nodes: [
              { id: 'n1', type: 'vertex_position', position: { x: 0, y: 0 }, data: {} },
              { id: 'n2', type: 'pbr_output', position: { x: 200, y: 0 }, data: {} },
            ],
            edges: [],
          },
        },
        addEdge,
      });

      const store = createMockStore();
      const result = await shaderHandlers.connect_shader_nodes(
        {
          sourceNodeId: 'n1',
          sourceHandle: 'position',
          targetNodeId: 'n2',
          targetHandle: 'base_color',
        },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(addEdge).toHaveBeenCalledWith({
        source: 'n1',
        sourceHandle: 'position',
        target: 'n2',
        targetHandle: 'base_color',
      });
      expect(result.result).toContain('n1');
      expect(result.result).toContain('n2');
    });

    it('returns error when required parameters are missing', async () => {
      const store = createMockStore();
      const result = await shaderHandlers.connect_shader_nodes(
        { sourceNodeId: 'n1' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error when no active graph', async () => {
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: null,
        graphs: {},
      });

      const store = createMockStore();
      const result = await shaderHandlers.connect_shader_nodes(
        {
          sourceNodeId: 'n1',
          sourceHandle: 'out',
          targetNodeId: 'n2',
          targetHandle: 'in',
        },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active shader graph');
    });

    it('returns error when source node not found', async () => {
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: {
          'graph-1': {
            id: 'graph-1',
            name: 'Test',
            nodes: [{ id: 'n2', type: 'pbr_output', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
          },
        },
        addEdge: vi.fn(),
      });

      const store = createMockStore();
      const result = await shaderHandlers.connect_shader_nodes(
        {
          sourceNodeId: 'missing',
          sourceHandle: 'out',
          targetNodeId: 'n2',
          targetHandle: 'in',
        },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when target node not found', async () => {
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: {
          'graph-1': {
            id: 'graph-1',
            name: 'Test',
            nodes: [{ id: 'n1', type: 'vertex_position', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
          },
        },
        addEdge: vi.fn(),
      });

      const store = createMockStore();
      const result = await shaderHandlers.connect_shader_nodes(
        {
          sourceNodeId: 'n1',
          sourceHandle: 'out',
          targetNodeId: 'missing',
          targetHandle: 'in',
        },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // -----------------------------------------------------------------------
  // compile_shader
  // -----------------------------------------------------------------------
  describe('compile_shader', () => {
    it('compiles the active shader graph', async () => {
      const graph = {
        id: 'graph-1',
        name: 'MyShader',
        nodes: [{ id: 'n1', type: 'pbr_output', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      };
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: { 'graph-1': graph },
      });
      mockCompileToWgsl.mockReturnValue({ code: '@fragment fn main() -> vec4f { return vec4f(1.0); }' });

      const store = createMockStore();
      const result = await shaderHandlers.compile_shader(
        {},
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(mockCompileToWgsl).toHaveBeenCalledWith(graph);
      expect(result.result).toContain('MyShader');
      expect(result.result).toContain('WGSL');
    });

    it('compiles a specific graph by graphId', async () => {
      const graph = {
        id: 'graph-2',
        name: 'OtherShader',
        nodes: [],
        edges: [],
      };
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: { 'graph-2': graph },
      });
      mockCompileToWgsl.mockReturnValue({ code: '// compiled code' });

      const store = createMockStore();
      const result = await shaderHandlers.compile_shader(
        { graphId: 'graph-2' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(mockCompileToWgsl).toHaveBeenCalledWith(graph);
    });

    it('returns error when no active graph', async () => {
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: null,
        graphs: {},
      });

      const store = createMockStore();
      const result = await shaderHandlers.compile_shader(
        {},
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active shader graph');
    });

    it('returns error when graph not found', async () => {
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: {},
      });

      const store = createMockStore();
      const result = await shaderHandlers.compile_shader(
        { graphId: 'nonexistent' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when compilation fails', async () => {
      const graph = {
        id: 'graph-1',
        name: 'BadShader',
        nodes: [],
        edges: [],
      };
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: { 'graph-1': graph },
      });
      mockCompileToWgsl.mockReturnValue({ code: '', error: 'No PBR Output node found.' });

      const store = createMockStore();
      const result = await shaderHandlers.compile_shader(
        {},
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('PBR Output');
    });
  });

  // -----------------------------------------------------------------------
  // apply_shader_to_entity
  // -----------------------------------------------------------------------
  describe('apply_shader_to_entity', () => {
    it('applies an explicit shader type directly', async () => {
      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1', shaderType: 'dissolve' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(store.updateShaderEffect).toHaveBeenCalledWith('ent1', { shaderType: 'dissolve' });
      expect(result.result).toContain('dissolve');
    });

    it('rejects invalid explicit shader type', async () => {
      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1', shaderType: 'invalid_shader' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid shader type');
      expect(result.error).toContain('invalid_shader');
    });

    it('accepts "none" as a valid explicit shader type', async () => {
      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1', shaderType: 'none' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(store.updateShaderEffect).toHaveBeenCalledWith('ent1', { shaderType: 'none' });
    });

    it('returns error when entityId is missing', async () => {
      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        {},
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('entityId');
    });

    it('compiles and infers shader type from graph when no explicit type', async () => {
      const graph = {
        id: 'graph-1',
        name: 'Dissolve Graph',
        nodes: [],
        edges: [],
      };
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: { 'graph-1': graph },
      });
      mockCompileToWgsl.mockReturnValue({
        code: 'var dissolve_threshold: f32;',
      });

      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(store.updateShaderEffect).toHaveBeenCalledWith('ent1', { shaderType: 'dissolve' });
      expect(result.result).toContain('dissolve');
    });

    it('infers hologram shader from compiled code', async () => {
      const graph = {
        id: 'graph-1',
        name: 'Holo Graph',
        nodes: [],
        edges: [],
      };
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: { 'graph-1': graph },
      });
      mockCompileToWgsl.mockReturnValue({
        code: 'var scan_line_frequency: f32;',
      });

      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(store.updateShaderEffect).toHaveBeenCalledWith('ent1', { shaderType: 'hologram' });
    });

    it('infers toon shader from compiled code', async () => {
      const graph = {
        id: 'graph-1',
        name: 'Toon Graph',
        nodes: [],
        edges: [],
      };
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: { 'graph-1': graph },
      });
      mockCompileToWgsl.mockReturnValue({
        code: 'var toon_bands: i32 = 4;',
      });

      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(store.updateShaderEffect).toHaveBeenCalledWith('ent1', { shaderType: 'toon' });
    });

    it('infers fresnel_glow shader from compiled code', async () => {
      const graph = {
        id: 'graph-1',
        name: 'Fresnel Graph',
        nodes: [],
        edges: [],
      };
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: { 'graph-1': graph },
      });
      mockCompileToWgsl.mockReturnValue({
        code: 'let fresnel_power = 2.0;',
      });

      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(store.updateShaderEffect).toHaveBeenCalledWith('ent1', { shaderType: 'fresnel_glow' });
    });

    it('infers force_field shader from compiled code', async () => {
      const graph = {
        id: 'graph-1',
        name: 'Shield Graph',
        nodes: [],
        edges: [],
      };
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: { 'graph-1': graph },
      });
      mockCompileToWgsl.mockReturnValue({
        code: 'var force_field_intensity: f32;',
      });

      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(store.updateShaderEffect).toHaveBeenCalledWith('ent1', { shaderType: 'force_field' });
    });

    it('infers lava_flow shader from compiled code with scroll_speed and distortion', async () => {
      const graph = {
        id: 'graph-1',
        name: 'Lava Graph',
        nodes: [],
        edges: [],
      };
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: { 'graph-1': graph },
      });
      mockCompileToWgsl.mockReturnValue({
        code: 'var scroll_speed: f32 = 1.0; var distortion: f32 = 0.5;',
      });

      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(store.updateShaderEffect).toHaveBeenCalledWith('ent1', { shaderType: 'lava_flow' });
    });

    it('returns error when shader effect cannot be inferred', async () => {
      const graph = {
        id: 'graph-1',
        name: 'Unknown Graph',
        nodes: [],
        edges: [],
      };
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: { 'graph-1': graph },
      });
      mockCompileToWgsl.mockReturnValue({
        code: 'fn main() { return; }',
      });

      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('could not be mapped');
    });

    it('returns error when no shader graph is specified and none is active', async () => {
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: null,
        graphs: {},
      });

      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('No shader graph specified');
    });

    it('returns error when specified graph is not found', async () => {
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: null,
        graphs: {},
      });

      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1', graphId: 'nonexistent' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when compilation fails for graph', async () => {
      const graph = {
        id: 'graph-1',
        name: 'Broken',
        nodes: [],
        edges: [],
      };
      mockShaderEditorStore.getState.mockReturnValue({
        activeGraphId: 'graph-1',
        graphs: { 'graph-1': graph },
      });
      mockCompileToWgsl.mockReturnValue({ code: '', error: 'Cyclic dependency detected' });

      const store = createMockStore();
      const result = await shaderHandlers.apply_shader_to_entity(
        { entityId: 'ent1' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Compilation failed');
    });
  });

  // -----------------------------------------------------------------------
  // remove_shader_from_entity
  // -----------------------------------------------------------------------
  describe('remove_shader_from_entity', () => {
    it('removes shader effect from entity', async () => {
      const store = createMockStore();
      const result = await shaderHandlers.remove_shader_from_entity(
        { entityId: 'ent1' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(store.removeShaderEffect).toHaveBeenCalledWith('ent1');
      expect(result.result).toContain('Removed');
      expect(result.result).toContain('ent1');
    });

    it('returns error when entityId is missing', async () => {
      const store = createMockStore();
      const result = await shaderHandlers.remove_shader_from_entity(
        {},
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('entityId');
    });
  });

  // -----------------------------------------------------------------------
  // list_shader_presets
  // -----------------------------------------------------------------------
  describe('list_shader_presets', () => {
    it('returns message when no graphs exist', async () => {
      mockShaderEditorStore.getState.mockReturnValue({
        graphs: {},
      });

      const store = createMockStore();
      const result = await shaderHandlers.list_shader_presets(
        {},
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(result.result).toContain('No shader graphs');
    });

    it('lists all existing shader graphs with details', async () => {
      mockShaderEditorStore.getState.mockReturnValue({
        graphs: {
          'g1': {
            id: 'g1',
            name: 'Dissolve Effect',
            nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
            edges: [{ id: 'e1' }, { id: 'e2' }],
          },
          'g2': {
            id: 'g2',
            name: 'Hologram',
            nodes: [{ id: 'n4' }],
            edges: [],
          },
        },
      });

      const store = createMockStore();
      const result = await shaderHandlers.list_shader_presets(
        {},
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(result.result).toContain('Dissolve Effect');
      expect(result.result).toContain('g1');
      expect(result.result).toContain('3 nodes');
      expect(result.result).toContain('2 edges');
      expect(result.result).toContain('Hologram');
      expect(result.result).toContain('g2');
      expect(result.result).toContain('1 nodes');
      expect(result.result).toContain('0 edges');
    });
  });
});
