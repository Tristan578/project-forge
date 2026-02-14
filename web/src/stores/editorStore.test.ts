/**
 * Unit tests for the editorStore Zustand store.
 *
 * Tests cover selection, scene graph, transforms, materials, history,
 * engine mode, gizmo, coordinates, physics, quality, snap settings,
 * script logs, and entity CRUD actions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, setCommandDispatcher } from './editorStore';
import {
  createMockDispatch,
  makeSceneGraph,
  makeTransform,
  makeMaterialData,
  makeLightData,
  makePhysicsData,
} from '@/test/fixtures';

describe('editorStore', () => {
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    // Reset store to initial state
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

    // Set up mock dispatcher
    mockDispatch = createMockDispatch();
    setCommandDispatcher(mockDispatch as (command: string, payload: unknown) => void);
  });

  describe('Selection', () => {
    it('setSelection updates selectedIds, primaryId, primaryName', () => {
      const state = useEditorStore.getState();
      state.setSelection(['entity-1', 'entity-2'], 'entity-1', 'Cube');

      const updated = useEditorStore.getState();
      expect(updated.selectedIds.has('entity-1')).toBe(true);
      expect(updated.selectedIds.has('entity-2')).toBe(true);
      expect(updated.primaryId).toBe('entity-1');
      expect(updated.primaryName).toBe('Cube');
    });

    it('setSelection with empty array clears selection', () => {
      // Pre-populate selection
      useEditorStore.setState({
        selectedIds: new Set(['entity-1']),
        primaryId: 'entity-1',
        primaryName: 'Cube',
      });

      const state = useEditorStore.getState();
      state.setSelection([], null, null);

      const updated = useEditorStore.getState();
      expect(updated.selectedIds.size).toBe(0);
      expect(updated.primaryId).toBeNull();
      expect(updated.primaryName).toBeNull();
    });

    it('selectEntity dispatches select_entity command', () => {
      const graph = makeSceneGraph([{ id: 'entity-1', name: 'Cube' }]);
      useEditorStore.setState({ sceneGraph: graph });

      const state = useEditorStore.getState();
      state.selectEntity('entity-1', 'replace');

      expect(mockDispatch).toHaveBeenCalledWith('select_entity', {
        entityId: 'entity-1',
        mode: 'replace',
      });
    });

    it('clearSelection dispatches clear_selection command', () => {
      const state = useEditorStore.getState();
      state.clearSelection();

      expect(mockDispatch).toHaveBeenCalledWith('clear_selection', {});
    });

    it('selectEntity with replace mode sets single selection', () => {
      const graph = makeSceneGraph([
        { id: 'entity-1', name: 'Cube' },
        { id: 'entity-2', name: 'Sphere' },
      ]);
      useEditorStore.setState({ sceneGraph: graph });

      const state = useEditorStore.getState();
      state.selectEntity('entity-1', 'replace');

      const updated = useEditorStore.getState();
      expect(updated.selectedIds.size).toBe(1);
      expect(updated.selectedIds.has('entity-1')).toBe(true);
      expect(updated.primaryId).toBe('entity-1');
      expect(updated.primaryName).toBe('Cube');
    });

    it('selectEntity with add mode appends to selection', () => {
      const graph = makeSceneGraph([
        { id: 'entity-1', name: 'Cube' },
        { id: 'entity-2', name: 'Sphere' },
      ]);
      useEditorStore.setState({
        sceneGraph: graph,
        selectedIds: new Set(['entity-1']),
        primaryId: 'entity-1',
        primaryName: 'Cube',
      });

      const state = useEditorStore.getState();
      state.selectEntity('entity-2', 'add');

      const updated = useEditorStore.getState();
      expect(updated.selectedIds.size).toBe(2);
      expect(updated.selectedIds.has('entity-1')).toBe(true);
      expect(updated.selectedIds.has('entity-2')).toBe(true);
      expect(updated.primaryId).toBe('entity-2');
      expect(updated.primaryName).toBe('Sphere');
    });

    it('selectEntity with toggle mode adds if not selected', () => {
      const graph = makeSceneGraph([{ id: 'entity-1', name: 'Cube' }]);
      useEditorStore.setState({ sceneGraph: graph });

      const state = useEditorStore.getState();
      state.selectEntity('entity-1', 'toggle');

      const updated = useEditorStore.getState();
      expect(updated.selectedIds.has('entity-1')).toBe(true);
    });

    it('selectEntity with toggle mode removes if already selected', () => {
      const graph = makeSceneGraph([{ id: 'entity-1', name: 'Cube' }]);
      useEditorStore.setState({
        sceneGraph: graph,
        selectedIds: new Set(['entity-1']),
        primaryId: 'entity-1',
        primaryName: 'Cube',
      });

      const state = useEditorStore.getState();
      state.selectEntity('entity-1', 'toggle');

      const updated = useEditorStore.getState();
      expect(updated.selectedIds.has('entity-1')).toBe(false);
      expect(updated.primaryId).toBeNull();
    });
  });

  describe('Scene Graph', () => {
    it('updateSceneGraph replaces graph data', () => {
      const graph = makeSceneGraph([
        { id: 'root1', name: 'Cube' },
        { id: 'root2', name: 'Sphere' },
      ]);

      const state = useEditorStore.getState();
      state.updateSceneGraph(graph);

      const updated = useEditorStore.getState();
      expect(updated.sceneGraph.rootIds).toEqual(['root1', 'root2']);
      expect(updated.sceneGraph.nodes['root1'].name).toBe('Cube');
      expect(updated.sceneGraph.nodes['root2'].name).toBe('Sphere');
    });

    it('initial graph is empty', () => {
      const state = useEditorStore.getState();
      expect(state.sceneGraph.nodes).toEqual({});
      expect(state.sceneGraph.rootIds).toEqual([]);
    });

    it('graph update with nested hierarchy preserves parent/child', () => {
      const graph = makeSceneGraph([
        { id: 'parent', name: 'Parent', children: ['child1', 'child2'] },
        { id: 'child1', name: 'Child1', parentId: 'parent' },
        { id: 'child2', name: 'Child2', parentId: 'parent' },
      ]);

      const state = useEditorStore.getState();
      state.updateSceneGraph(graph);

      const updated = useEditorStore.getState();
      expect(updated.sceneGraph.nodes['parent'].children).toEqual(['child1', 'child2']);
      expect(updated.sceneGraph.nodes['child1'].parentId).toBe('parent');
      expect(updated.sceneGraph.nodes['child2'].parentId).toBe('parent');
    });

    it('hierarchyFilter can be set and cleared', () => {
      const state = useEditorStore.getState();
      state.setHierarchyFilter('cube');

      let updated = useEditorStore.getState();
      expect(updated.hierarchyFilter).toBe('cube');

      state.clearHierarchyFilter();
      updated = useEditorStore.getState();
      expect(updated.hierarchyFilter).toBe('');
    });
  });

  describe('Transform', () => {
    it('setPrimaryTransform updates transform state', () => {
      const transform = makeTransform('entity-1', { position: [1, 2, 3] });

      const state = useEditorStore.getState();
      state.setPrimaryTransform(transform);

      const updated = useEditorStore.getState();
      expect(updated.primaryTransform).toEqual(transform);
    });

    it('updateTransform dispatches update_transform command', () => {
      const transform = makeTransform('entity-1');
      useEditorStore.setState({ primaryTransform: transform });

      const state = useEditorStore.getState();
      state.updateTransform('entity-1', 'position', [5, 10, 15]);

      expect(mockDispatch).toHaveBeenCalledWith('update_transform', {
        entityId: 'entity-1',
        position: [5, 10, 15],
      });
    });

    it('renameEntity dispatches rename_entity command', () => {
      const graph = makeSceneGraph([{ id: 'entity-1', name: 'OldName' }]);
      useEditorStore.setState({ sceneGraph: graph });

      const state = useEditorStore.getState();
      state.renameEntity('entity-1', 'NewName');

      expect(mockDispatch).toHaveBeenCalledWith('rename_entity', {
        entityId: 'entity-1',
        name: 'NewName',
      });
    });

    it('renameEntity optimistically updates scene graph node name', () => {
      const graph = makeSceneGraph([{ id: 'entity-1', name: 'OldName' }]);
      useEditorStore.setState({ sceneGraph: graph, primaryId: 'entity-1', primaryName: 'OldName' });

      const state = useEditorStore.getState();
      state.renameEntity('entity-1', 'NewName');

      const updated = useEditorStore.getState();
      expect(updated.sceneGraph.nodes['entity-1'].name).toBe('NewName');
      expect(updated.primaryName).toBe('NewName');
    });
  });

  describe('Material', () => {
    it('setPrimaryMaterial updates material state from engine event', () => {
      const material = makeMaterialData({ metallic: 1.0, perceptualRoughness: 0.2 });

      const state = useEditorStore.getState();
      state.setPrimaryMaterial(material);

      const updated = useEditorStore.getState();
      expect(updated.primaryMaterial).toEqual(material);
    });

    it('updateMaterial dispatches update_material command', () => {
      const material = makeMaterialData({ baseColor: [1, 0, 0, 1] });

      const state = useEditorStore.getState();
      state.updateMaterial('entity-1', material);

      expect(mockDispatch).toHaveBeenCalled();
      const command = mockDispatch.mock.calls[0][0];
      const payload = mockDispatch.mock.calls[0][1] as Record<string, unknown>;
      expect(command).toBe('update_material');
      expect(payload).toHaveProperty('entityId', 'entity-1');
      expect(payload).toHaveProperty('baseColor', [1, 0, 0, 1]);
    });

    it('initial material is null', () => {
      const state = useEditorStore.getState();
      expect(state.primaryMaterial).toBeNull();
    });

    it('updateMaterial filters texture fields', () => {
      const material = makeMaterialData({
        baseColorTexture: 'texture-123',
        normalMapTexture: 'normal-456',
      });

      const state = useEditorStore.getState();
      state.updateMaterial('entity-1', material);

      const payload = mockDispatch.mock.calls[0][1] as Record<string, unknown>;
      // Texture fields should not be in payload (filtered out)
      expect(payload).not.toHaveProperty('baseColorTexture');
      expect(payload).not.toHaveProperty('normalMapTexture');
    });
  });

  describe('History', () => {
    it('setHistoryState updates canUndo, canRedo, descriptions', () => {
      const state = useEditorStore.getState();
      state.setHistoryState(true, false, 'Move Entity', null);

      const updated = useEditorStore.getState();
      expect(updated.canUndo).toBe(true);
      expect(updated.canRedo).toBe(false);
      expect(updated.undoDescription).toBe('Move Entity');
      expect(updated.redoDescription).toBeNull();
    });

    it('undo dispatches undo command', () => {
      const state = useEditorStore.getState();
      state.undo();

      expect(mockDispatch).toHaveBeenCalledWith('undo', {});
    });

    it('redo dispatches redo command', () => {
      const state = useEditorStore.getState();
      state.redo();

      expect(mockDispatch).toHaveBeenCalledWith('redo', {});
    });
  });

  describe('Engine Mode', () => {
    it('initial mode is edit', () => {
      const state = useEditorStore.getState();
      expect(state.engineMode).toBe('edit');
    });

    it('setEngineMode updates mode', () => {
      const state = useEditorStore.getState();
      state.setEngineMode('play');

      const updated = useEditorStore.getState();
      expect(updated.engineMode).toBe('play');
    });

    it('play() dispatches play command', () => {
      const state = useEditorStore.getState();
      state.play();

      expect(mockDispatch).toHaveBeenCalledWith('play', {});
    });

    it('stop() dispatches stop command', () => {
      const state = useEditorStore.getState();
      state.stop();

      expect(mockDispatch).toHaveBeenCalledWith('stop', {});
    });

    it('pause() dispatches pause command', () => {
      const state = useEditorStore.getState();
      state.pause();

      expect(mockDispatch).toHaveBeenCalledWith('pause', {});
    });

    it('resume() dispatches resume command', () => {
      const state = useEditorStore.getState();
      state.resume();

      expect(mockDispatch).toHaveBeenCalledWith('resume', {});
    });
  });

  describe('Gizmo & Coordinates', () => {
    it('setGizmoMode updates mode and dispatches', () => {
      const state = useEditorStore.getState();
      state.setGizmoMode('rotate');

      const updated = useEditorStore.getState();
      expect(updated.gizmoMode).toBe('rotate');
      expect(mockDispatch).toHaveBeenCalledWith('set_gizmo_mode', { mode: 'rotate' });
    });

    it('initial gizmo mode is translate', () => {
      const state = useEditorStore.getState();
      expect(state.gizmoMode).toBe('translate');
    });

    it('toggleCoordinateMode switches between world and local', () => {
      const state = useEditorStore.getState();
      expect(state.coordinateMode).toBe('world');

      state.toggleCoordinateMode();
      let updated = useEditorStore.getState();
      expect(updated.coordinateMode).toBe('local');

      state.toggleCoordinateMode();
      updated = useEditorStore.getState();
      expect(updated.coordinateMode).toBe('world');
    });
  });

  describe('Physics', () => {
    it('setPrimaryPhysics stores physics data', () => {
      const physics = makePhysicsData({ bodyType: 'dynamic', restitution: 0.8 });

      const state = useEditorStore.getState();
      state.setPrimaryPhysics(physics, true);

      const updated = useEditorStore.getState();
      expect(updated.primaryPhysics).toEqual(physics);
      expect(updated.physicsEnabled).toBe(true);
    });

    it('updatePhysics dispatches update_physics command', () => {
      const physics = makePhysicsData({ friction: 0.7 });

      const state = useEditorStore.getState();
      state.updatePhysics('entity-1', physics);

      expect(mockDispatch).toHaveBeenCalled();
      const command = mockDispatch.mock.calls[0][0];
      const payload = mockDispatch.mock.calls[0][1] as Record<string, unknown>;
      expect(command).toBe('update_physics');
      expect(payload).toHaveProperty('entityId', 'entity-1');
      expect(payload).toHaveProperty('friction', 0.7);
    });

    it('togglePhysics dispatches toggle_physics command', () => {
      const state = useEditorStore.getState();
      state.togglePhysics('entity-1', true);

      expect(mockDispatch).toHaveBeenCalledWith('toggle_physics', {
        entityId: 'entity-1',
        enabled: true,
      });
    });

    it('toggleDebugPhysics dispatches toggle_debug_physics command', () => {
      const state = useEditorStore.getState();
      state.toggleDebugPhysics();

      expect(mockDispatch).toHaveBeenCalledWith('toggle_debug_physics', {});
    });
  });

  describe('Quality', () => {
    it('initial preset is high', () => {
      const state = useEditorStore.getState();
      expect(state.qualityPreset).toBe('high');
    });

    it('setQualityPreset dispatches set_quality_preset', () => {
      const state = useEditorStore.getState();
      state.setQualityPreset('ultra');

      expect(mockDispatch).toHaveBeenCalledWith('set_quality_preset', { preset: 'ultra' });
    });

    it('setQualityFromEngine updates without dispatch', () => {
      const state = useEditorStore.getState();
      state.setQualityFromEngine({
        preset: 'medium',
        msaaSamples: 2,
        shadowsEnabled: true,
        shadowsDirectionalOnly: false,
        bloomEnabled: false,
        chromaticAberrationEnabled: false,
        sharpeningEnabled: false,
        particleDensityScale: 0.5,
      });

      const updated = useEditorStore.getState();
      expect(updated.qualityPreset).toBe('medium');
      // Should not dispatch
      const qualityCalls = mockDispatch.mock.calls.filter((call) => call[0] === 'set_quality_preset');
      expect(qualityCalls.length).toBe(0);
    });
  });

  describe('Snap Settings', () => {
    it('initial snap disabled', () => {
      const state = useEditorStore.getState();
      expect(state.snapSettings.snapEnabled).toBe(false);
    });

    it('setSnapSettings merges partial and dispatches', () => {
      const state = useEditorStore.getState();
      state.setSnapSettings({ snapEnabled: true, translationSnap: 1.0 });

      const updated = useEditorStore.getState();
      expect(updated.snapSettings.snapEnabled).toBe(true);
      expect(updated.snapSettings.translationSnap).toBe(1.0);
      expect(mockDispatch).toHaveBeenCalledWith('set_snap_settings', {
        snapEnabled: true,
        translationSnap: 1.0,
      });
    });

    it('grid visibility toggleable', () => {
      const state = useEditorStore.getState();
      state.toggleGrid();

      expect(mockDispatch).toHaveBeenCalledWith('toggle_grid', {});
    });
  });

  describe('Script Logs', () => {
    it('addScriptLog appends entries', () => {
      const state = useEditorStore.getState();
      state.addScriptLog({
        entityId: 'entity-1',
        level: 'info',
        message: 'Test message',
        timestamp: Date.now(),
      });

      const updated = useEditorStore.getState();
      expect(updated.scriptLogs.length).toBe(1);
      expect(updated.scriptLogs[0].message).toBe('Test message');
    });

    it('clearScriptLogs empties array', () => {
      useEditorStore.setState({
        scriptLogs: [
          { entityId: 'e1', level: 'info', message: 'Msg1', timestamp: Date.now() },
          { entityId: 'e2', level: 'warn', message: 'Msg2', timestamp: Date.now() },
        ],
      });

      const state = useEditorStore.getState();
      state.clearScriptLogs();

      const updated = useEditorStore.getState();
      expect(updated.scriptLogs).toEqual([]);
    });

    it('scriptLogs caps at 200 entries', () => {
      // Pre-fill with 199 logs
      const logs = Array.from({ length: 199 }, (_, i) => ({
        entityId: `e${i}`,
        level: 'info' as const,
        message: `Msg ${i}`,
        timestamp: Date.now(),
      }));
      useEditorStore.setState({ scriptLogs: logs });

      const state = useEditorStore.getState();
      state.addScriptLog({
        entityId: 'e200',
        level: 'info',
        message: 'Msg 200',
        timestamp: Date.now(),
      });
      state.addScriptLog({
        entityId: 'e201',
        level: 'info',
        message: 'Msg 201',
        timestamp: Date.now(),
      });

      const updated = useEditorStore.getState();
      expect(updated.scriptLogs.length).toBe(200);
      // First log should be removed
      expect(updated.scriptLogs[0].entityId).toBe('e1');
      expect(updated.scriptLogs[199].entityId).toBe('e201');
    });
  });

  describe('Entity CRUD', () => {
    it('spawnEntity dispatches spawn_entity', () => {
      const state = useEditorStore.getState();
      state.spawnEntity('cube', 'MyCube');

      expect(mockDispatch).toHaveBeenCalledWith('spawn_entity', {
        entityType: 'cube',
        name: 'MyCube',
      });
    });

    it('deleteSelectedEntities dispatches delete_entities', () => {
      useEditorStore.setState({
        selectedIds: new Set(['entity-1', 'entity-2']),
      });

      const state = useEditorStore.getState();
      state.deleteSelectedEntities();

      expect(mockDispatch).toHaveBeenCalledWith('delete_entities', {
        entityIds: expect.arrayContaining(['entity-1', 'entity-2']),
      });
    });

    it('duplicateSelectedEntity dispatches duplicate_entity', () => {
      useEditorStore.setState({
        primaryId: 'entity-1',
      });

      const state = useEditorStore.getState();
      state.duplicateSelectedEntity();

      expect(mockDispatch).toHaveBeenCalledWith('duplicate_entity', {
        entityId: 'entity-1',
      });
    });

    it('reparentEntity dispatches reparent_entity', () => {
      const state = useEditorStore.getState();
      state.reparentEntity('child-1', 'new-parent', 2);

      expect(mockDispatch).toHaveBeenCalledWith('reparent_entity', {
        entityId: 'child-1',
        newParentId: 'new-parent',
        insertIndex: 2,
      });
    });
  });

  describe('Light Actions', () => {
    it('setPrimaryLight stores light data', () => {
      const light = makeLightData('point', { intensity: 1500 });

      const state = useEditorStore.getState();
      state.setPrimaryLight(light);

      const updated = useEditorStore.getState();
      expect(updated.primaryLight).toEqual(light);
    });

    it('updateLight dispatches update_light command', () => {
      const light = makeLightData('directional', { color: [1, 0.8, 0.6] });

      const state = useEditorStore.getState();
      state.updateLight('entity-1', light);

      expect(mockDispatch).toHaveBeenCalled();
      const command = mockDispatch.mock.calls[0][0];
      const payload = mockDispatch.mock.calls[0][1] as Record<string, unknown>;
      expect(command).toBe('update_light');
      expect(payload).toHaveProperty('entityId', 'entity-1');
      expect(payload).toHaveProperty('color', [1, 0.8, 0.6]);
    });

    it('updateAmbientLight dispatches update_ambient_light command', () => {
      const state = useEditorStore.getState();
      state.updateAmbientLight({ brightness: 500 });

      expect(mockDispatch).toHaveBeenCalledWith('update_ambient_light', { brightness: 500 });

      const updated = useEditorStore.getState();
      expect(updated.ambientLight.brightness).toBe(500);
    });
  });

  describe('Camera & Environment', () => {
    it('setCameraPreset dispatches set_camera_preset command', () => {
      const state = useEditorStore.getState();
      state.setCameraPreset('top');

      expect(mockDispatch).toHaveBeenCalledWith('set_camera_preset', { preset: 'top' });
    });

    it('updateEnvironment merges partial and dispatches', () => {
      const state = useEditorStore.getState();
      state.updateEnvironment({ fogEnabled: true, fogStart: 50 });

      const updated = useEditorStore.getState();
      expect(updated.environment.fogEnabled).toBe(true);
      expect(updated.environment.fogStart).toBe(50);
      expect(mockDispatch).toHaveBeenCalledWith('update_environment', {
        fogEnabled: true,
        fogStart: 50,
      });
    });
  });

  describe('Asset Actions', () => {
    it('importGltf dispatches import_gltf command', () => {
      const state = useEditorStore.getState();
      state.importGltf('base64data==', 'model.glb');

      expect(mockDispatch).toHaveBeenCalledWith('import_gltf', {
        dataBase64: 'base64data==',
        name: 'model.glb',
      });
    });

    it('loadTexture dispatches load_texture command', () => {
      const state = useEditorStore.getState();
      state.loadTexture('base64image==', 'texture.png', 'entity-1', 'baseColorTexture');

      expect(mockDispatch).toHaveBeenCalledWith('load_texture', {
        dataBase64: 'base64image==',
        name: 'texture.png',
        entityId: 'entity-1',
        slot: 'baseColorTexture',
      });
    });

    it('placeAsset dispatches place_asset command', () => {
      const state = useEditorStore.getState();
      state.placeAsset('asset-123');

      expect(mockDispatch).toHaveBeenCalledWith('place_asset', { assetId: 'asset-123' });
    });

    it('deleteAsset dispatches delete_asset command', () => {
      const state = useEditorStore.getState();
      state.deleteAsset('asset-456');

      expect(mockDispatch).toHaveBeenCalledWith('delete_asset', { assetId: 'asset-456' });
    });
  });
});
