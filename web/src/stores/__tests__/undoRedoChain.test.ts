/**
 * Undo/redo chain integration tests.
 *
 * These tests exercise the undo/redo flow through the editorStore, verifying
 * that history state is updated correctly and that the right commands are
 * dispatched to the engine for multi-step action chains.
 *
 * Because the actual undo/redo reversal is performed inside the Rust engine
 * (not in Zustand), these tests treat the store as the command layer and
 * verify that:
 *   1. Each action dispatches the expected engine command.
 *   2. setHistoryState correctly updates canUndo/canRedo/descriptions.
 *   3. undo() and redo() dispatch the correct engine commands.
 *   4. History state flags reflect what the engine reports after each step.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, setCommandDispatcher } from '@/stores/editorStore';
import {
  createMockDispatch,
  makeSceneGraph,
  makeMaterialData,
  makePhysicsData,
} from '@/test/utils/fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shared initial store reset applied before every test. */
function resetStore() {
  useEditorStore.setState({
    selectedIds: new Set<string>(),
    primaryId: null,
    primaryName: null,
    sceneGraph: { nodes: {}, rootIds: [] },
    gizmoMode: 'translate',
    primaryTransform: null,
    canUndo: false,
    canRedo: false,
    undoDescription: null,
    redoDescription: null,
    snapSettings: {
      snapEnabled: false,
      translationSnap: 0.5,
      rotationSnapDegrees: 15,
      scaleSnap: 0.25,
      gridVisible: false,
      gridSize: 0.5,
      gridExtent: 20,
    },
    primaryMaterial: null,
    primaryShaderEffect: null,
    primaryLight: null,
    ambientLight: { color: [1, 1, 1], brightness: 300 },
    environment: {
      skyboxBrightness: 1000,
      iblIntensity: 900,
      iblRotationDegrees: 0,
      clearColor: [0.1, 0.1, 0.12],
      fogEnabled: false,
      fogColor: [0.5, 0.5, 0.55],
      fogStart: 30,
      fogEnd: 100,
      skyboxPreset: null,
      skyboxAssetId: null,
    },
    currentCameraPreset: 'perspective',
    coordinateMode: 'world',
    engineMode: 'edit',
    primaryPhysics: null,
    physicsEnabled: false,
    debugPhysics: false,
    inputBindings: [],
    inputPreset: null,
    assetRegistry: {},
    primaryScript: null,
    allScripts: {},
    scriptLogs: [],
    primaryAudio: null,
    audioBuses: [
      { name: 'master', volume: 1.0, muted: false, soloed: false, effects: [] },
      { name: 'sfx', volume: 1.0, muted: false, soloed: false, effects: [] },
      { name: 'music', volume: 0.8, muted: false, soloed: false, effects: [] },
      { name: 'ambient', volume: 0.7, muted: false, soloed: false, effects: [] },
      { name: 'voice', volume: 1.0, muted: false, soloed: false, effects: [] },
    ],
    mixerPanelOpen: false,
    primaryParticle: null,
    particleEnabled: false,
    primaryAnimation: null,
    sceneName: 'Untitled',
    sceneModified: false,
    autoSaveEnabled: true,
    hierarchyFilter: '',
    isExporting: false,
    projectId: null,
    cloudSaveStatus: 'idle',
    lastCloudSave: null,
    qualityPreset: 'high',
    terrainData: {},
    hudElements: [],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Undo/Redo chain integration', () => {
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    resetStore();
    mockDispatch = createMockDispatch();
    setCommandDispatcher(mockDispatch as (command: string, payload: unknown) => void);
  });

  // -------------------------------------------------------------------------
  // 1. Spawn -> move -> rotate -> undo all
  // -------------------------------------------------------------------------
  describe('spawn -> move -> rotate -> undo chain', () => {
    it('dispatches spawn_entity, update_transform (x2), then undo commands', () => {
      const state = useEditorStore.getState();

      // Step 1: spawn
      state.spawnEntity('cube', 'MyCube');

      // Simulate engine acknowledging the spawn and reporting history
      state.setHistoryState(true, false, 'Spawn MyCube', null);
      let s = useEditorStore.getState();
      expect(s.canUndo).toBe(true);
      expect(s.canRedo).toBe(false);
      expect(s.undoDescription).toBe('Spawn MyCube');

      // Step 2: move
      state.updateTransform('entity-1', 'position', [5, 0, 0]);

      state.setHistoryState(true, false, 'Move Entity', null);
      s = useEditorStore.getState();
      expect(s.undoDescription).toBe('Move Entity');

      // Step 3: rotate
      state.updateTransform('entity-1', 'rotation', [0, 90, 0]);

      state.setHistoryState(true, false, 'Rotate Entity', null);
      s = useEditorStore.getState();
      expect(s.undoDescription).toBe('Rotate Entity');

      // Undo rotate
      state.undo();
      state.setHistoryState(true, true, 'Move Entity', 'Rotate Entity');
      s = useEditorStore.getState();
      expect(s.canUndo).toBe(true);
      expect(s.canRedo).toBe(true);
      expect(s.undoDescription).toBe('Move Entity');
      expect(s.redoDescription).toBe('Rotate Entity');

      // Undo move
      state.undo();
      state.setHistoryState(true, true, 'Spawn MyCube', 'Move Entity');
      s = useEditorStore.getState();
      expect(s.undoDescription).toBe('Spawn MyCube');
      expect(s.redoDescription).toBe('Move Entity');

      // Undo spawn
      state.undo();
      state.setHistoryState(false, true, null, 'Spawn MyCube');
      s = useEditorStore.getState();
      expect(s.canUndo).toBe(false);
      expect(s.canRedo).toBe(true);
      expect(s.undoDescription).toBeNull();
      expect(s.redoDescription).toBe('Spawn MyCube');

      // Verify undo was dispatched 3 times
      const undoCalls = mockDispatch.mock.calls.filter((c) => c[0] === 'undo');
      expect(undoCalls.length).toBe(3);
    });

    it('verifies original state is empty after undo chain clears all actions', () => {
      const state = useEditorStore.getState();
      state.spawnEntity('sphere', 'MySphere');
      state.setHistoryState(true, false, 'Spawn MySphere', null);
      state.updateTransform('entity-2', 'position', [1, 2, 3]);
      state.setHistoryState(true, false, 'Move Entity', null);
      state.undo();
      state.undo();
      state.setHistoryState(false, true, null, 'Spawn MySphere');

      const final = useEditorStore.getState();
      expect(final.canUndo).toBe(false);
      expect(final.canRedo).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Spawn 3 -> delete 1 -> undo delete -> entity restored
  // -------------------------------------------------------------------------
  describe('spawn 3 entities -> delete 1 -> undo delete', () => {
    it('dispatches delete then undo; history reflects restoration', () => {
      const graph = makeSceneGraph([
        { id: 'e1', name: 'Cube' },
        { id: 'e2', name: 'Sphere' },
        { id: 'e3', name: 'Cylinder' },
      ]);
      useEditorStore.setState({ sceneGraph: graph });

      const state = useEditorStore.getState();

      // Spawn 3 (already in scene graph above, simulate via dispatch)
      state.spawnEntity('cube', 'Cube');
      state.spawnEntity('sphere', 'Sphere');
      state.spawnEntity('cylinder', 'Cylinder');
      state.setHistoryState(true, false, 'Spawn Cylinder', null);

      // Delete entity e2 (Sphere)
      useEditorStore.setState({ selectedIds: new Set(['e2']) });
      state.deleteSelectedEntities();
      state.setHistoryState(true, false, 'Delete Sphere', null);

      let s = useEditorStore.getState();
      expect(s.canUndo).toBe(true);
      expect(s.undoDescription).toBe('Delete Sphere');

      // Undo the delete
      state.undo();

      // Engine reports entity restored, redo available
      state.setHistoryState(true, true, 'Spawn Cylinder', 'Delete Sphere');
      s = useEditorStore.getState();
      expect(s.canUndo).toBe(true);
      expect(s.canRedo).toBe(true);
      expect(s.redoDescription).toBe('Delete Sphere');

      const deleteCalls = mockDispatch.mock.calls.filter((c) => c[0] === 'delete_entities');
      expect(deleteCalls.length).toBe(1);
      const undoCalls = mockDispatch.mock.calls.filter((c) => c[0] === 'undo');
      expect(undoCalls.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Material change -> physics change -> undo both
  // -------------------------------------------------------------------------
  describe('material + physics change -> undo both', () => {
    it('dispatches material and physics updates then two undos', () => {
      const state = useEditorStore.getState();

      const material = makeMaterialData({ metallic: 1.0, perceptualRoughness: 0.1 });
      state.updateMaterial('entity-1', material);
      state.setHistoryState(true, false, 'Change Material', null);

      const physics = makePhysicsData({ bodyType: 'kinematic_position', friction: 0.9 });
      state.updatePhysics('entity-1', physics);
      state.setHistoryState(true, false, 'Change Physics', null);

      // Undo physics
      state.undo();
      state.setHistoryState(true, true, 'Change Material', 'Change Physics');

      let s = useEditorStore.getState();
      expect(s.undoDescription).toBe('Change Material');
      expect(s.redoDescription).toBe('Change Physics');

      // Undo material
      state.undo();
      state.setHistoryState(false, true, null, 'Change Material');

      s = useEditorStore.getState();
      expect(s.canUndo).toBe(false);
      expect(s.undoDescription).toBeNull();
      expect(s.redoDescription).toBe('Change Material');

      const materialCalls = mockDispatch.mock.calls.filter((c) => c[0] === 'update_material');
      expect(materialCalls.length).toBe(1);
      const physicsCalls = mockDispatch.mock.calls.filter((c) => c[0] === 'update_physics');
      expect(physicsCalls.length).toBe(1);
      const undoCalls = mockDispatch.mock.calls.filter((c) => c[0] === 'undo');
      expect(undoCalls.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Redo after undo restores the change
  // -------------------------------------------------------------------------
  describe('redo after undo', () => {
    it('dispatches redo and history reflects forward state', () => {
      const state = useEditorStore.getState();

      state.spawnEntity('cube', 'Box');
      state.setHistoryState(true, false, 'Spawn Box', null);

      state.undo();
      state.setHistoryState(false, true, null, 'Spawn Box');

      let s = useEditorStore.getState();
      expect(s.canUndo).toBe(false);
      expect(s.canRedo).toBe(true);

      // Redo restores the spawn
      state.redo();
      state.setHistoryState(true, false, 'Spawn Box', null);

      s = useEditorStore.getState();
      expect(s.canUndo).toBe(true);
      expect(s.canRedo).toBe(false);
      expect(s.undoDescription).toBe('Spawn Box');

      const redoCalls = mockDispatch.mock.calls.filter((c) => c[0] === 'redo');
      expect(redoCalls.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Undo clears redo stack when new action is taken
  // -------------------------------------------------------------------------
  describe('new action after undo clears redo stack', () => {
    it('performing a new action after undoing removes redo availability', () => {
      const state = useEditorStore.getState();

      // Build some history
      state.spawnEntity('cube', 'CubeA');
      state.setHistoryState(true, false, 'Spawn CubeA', null);
      state.spawnEntity('sphere', 'SphereB');
      state.setHistoryState(true, false, 'Spawn SphereB', null);

      // Undo one step — redo is now available
      state.undo();
      state.setHistoryState(true, true, 'Spawn CubeA', 'Spawn SphereB');

      let s = useEditorStore.getState();
      expect(s.canRedo).toBe(true);
      expect(s.redoDescription).toBe('Spawn SphereB');

      // Take a brand-new action — engine clears redo stack
      state.spawnEntity('cylinder', 'CylinderC');
      state.setHistoryState(true, false, 'Spawn CylinderC', null);

      s = useEditorStore.getState();
      expect(s.canRedo).toBe(false);
      expect(s.redoDescription).toBeNull();
      expect(s.undoDescription).toBe('Spawn CylinderC');
    });
  });

  // -------------------------------------------------------------------------
  // 6. 10-step chain: spawn, move, rename, material, physics, script,
  //    delete, undo 3, redo 1, verify state
  // -------------------------------------------------------------------------
  describe('10-step action chain with undo/redo interleaved', () => {
    it('tracks history correctly across 10 actions then partial undo/redo', () => {
      const state = useEditorStore.getState();

      // Step 1: spawn entity
      state.spawnEntity('cube', 'CubeOne');
      state.setHistoryState(true, false, 'Spawn CubeOne', null);

      // Step 2: move
      state.updateTransform('e1', 'position', [1, 0, 0]);
      state.setHistoryState(true, false, 'Move Entity', null);

      // Step 3: rename
      const graph = makeSceneGraph([{ id: 'e1', name: 'CubeOne' }]);
      useEditorStore.setState({ sceneGraph: graph, primaryId: 'e1', primaryName: 'CubeOne' });
      state.renameEntity('e1', 'NamedCube');
      state.setHistoryState(true, false, 'Rename Entity', null);

      let s = useEditorStore.getState();
      expect(s.sceneGraph.nodes['e1']?.name).toBe('NamedCube');

      // Step 4: material change
      const mat = makeMaterialData({ baseColor: [1, 0, 0, 1] });
      state.updateMaterial('e1', mat);
      state.setHistoryState(true, false, 'Change Material', null);

      // Step 5: physics change
      const phys = makePhysicsData({ bodyType: 'dynamic' });
      state.updatePhysics('e1', phys);
      state.setHistoryState(true, false, 'Change Physics', null);

      // Step 6: script change
      state.setScript('e1', 'forge.log("hello")', true);
      state.setHistoryState(true, false, 'Set Script', null);

      s = useEditorStore.getState();
      expect(s.allScripts['e1']?.source).toBe('forge.log("hello")');

      // Step 7: spawn second entity
      state.spawnEntity('sphere', 'SphereTwo');
      state.setHistoryState(true, false, 'Spawn SphereTwo', null);

      // Step 8: spawn third entity
      state.spawnEntity('cylinder', 'CylinderThree');
      state.setHistoryState(true, false, 'Spawn CylinderThree', null);

      // Step 9: delete e1
      useEditorStore.setState({ selectedIds: new Set(['e1']) });
      state.deleteSelectedEntities();
      state.setHistoryState(true, false, 'Delete NamedCube', null);

      // Step 10: move second entity
      state.updateTransform('e2', 'position', [10, 0, 0]);
      state.setHistoryState(true, false, 'Move SphereTwo', null);

      s = useEditorStore.getState();
      expect(s.canUndo).toBe(true);
      expect(s.canRedo).toBe(false);
      expect(s.undoDescription).toBe('Move SphereTwo');

      // --- Undo 3 times ---
      state.undo(); // undo move SphereTwo
      state.setHistoryState(true, true, 'Delete NamedCube', 'Move SphereTwo');

      state.undo(); // undo delete e1
      state.setHistoryState(true, true, 'Spawn CylinderThree', 'Delete NamedCube');

      state.undo(); // undo spawn CylinderThree
      state.setHistoryState(true, true, 'Spawn SphereTwo', 'Spawn CylinderThree');

      s = useEditorStore.getState();
      expect(s.canUndo).toBe(true);
      expect(s.canRedo).toBe(true);
      expect(s.undoDescription).toBe('Spawn SphereTwo');
      expect(s.redoDescription).toBe('Spawn CylinderThree');

      // --- Redo 1 time ---
      state.redo(); // redo spawn CylinderThree
      state.setHistoryState(true, true, 'Spawn CylinderThree', 'Delete NamedCube');

      s = useEditorStore.getState();
      expect(s.undoDescription).toBe('Spawn CylinderThree');
      expect(s.redoDescription).toBe('Delete NamedCube');

      // Verify total command dispatch counts
      const allCalls = mockDispatch.mock.calls;
      const undoCalls = allCalls.filter((c) => c[0] === 'undo');
      const redoCalls = allCalls.filter((c) => c[0] === 'redo');
      expect(undoCalls.length).toBe(3);
      expect(redoCalls.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('undo when canUndo is false still dispatches (engine guards)', () => {
      // Store says canUndo=false, but calling undo() still dispatches to engine.
      // The engine itself prevents illegal undos.
      const state = useEditorStore.getState();
      expect(useEditorStore.getState().canUndo).toBe(false);
      state.undo();
      const undoCalls = mockDispatch.mock.calls.filter((c) => c[0] === 'undo');
      expect(undoCalls.length).toBe(1);
    });

    it('redo when canRedo is false still dispatches (engine guards)', () => {
      const state = useEditorStore.getState();
      expect(useEditorStore.getState().canRedo).toBe(false);
      state.redo();
      const redoCalls = mockDispatch.mock.calls.filter((c) => c[0] === 'redo');
      expect(redoCalls.length).toBe(1);
    });

    it('setHistoryState with all nulls resets to no history', () => {
      useEditorStore.setState({ canUndo: true, canRedo: true, undoDescription: 'Foo', redoDescription: 'Bar' });
      const state = useEditorStore.getState();
      state.setHistoryState(false, false, null, null);
      const s = useEditorStore.getState();
      expect(s.canUndo).toBe(false);
      expect(s.canRedo).toBe(false);
      expect(s.undoDescription).toBeNull();
      expect(s.redoDescription).toBeNull();
    });

    it('consecutive undos each dispatch a separate undo command', () => {
      const state = useEditorStore.getState();
      state.undo();
      state.undo();
      state.undo();
      const undoCalls = mockDispatch.mock.calls.filter((c) => c[0] === 'undo');
      expect(undoCalls.length).toBe(3);
    });

    it('consecutive redos each dispatch a separate redo command', () => {
      const state = useEditorStore.getState();
      state.redo();
      state.redo();
      const redoCalls = mockDispatch.mock.calls.filter((c) => c[0] === 'redo');
      expect(redoCalls.length).toBe(2);
    });

    it('interleaved undo and redo dispatches correct command order', () => {
      const state = useEditorStore.getState();
      state.undo();
      state.redo();
      state.undo();
      const calls = mockDispatch.mock.calls.map((c) => c[0]);
      expect(calls).toEqual(['undo', 'redo', 'undo']);
    });
  });
});
