import { describe, it, expect } from 'vitest';
import { buildSceneContext } from './context';

function makeState(overrides?: Record<string, unknown>) {
  return {
    sceneGraph: { nodes: {}, rootIds: [] },
    selectedIds: new Set<string>(),
    primaryId: null,
    primaryTransform: null,
    primaryMaterial: null,
    primaryLight: null,
    ambientLight: { color: [1, 1, 1] as [number, number, number], brightness: 0.3 },
    environment: {
      skyboxBrightness: 1,
      iblIntensity: 1,
      iblRotationDegrees: 0,
      clearColor: [0.1, 0.1, 0.1] as [number, number, number],
      fogEnabled: false,
      fogColor: [0.5, 0.5, 0.5] as [number, number, number],
      fogStart: 10,
      fogEnd: 100,
    },
    canUndo: false,
    canRedo: false,
    undoDescription: null,
    redoDescription: null,
    ...overrides,
  };
}

describe('buildSceneContext', () => {
  it('handles empty scene', () => {
    const ctx = buildSceneContext(makeState());
    expect(ctx).toContain('Entities: 0');
    expect(ctx).toContain('Empty scene');
  });

  it('lists entities for small scenes', () => {
    const state = makeState({
      sceneGraph: {
        nodes: {
          '1': { entityId: '1', name: 'Cube', parentId: null, children: [], components: ['Mesh3d'], visible: true },
          '2': { entityId: '2', name: 'Light', parentId: null, children: [], components: ['PointLight'], visible: true },
        },
        rootIds: ['1', '2'],
      },
    });
    const ctx = buildSceneContext(state);
    expect(ctx).toContain('Entities: 2');
    expect(ctx).toContain('"Cube"');
    expect(ctx).toContain('"Light"');
  });

  it('includes selected entity details', () => {
    const state = makeState({
      sceneGraph: {
        nodes: {
          '1': { entityId: '1', name: 'Player', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        },
        rootIds: ['1'],
      },
      primaryId: '1',
      selectedIds: new Set(['1']),
      primaryTransform: {
        entityId: '1',
        position: [0, 1, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
    });
    const ctx = buildSceneContext(state);
    expect(ctx).toContain('Selected Entity');
    expect(ctx).toContain('Position: [0, 1, 0]');
  });

  it('includes history state', () => {
    const state = makeState({
      canUndo: true,
      undoDescription: 'Spawn Cube',
    });
    const ctx = buildSceneContext(state);
    expect(ctx).toContain('History');
    expect(ctx).toContain('Spawn Cube');
  });

  it('includes fog when enabled', () => {
    const state = makeState({
      environment: {
        skyboxBrightness: 1,
        iblIntensity: 1,
        iblRotationDegrees: 0,
        clearColor: [0.1, 0.1, 0.1] as [number, number, number],
        fogEnabled: true,
        fogColor: [0.5, 0.5, 0.5] as [number, number, number],
        fogStart: 10,
        fogEnd: 100,
      },
    });
    const ctx = buildSceneContext(state);
    expect(ctx).toContain('Fog: enabled');
  });

  it('marks hidden entities', () => {
    const state = makeState({
      sceneGraph: {
        nodes: {
          '1': { entityId: '1', name: 'Hidden', parentId: null, children: [], components: ['Mesh3d'], visible: false },
        },
        rootIds: ['1'],
      },
    });
    const ctx = buildSceneContext(state);
    expect(ctx).toContain('[hidden]');
  });

  it('includes engine mode when not in edit mode', () => {
    const state = makeState({ engineMode: 'play' });
    const ctx = buildSceneContext(state);
    expect(ctx).toContain('Engine Mode: PLAY');
    expect(ctx).toContain('editing commands are disabled');
  });

  it('omits engine mode when in edit mode', () => {
    const state = makeState({ engineMode: 'edit' });
    const ctx = buildSceneContext(state);
    expect(ctx).not.toContain('Engine Mode');
  });

  it('includes input bindings when configured', () => {
    const state = makeState({
      inputBindings: [
        { actionName: 'jump', actionType: 'digital', sources: ['Space'] },
        { actionName: 'move_forward', actionType: 'axis', sources: [], positiveKeys: ['KeyW'], negativeKeys: ['KeyS'] },
      ],
      inputPreset: 'fps',
    });
    const ctx = buildSceneContext(state);
    expect(ctx).toContain('Input Bindings');
    expect(ctx).toContain('preset: fps');
    expect(ctx).toContain('2 actions');
    expect(ctx).toContain('jump');
    expect(ctx).toContain('move_forward');
  });

  it('omits input bindings when empty', () => {
    const state = makeState({ inputBindings: [] });
    const ctx = buildSceneContext(state);
    expect(ctx).not.toContain('Input Bindings');
  });

  it('includes scene name when set', () => {
    const state = makeState({ sceneName: 'My Level' });
    const ctx = buildSceneContext(state);
    expect(ctx).toContain('"My Level"');
  });

  it('omits scene name when Untitled', () => {
    const state = makeState({ sceneName: 'Untitled' });
    const ctx = buildSceneContext(state);
    expect(ctx).not.toContain('"Untitled"');
  });

  it('includes asset info when assets exist', () => {
    const state = makeState({
      assetRegistry: {
        'a1': { id: 'a1', name: 'Robot.glb', kind: 'gltf_model', fileSize: 245000, source: { type: 'upload', filename: 'Robot.glb' } },
        'a2': { id: 'a2', name: 'wood.png', kind: 'texture', fileSize: 102400, source: { type: 'upload', filename: 'wood.png' } },
      },
    });
    const ctx = buildSceneContext(state);
    expect(ctx).toContain('Assets');
    expect(ctx).toContain('2 assets');
    expect(ctx).toContain('1 model');
    expect(ctx).toContain('1 texture');
  });

  it('omits assets section when empty', () => {
    const state = makeState({ assetRegistry: {} });
    const ctx = buildSceneContext(state);
    expect(ctx).not.toContain('Assets');
  });

  it('includes script info when entities have scripts', () => {
    const state = makeState({
      allScripts: {
        '1': { source: 'function onUpdate(dt) {}', enabled: true, template: 'character_controller' },
        '2': { source: 'function onUpdate(dt) {}', enabled: false, template: null },
      },
    });
    const ctx = buildSceneContext(state);
    expect(ctx).toContain('Scripts');
    expect(ctx).toContain('2 scripted entities');
    expect(ctx).toContain('1 enabled');
    expect(ctx).toContain('1 from templates');
  });

  it('omits scripts section when no scripts', () => {
    const state = makeState({ allScripts: {} });
    const ctx = buildSceneContext(state);
    expect(ctx).not.toContain('Scripts');
  });

  it('includes physics info for selected entity', () => {
    const state = makeState({
      sceneGraph: {
        nodes: {
          '1': { entityId: '1', name: 'Box', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        },
        rootIds: ['1'],
      },
      primaryId: '1',
      selectedIds: new Set(['1']),
      primaryTransform: {
        entityId: '1',
        position: [0, 1, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
      primaryPhysics: {
        bodyType: 'dynamic',
        colliderShape: 'cuboid',
        restitution: 0.5,
        friction: 0.3,
        density: 2.0,
        gravityScale: 1.0,
        lockTranslationX: false,
        lockTranslationY: false,
        lockTranslationZ: false,
        lockRotationX: false,
        lockRotationY: false,
        lockRotationZ: false,
        isSensor: false,
      },
      physicsEnabled: true,
    });
    const ctx = buildSceneContext(state);
    expect(ctx).toContain('Physics: dynamic');
    expect(ctx).toContain('collider=cuboid');
    expect(ctx).toContain('density=2');
  });
});
