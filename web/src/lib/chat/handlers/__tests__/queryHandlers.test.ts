import { describe, it, expect } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { queryHandlers } from '../queryHandlers';

// ---------------------------------------------------------------------------
// get_scene_graph
// ---------------------------------------------------------------------------

describe('get_scene_graph', () => {
  it('returns empty entities when scene graph has no nodes', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_scene_graph');
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; count: number };
    expect(data.entities).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('returns mapped entity summaries with correct shape', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_scene_graph',
      {},
      {
        sceneGraph: {
          nodes: {
            ent1: {
              entityId: 'ent1',
              name: 'Cube',
              parentId: null,
              children: ['ent2'],
              components: ['Transform', 'Mesh'],
              visible: true,
            },
            ent2: {
              entityId: 'ent2',
              name: 'Child',
              parentId: 'ent1',
              children: [],
              components: ['Transform'],
              visible: false,
            },
          },
          rootIds: ['ent1'],
        },
      }
    );
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

  it('count matches entities array length', async () => {
    const nodes: Record<string, unknown> = {};
    for (let i = 0; i < 5; i++) {
      nodes[`e${i}`] = { entityId: `e${i}`, name: `Entity${i}`, parentId: null, children: [], components: [], visible: true };
    }
    const { result } = await invokeHandler(queryHandlers, 'get_scene_graph', {}, { sceneGraph: { nodes, rootIds: [] } });
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; count: number };
    expect(data.count).toBe(5);
    expect(data.entities).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// get_entity_details
// ---------------------------------------------------------------------------

describe('get_entity_details', () => {
  it('returns error when entity is not found', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_entity_details', { entityId: 'missing' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing');
  });

  it('returns entity data including components and visibility', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_entity_details',
      { entityId: 'ent1' },
      {
        sceneGraph: {
          nodes: {
            ent1: {
              entityId: 'ent1',
              name: 'MyMesh',
              parentId: null,
              children: ['ent2', 'ent3'],
              components: ['Transform', 'Mesh', 'Physics'],
              visible: true,
            },
          },
          rootIds: ['ent1'],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { name: string; components: string[]; visible: boolean; children: string[] };
    expect(data.name).toBe('MyMesh');
    expect(data.components).toEqual(['Transform', 'Mesh', 'Physics']);
    expect(data.visible).toBe(true);
    expect(data.children).toEqual(['ent2', 'ent3']);
  });

  it('returns invisible entity details correctly', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_entity_details',
      { entityId: 'hidden' },
      {
        sceneGraph: {
          nodes: {
            hidden: {
              entityId: 'hidden',
              name: 'HiddenObj',
              parentId: 'parent1',
              children: [],
              components: ['Transform'],
              visible: false,
            },
          },
          rootIds: [],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { visible: boolean };
    expect(data.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// get_selection
// ---------------------------------------------------------------------------

describe('get_selection', () => {
  it('returns empty selection when nothing is selected', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_selection', {}, {
      selectedIds: new Set<string>(),
      primaryId: null,
    });
    expect(result.success).toBe(true);
    const data = result.result as { selectedIds: string[]; primaryId: string | null };
    expect(data.selectedIds).toEqual([]);
    expect(data.primaryId).toBeNull();
  });

  it('returns correct selection state with a single entity', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_selection', {}, {
      selectedIds: new Set(['ent1']),
      primaryId: 'ent1',
    });
    expect(result.success).toBe(true);
    const data = result.result as { selectedIds: string[]; primaryId: string | null };
    expect(data.selectedIds).toEqual(['ent1']);
    expect(data.primaryId).toBe('ent1');
  });

  it('returns all ids in multi-selection', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_selection', {}, {
      selectedIds: new Set(['a', 'b', 'c']),
      primaryId: 'a',
    });
    expect(result.success).toBe(true);
    const data = result.result as { selectedIds: string[]; primaryId: string | null };
    expect(data.selectedIds).toHaveLength(3);
    expect(data.selectedIds).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(data.primaryId).toBe('a');
  });

  it('returns a plain array (not a Set) for selectedIds', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_selection', {}, {
      selectedIds: new Set(['x']),
      primaryId: 'x',
    });
    const data = result.result as { selectedIds: unknown };
    expect(Array.isArray(data.selectedIds)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get_audio_buses
// ---------------------------------------------------------------------------

describe('get_audio_buses', () => {
  it('returns empty bus list when no buses exist', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_audio_buses', {}, { audioBuses: [] });
    expect(result.success).toBe(true);
    const data = result.result as { buses: unknown[]; count: number };
    expect(data.buses).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('returns the full audio bus list with correct count', async () => {
    const buses = [
      { name: 'master', volume: 1.0, muted: false, soloed: false, effects: [] },
      { name: 'sfx', volume: 0.8, muted: false, soloed: false, effects: [] },
      { name: 'music', volume: 0.6, muted: true, soloed: false, effects: [] },
    ];
    const { result } = await invokeHandler(queryHandlers, 'get_audio_buses', {}, { audioBuses: buses });
    expect(result.success).toBe(true);
    const data = result.result as { buses: typeof buses; count: number };
    expect(data.buses).toEqual(buses);
    expect(data.count).toBe(3);
  });

  it('count matches buses array length', async () => {
    const buses = Array.from({ length: 7 }, (_, i) => ({
      name: `bus${i}`,
      volume: 1.0,
      muted: false,
      soloed: false,
      effects: [],
    }));
    const { result } = await invokeHandler(queryHandlers, 'get_audio_buses', {}, { audioBuses: buses });
    const data = result.result as { count: number };
    expect(data.count).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// list_animations
// ---------------------------------------------------------------------------

describe('list_animations', () => {
  it('returns empty clips when no animation state exists', async () => {
    const { result } = await invokeHandler(queryHandlers, 'list_animations', {}, { primaryAnimation: null });
    expect(result.success).toBe(true);
    const data = result.result as { clips: unknown[]; count: number };
    expect(data.clips).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('returns empty clips when availableClips is empty', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'list_animations',
      {},
      {
        primaryAnimation: {
          entityId: 'ent1',
          availableClips: [],
          activeClipName: null,
          activeNodeIndex: null,
          isPlaying: false,
          isPaused: false,
          elapsedSecs: 0,
          speed: 1,
          isLooping: false,
          isFinished: false,
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { clips: unknown[]; count: number };
    expect(data.clips).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('returns clips with name and duration mapped from availableClips', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'list_animations',
      {},
      {
        primaryAnimation: {
          entityId: 'ent1',
          availableClips: [
            { name: 'idle', nodeIndex: 0, durationSecs: 1.5 },
            { name: 'run', nodeIndex: 1, durationSecs: 0.8 },
            { name: 'jump', nodeIndex: 2, durationSecs: 0.4 },
          ],
          activeClipName: 'run',
          activeNodeIndex: 1,
          isPlaying: true,
          isPaused: false,
          elapsedSecs: 0.3,
          speed: 1,
          isLooping: true,
          isFinished: false,
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as {
      clips: { name: string; duration: number }[];
      count: number;
      activeClip: string | null;
      isPlaying: boolean;
    };
    expect(data.count).toBe(3);
    expect(data.clips).toEqual([
      { name: 'idle', duration: 1.5 },
      { name: 'run', duration: 0.8 },
      { name: 'jump', duration: 0.4 },
    ]);
    expect(data.activeClip).toBe('run');
    expect(data.isPlaying).toBe(true);
  });

  it('reports isPlaying false when animation is paused', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'list_animations',
      {},
      {
        primaryAnimation: {
          entityId: 'ent1',
          availableClips: [{ name: 'walk', nodeIndex: 0, durationSecs: 1.0 }],
          activeClipName: 'walk',
          activeNodeIndex: 0,
          isPlaying: false,
          isPaused: true,
          elapsedSecs: 0.5,
          speed: 1,
          isLooping: false,
          isFinished: false,
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { isPlaying: boolean };
    expect(data.isPlaying).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// get_camera_state
// ---------------------------------------------------------------------------

describe('get_camera_state', () => {
  it('returns current camera preset', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_camera_state', {}, { currentCameraPreset: 'top' });
    expect(result.success).toBe(true);
    const data = result.result as { preset: string };
    expect(data.preset).toBe('top');
  });

  it('returns perspective preset from default store', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_camera_state');
    expect(result.success).toBe(true);
    const data = result.result as { preset: string };
    expect(data.preset).toBe('perspective');
  });
});

// ---------------------------------------------------------------------------
// get_mode
// ---------------------------------------------------------------------------

describe('get_mode', () => {
  it('returns edit mode from default store', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_mode');
    expect(result.success).toBe(true);
    const data = result.result as { mode: string };
    expect(data.mode).toBe('edit');
  });

  it('returns play mode when engine is in play', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_mode', {}, { engineMode: 'play' });
    expect(result.success).toBe(true);
    const data = result.result as { mode: string };
    expect(data.mode).toBe('play');
  });

  it('returns paused mode when engine is paused', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_mode', {}, { engineMode: 'paused' });
    expect(result.success).toBe(true);
    const data = result.result as { mode: string };
    expect(data.mode).toBe('paused');
  });
});

// ---------------------------------------------------------------------------
// get_physics
// ---------------------------------------------------------------------------

describe('get_physics', () => {
  it('returns null physics and false enabled by default', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_physics');
    expect(result.success).toBe(true);
    const data = result.result as { physics: unknown; enabled: boolean };
    expect(data.physics).toBeNull();
    expect(data.enabled).toBe(false);
  });

  it('returns physics data and enabled state when set', async () => {
    const physicsData = {
      bodyType: 'dynamic',
      colliderShape: 'cuboid',
      restitution: 0.5,
      friction: 0.8,
      density: 1.0,
      gravityScale: 1.0,
      lockTranslationX: false,
      lockTranslationY: false,
      lockTranslationZ: false,
      lockRotationX: false,
      lockRotationY: false,
      lockRotationZ: false,
      isSensor: false,
    };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_physics',
      {},
      { primaryPhysics: physicsData, physicsEnabled: true }
    );
    expect(result.success).toBe(true);
    const data = result.result as { physics: unknown; enabled: boolean };
    expect(data.physics).toEqual(physicsData);
    expect(data.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get_script
// ---------------------------------------------------------------------------

describe('get_script', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_script', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('entityId');
  });

  it('returns hasScript false when entity has no script', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_script',
      { entityId: 'ent1' },
      { allScripts: {} }
    );
    expect(result.success).toBe(true);
    const data = result.result as { hasScript: boolean };
    expect(data.hasScript).toBe(false);
  });

  it('returns script source and metadata when script exists', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_script',
      { entityId: 'ent1' },
      {
        allScripts: {
          ent1: { source: 'forge.update(() => {});', enabled: true, template: 'character_controller' },
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { hasScript: boolean; source: string; enabled: boolean; template: string };
    expect(data.hasScript).toBe(true);
    expect(data.source).toBe('forge.update(() => {});');
    expect(data.enabled).toBe(true);
    expect(data.template).toBe('character_controller');
  });

  it('returns hasScript true with enabled false for disabled script', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_script',
      { entityId: 'ent2' },
      {
        allScripts: {
          ent2: { source: '// empty', enabled: false, template: null },
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { hasScript: boolean; enabled: boolean };
    expect(data.hasScript).toBe(true);
    expect(data.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// get_audio
// ---------------------------------------------------------------------------

describe('get_audio', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_audio', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('entityId');
  });

  it('returns hasAudio false when no primary audio', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_audio',
      { entityId: 'ent1' },
      { primaryAudio: null }
    );
    expect(result.success).toBe(true);
    const data = result.result as { hasAudio: boolean };
    expect(data.hasAudio).toBe(false);
  });

  it('returns audio data spread with hasAudio true when audio exists', async () => {
    const audioData = {
      assetId: 'asset-123',
      volume: 0.8,
      pitch: 1.0,
      loopAudio: true,
      spatial: false,
      maxDistance: 50,
      refDistance: 1,
      rolloffFactor: 1,
      autoplay: false,
      bus: 'sfx',
    };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_audio',
      { entityId: 'ent1' },
      { primaryAudio: audioData }
    );
    expect(result.success).toBe(true);
    const data = result.result as { hasAudio: boolean; assetId: string; volume: number; bus: string };
    expect(data.hasAudio).toBe(true);
    expect(data.assetId).toBe('asset-123');
    expect(data.volume).toBe(0.8);
    expect(data.bus).toBe('sfx');
  });
});

// ---------------------------------------------------------------------------
// get_animation_state
// ---------------------------------------------------------------------------

describe('get_animation_state', () => {
  it('returns hasAnimation false when no animation state', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_animation_state', {}, { primaryAnimation: null });
    expect(result.success).toBe(true);
    const data = result.result as { hasAnimation: boolean };
    expect(data.hasAnimation).toBe(false);
  });

  it('returns animation state spread with hasAnimation true', async () => {
    const animState = {
      entityId: 'ent1',
      availableClips: [{ name: 'idle', nodeIndex: 0, durationSecs: 1.0 }],
      activeClipName: 'idle',
      activeNodeIndex: 0,
      isPlaying: true,
      isPaused: false,
      elapsedSecs: 0.25,
      speed: 1.5,
      isLooping: true,
      isFinished: false,
    };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_animation_state',
      {},
      { primaryAnimation: animState }
    );
    expect(result.success).toBe(true);
    const data = result.result as { hasAnimation: boolean; isPlaying: boolean; speed: number };
    expect(data.hasAnimation).toBe(true);
    expect(data.isPlaying).toBe(true);
    expect(data.speed).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// get_scene_name
// ---------------------------------------------------------------------------

describe('get_scene_name', () => {
  it('returns default scene name from mock store', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_scene_name');
    expect(result.success).toBe(true);
    const data = result.result as { sceneName: string; modified: boolean };
    expect(data.sceneName).toBe('Untitled');
    expect(data.modified).toBe(false);
  });

  it('returns custom scene name and modified state', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_scene_name',
      {},
      { sceneName: 'Level1', sceneModified: true }
    );
    expect(result.success).toBe(true);
    const data = result.result as { sceneName: string; modified: boolean };
    expect(data.sceneName).toBe('Level1');
    expect(data.modified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get_input_bindings
// ---------------------------------------------------------------------------

describe('get_input_bindings', () => {
  it('returns empty bindings by default', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_input_bindings');
    expect(result.success).toBe(true);
    const data = result.result as { bindings: unknown[]; preset: string; count: number };
    expect(data.bindings).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('returns bindings and preset from store', async () => {
    const bindings = [
      { actionName: 'move_forward', actionType: 'digital', sources: ['KeyW'] },
      { actionName: 'move_left', actionType: 'digital', sources: ['KeyA'] },
    ];
    const { result } = await invokeHandler(
      queryHandlers,
      'get_input_bindings',
      {},
      { inputBindings: bindings, inputPreset: 'fps' }
    );
    expect(result.success).toBe(true);
    const data = result.result as { bindings: unknown[]; preset: string; count: number };
    expect(data.bindings).toEqual(bindings);
    expect(data.preset).toBe('fps');
    expect(data.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// get_input_state
// ---------------------------------------------------------------------------

describe('get_input_state', () => {
  it('returns a message and the current engine mode', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_input_state', {}, { engineMode: 'play' });
    expect(result.success).toBe(true);
    const data = result.result as { message: string; mode: string };
    expect(typeof data.message).toBe('string');
    expect(data.mode).toBe('play');
  });
});

// ---------------------------------------------------------------------------
// get_joint
// ---------------------------------------------------------------------------

describe('get_joint', () => {
  it('returns null joint when none is set', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_joint', {}, { primaryJoint: null });
    expect(result.success).toBe(true);
    const data = result.result as { joint: unknown };
    expect(data.joint).toBeNull();
  });

  it('returns joint data when present', async () => {
    const joint = {
      jointType: 'revolute',
      connectedEntityId: 'ent2',
      anchorSelf: [0, 0, 0],
      anchorOther: [0, 1, 0],
      axis: [0, 1, 0],
      limits: { min: -90, max: 90 },
      motor: null,
    };
    const { result } = await invokeHandler(queryHandlers, 'get_joint', {}, { primaryJoint: joint });
    expect(result.success).toBe(true);
    const data = result.result as { joint: unknown };
    expect(data.joint).toEqual(joint);
  });
});

// ---------------------------------------------------------------------------
// get_terrain
// ---------------------------------------------------------------------------

describe('get_terrain', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_terrain', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('entityId');
  });

  it('returns error when entity is not a terrain', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_terrain',
      { entityId: 'not-terrain' },
      { terrainData: {} }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('terrain');
  });

  it('returns terrain data when entity has terrain', async () => {
    const terrainData = {
      noiseType: 'perlin',
      octaves: 4,
      frequency: 0.01,
      amplitude: 1.0,
      heightScale: 10,
      seed: 42,
      resolution: 64,
      size: 100,
    };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_terrain',
      { entityId: 'terrain1' },
      { terrainData: { terrain1: terrainData } }
    );
    expect(result.success).toBe(true);
    const data = result.result as { terrainData: unknown };
    expect(data.terrainData).toEqual(terrainData);
  });
});

// ---------------------------------------------------------------------------
// list_assets
// ---------------------------------------------------------------------------

describe('list_assets', () => {
  it('returns empty asset list when registry is empty', async () => {
    const { result } = await invokeHandler(queryHandlers, 'list_assets', {}, { assetRegistry: {} });
    expect(result.success).toBe(true);
    const data = result.result as { assets: unknown[]; count: number };
    expect(data.assets).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('returns mapped asset summaries with id, name, kind, fileSize', async () => {
    const registry = {
      'asset-1': { id: 'asset-1', name: 'hero.glb', kind: 'gltf_model', fileSize: 1024, source: { type: 'upload', filename: 'hero.glb' } },
      'asset-2': { id: 'asset-2', name: 'ground.png', kind: 'texture', fileSize: 512, source: { type: 'url', url: 'https://example.com' } },
    };
    const { result } = await invokeHandler(queryHandlers, 'list_assets', {}, { assetRegistry: registry });
    expect(result.success).toBe(true);
    const data = result.result as { assets: { id: string; name: string; kind: string; fileSize: number }[]; count: number };
    expect(data.count).toBe(2);
    expect(data.assets).toEqual(
      expect.arrayContaining([
        { id: 'asset-1', name: 'hero.glb', kind: 'gltf_model', fileSize: 1024 },
        { id: 'asset-2', name: 'ground.png', kind: 'texture', fileSize: 512 },
      ])
    );
    // source field should NOT be present in the summary
    for (const asset of data.assets) {
      expect(Object.keys(asset)).not.toContain('source');
    }
  });
});

// ---------------------------------------------------------------------------
// get_particle
// ---------------------------------------------------------------------------

describe('get_particle', () => {
  it('returns null particle and disabled by default', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_particle');
    expect(result.success).toBe(true);
    const data = result.result as { particle: unknown; enabled: boolean };
    expect(data.particle).toBeNull();
    expect(data.enabled).toBe(false);
  });

  it('returns particle data and enabled state when set', async () => {
    const particleData = { preset: 'fire', maxParticles: 1000 };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_particle',
      {},
      { primaryParticle: particleData, particleEnabled: true }
    );
    expect(result.success).toBe(true);
    const data = result.result as { particle: unknown; enabled: boolean };
    expect(data.particle).toEqual(particleData);
    expect(data.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get_export_status
// ---------------------------------------------------------------------------

describe('get_export_status', () => {
  it('returns isExporting false and edit mode by default', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_export_status');
    expect(result.success).toBe(true);
    const data = result.result as { isExporting: boolean; engineMode: string };
    expect(data.isExporting).toBe(false);
    expect(data.engineMode).toBe('edit');
  });

  it('returns isExporting true when export is in progress', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_export_status', {}, { isExporting: true });
    expect(result.success).toBe(true);
    const data = result.result as { isExporting: boolean };
    expect(data.isExporting).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get_quality_settings
// ---------------------------------------------------------------------------

describe('get_quality_settings', () => {
  it('returns medium preset by default', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_quality_settings');
    expect(result.success).toBe(true);
    const data = result.result as { preset: string };
    expect(data.preset).toBe('medium');
  });

  it('returns custom quality preset from store', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_quality_settings', {}, { qualityPreset: 'ultra' });
    expect(result.success).toBe(true);
    const data = result.result as { preset: string };
    expect(data.preset).toBe('ultra');
  });
});

// ---------------------------------------------------------------------------
// get_animation_clip
// ---------------------------------------------------------------------------

describe('get_animation_clip', () => {
  it('returns no-clip message when no animation clip is selected', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_animation_clip', {}, { primaryAnimationClip: null });
    expect(result.success).toBe(true);
    const data = result.result as { message?: string };
    expect(typeof data.message).toBe('string');
  });

  it('returns animation clip state when clip exists', async () => {
    const clip = {
      tracks: [],
      duration: 2.0,
      playMode: 'loop',
      playing: true,
      speed: 1.0,
      currentTime: 0.5,
      forward: true,
      autoplay: false,
    };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_animation_clip',
      {},
      { primaryAnimationClip: clip }
    );
    expect(result.success).toBe(true);
    expect(result.result).toEqual(clip);
  });
});

// ---------------------------------------------------------------------------
// get_sprite
// ---------------------------------------------------------------------------

describe('get_sprite', () => {
  it('returns error when entity has no sprite data', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_sprite',
      { entity_id: 'ent1' },
      { sprites: {} }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('sprite');
  });

  it('returns sprite data when entity has a sprite', async () => {
    const spriteData = {
      textureAssetId: 'tex-123',
      colorTint: [1, 1, 1, 1],
      flipX: false,
      flipY: false,
      customSize: null,
      sortingLayer: 'Default',
      sortingOrder: 0,
      anchor: 'center',
    };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_sprite',
      { entity_id: 'spr1' },
      { sprites: { spr1: spriteData } }
    );
    expect(result.success).toBe(true);
    expect(result.result).toEqual(spriteData);
  });
});

// ---------------------------------------------------------------------------
// get_physics2d
// ---------------------------------------------------------------------------

describe('get_physics2d', () => {
  it('returns error when no 2D physics data exists for entity', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_physics2d',
      { entityId: 'ent1' },
      { physics2d: {} }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('2D physics');
  });

  it('returns 2D physics data when entity has it', async () => {
    const physicsData = {
      bodyType: 'dynamic',
      colliderShape: 'circle',
      size: [1, 1],
      radius: 0.5,
      vertices: [],
      mass: 1.0,
      friction: 0.5,
      restitution: 0.0,
      gravityScale: 1.0,
      isSensor: false,
      lockRotation: false,
      continuousDetection: false,
      oneWayPlatform: false,
      surfaceVelocity: [0, 0],
    };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_physics2d',
      { entityId: 'ent1' },
      { physics2d: { ent1: physicsData } }
    );
    expect(result.success).toBe(true);
    const data = result.result as { data: unknown };
    expect(data.data).toEqual(physicsData);
  });
});

// ---------------------------------------------------------------------------
// get_tilemap
// ---------------------------------------------------------------------------

describe('get_tilemap', () => {
  it('returns error when entity has no tilemap data', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_tilemap',
      { entityId: 'ent1' },
      { tilemaps: {} }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('ent1');
  });

  it('returns tilemap data when entity has it', async () => {
    const tilemapData = {
      tilesetAssetId: 'ts-1',
      tileSize: [16, 16],
      mapSize: [32, 32],
      layers: [],
      origin: 'TopLeft',
    };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_tilemap',
      { entityId: 'map1' },
      { tilemaps: { map1: tilemapData } }
    );
    expect(result.success).toBe(true);
    expect(result.result).toEqual(tilemapData);
  });
});

// ---------------------------------------------------------------------------
// get_skeleton2d
// ---------------------------------------------------------------------------

describe('get_skeleton2d', () => {
  it('returns error when entity has no skeleton data', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_skeleton2d',
      { entityId: 'ent1' },
      { skeletons2d: {} }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('ent1');
  });

  it('returns skeleton data when entity has it', async () => {
    const skeletonData = {
      bones: [{ name: 'root', parentBone: null, localPosition: [0, 0], localRotation: 0, localScale: [1, 1], length: 1, color: [1, 1, 1, 1] }],
      slots: [],
      skins: {},
      activeSkin: 'default',
      ikConstraints: [],
    };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_skeleton2d',
      { entityId: 'skel1' },
      { skeletons2d: { skel1: skeletonData } }
    );
    expect(result.success).toBe(true);
    expect(result.result).toEqual(skeletonData);
  });
});

// ---------------------------------------------------------------------------
// get_game_components
// ---------------------------------------------------------------------------

describe('get_game_components', () => {
  it('returns empty components when entity has none', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_game_components',
      { entityId: 'ent1' },
      { allGameComponents: {} }
    );
    expect(result.success).toBe(true);
    const data = result.result as { components: unknown[]; count: number };
    expect(data.components).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('returns game components and count for an entity', async () => {
    const components = [
      { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 1, respawnOnDeath: true, respawnPoint: [0, 0, 0] } },
      { type: 'collectible', collectible: { value: 10, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 1 } },
    ];
    const { result } = await invokeHandler(
      queryHandlers,
      'get_game_components',
      { entityId: 'player' },
      { allGameComponents: { player: components } }
    );
    expect(result.success).toBe(true);
    const data = result.result as { components: unknown[]; count: number };
    expect(data.components).toEqual(components);
    expect(data.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// list_game_component_types
// ---------------------------------------------------------------------------

describe('list_game_component_types', () => {
  it('returns a list of typed game component definitions', async () => {
    const { result } = await invokeHandler(queryHandlers, 'list_game_component_types');
    expect(result.success).toBe(true);
    const data = result.result as { types: { name: string; description: string }[] };
    expect(Array.isArray(data.types)).toBe(true);
    expect(data.types.length).toBeGreaterThan(0);
  });

  it('includes expected component types', async () => {
    const { result } = await invokeHandler(queryHandlers, 'list_game_component_types');
    const data = result.result as { types: { name: string; description: string }[] };
    const names = data.types.map((t) => t.name);
    expect(names).toContain('character_controller');
    expect(names).toContain('health');
    expect(names).toContain('collectible');
    expect(names).toContain('win_condition');
  });

  it('every type entry has name and description strings', async () => {
    const { result } = await invokeHandler(queryHandlers, 'list_game_component_types');
    const data = result.result as { types: { name: string; description: string }[] };
    for (const t of data.types) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// get_game_camera
// ---------------------------------------------------------------------------

describe('get_game_camera', () => {
  it('returns null camera and isActive false when entity has no camera', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_game_camera',
      { entityId: 'ent1' },
      { allGameCameras: {}, activeGameCameraId: null }
    );
    expect(result.success).toBe(true);
    const data = result.result as { camera: unknown; isActive: boolean };
    expect(data.camera).toBeNull();
    expect(data.isActive).toBe(false);
  });

  it('returns camera data and isActive true when entity is active camera', async () => {
    const cameraData = {
      mode: 'thirdPersonFollow',
      targetEntity: 'player',
      followDistance: 5,
      followHeight: 2,
    };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_game_camera',
      { entityId: 'cam1' },
      { allGameCameras: { cam1: cameraData }, activeGameCameraId: 'cam1' }
    );
    expect(result.success).toBe(true);
    const data = result.result as { camera: unknown; isActive: boolean };
    expect(data.camera).toEqual(cameraData);
    expect(data.isActive).toBe(true);
  });

  it('returns isActive false when entity has a camera but is not the active one', async () => {
    const cameraData = { mode: 'fixed', targetEntity: null };
    const { result } = await invokeHandler(
      queryHandlers,
      'get_game_camera',
      { entityId: 'cam1' },
      { allGameCameras: { cam1: cameraData }, activeGameCameraId: 'cam2' }
    );
    expect(result.success).toBe(true);
    const data = result.result as { isActive: boolean };
    expect(data.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// list_script_templates
// ---------------------------------------------------------------------------

describe('list_script_templates', () => {
  it('returns a non-empty templates array', async () => {
    const { result } = await invokeHandler(queryHandlers, 'list_script_templates');
    expect(result.success).toBe(true);
    const data = result.result as { templates: { id: string; name: string; description: string }[] };
    expect(Array.isArray(data.templates)).toBe(true);
    expect(data.templates.length).toBeGreaterThan(0);
  });

  it('every template has id, name, and description', async () => {
    const { result } = await invokeHandler(queryHandlers, 'list_script_templates');
    const data = result.result as { templates: { id: string; name: string; description: string }[] };
    for (const t of data.templates) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
    }
  });

  it('includes character_controller template', async () => {
    const { result } = await invokeHandler(queryHandlers, 'list_script_templates');
    const data = result.result as { templates: { id: string }[] };
    expect(data.templates.map((t) => t.id)).toContain('character_controller');
  });
});

// ---------------------------------------------------------------------------
// query_play_state
// ---------------------------------------------------------------------------

describe('query_play_state', () => {
  it('returns error when engine is in edit mode', async () => {
    const { result } = await invokeHandler(queryHandlers, 'query_play_state', {}, { engineMode: 'edit' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Play or Paused');
    expect(result.error).toContain('edit');
  });

  it('returns error when engine mode is not set (defaults to edit)', async () => {
    const { result } = await invokeHandler(queryHandlers, 'query_play_state');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Play or Paused');
  });

  it('returns entity list and engineMode when in play mode', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      {
        engineMode: 'play',
        sceneGraph: {
          nodes: {
            ent1: { entityId: 'ent1', name: 'Player', parentId: null, children: [], components: [], visible: true },
            ent2: { entityId: 'ent2', name: 'Enemy', parentId: null, children: [], components: [], visible: false },
          },
          rootIds: ['ent1', 'ent2'],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; entityCount: number; engineMode: string };
    expect(data.engineMode).toBe('play');
    expect(data.entityCount).toBe(2);
    expect(data.entities).toHaveLength(2);
  });

  it('returns entity list when in paused mode', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      {
        engineMode: 'paused',
        sceneGraph: {
          nodes: {
            cube1: { entityId: 'cube1', name: 'Cube', parentId: null, children: [], components: [], visible: true },
          },
          rootIds: ['cube1'],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { engineMode: string; entityCount: number };
    expect(data.engineMode).toBe('paused');
    expect(data.entityCount).toBe(1);
  });

  it('entity entries contain id, name, and visible fields', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      {
        engineMode: 'play',
        sceneGraph: {
          nodes: {
            p1: { entityId: 'p1', name: 'Hero', parentId: null, children: [], components: [], visible: true },
          },
          rootIds: ['p1'],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { entities: { id: string; name: string; visible: boolean }[] };
    expect(data.entities[0]).toMatchObject({ id: 'p1', name: 'Hero', visible: true });
  });

  it('returns empty entity list when scene has no entities in play mode', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      {
        engineMode: 'play',
        sceneGraph: { nodes: {}, rootIds: [] },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; entityCount: number };
    expect(data.entities).toEqual([]);
    expect(data.entityCount).toBe(0);
  });

  it('entityCount matches entities array length', async () => {
    const nodes: Record<string, unknown> = {};
    for (let i = 0; i < 4; i++) {
      nodes[`e${i}`] = { entityId: `e${i}`, name: `Obj${i}`, parentId: null, children: [], components: [], visible: true };
    }
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      { engineMode: 'play', sceneGraph: { nodes, rootIds: [] } }
    );
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; entityCount: number };
    expect(data.entityCount).toBe(data.entities.length);
  });
});

// ---------------------------------------------------------------------------
// get_animation_graph
// ---------------------------------------------------------------------------

describe('get_animation_graph', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_animation_graph', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('entityId');
  });

  it('returns a message acknowledging the query for a given entity', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_animation_graph', { entityId: 'char1' });
    expect(result.success).toBe(true);
    const data = result.result as { message: string };
    expect(data.message).toContain('char1');
  });
});
