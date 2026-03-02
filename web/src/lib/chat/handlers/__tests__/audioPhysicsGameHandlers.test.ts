// @vitest-environment jsdom
/**
 * Tests for audioHandlers, physicsJointHandlers, and gameplayHandlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler, createMockStore } from './handlerTestUtils';
import { physicsJointHandlers } from '../physicsJointHandlers';
import { gameplayHandlers } from '../gameplayHandlers';
import type { ToolCallContext, ExecutionResult } from '../types';

// ---------------------------------------------------------------------------
// Mock the audioManager module so audio handlers don't need real Web Audio
// ---------------------------------------------------------------------------
vi.mock('@/lib/audio/audioManager', () => ({
  audioManager: {
    setAdaptiveMusic: vi.fn(),
    setMusicIntensity: vi.fn(),
    setOcclusion: vi.fn(),
    getBusVolume: vi.fn().mockReturnValue(0.8),
    isBusMuted: vi.fn().mockReturnValue(false),
    setBusVolume: vi.fn(),
    muteBus: vi.fn(),
  },
}));

// Mock prefabStore for prefab handlers
vi.mock('@/lib/prefabs/prefabStore', () => ({
  savePrefab: vi.fn().mockReturnValue({ id: 'prefab-1', name: 'TestPrefab', category: 'uncategorized', description: '' }),
  getPrefab: vi.fn().mockImplementation((id: string) => {
    if (id === 'prefab-1') {
      return {
        id: 'prefab-1',
        name: 'TestPrefab',
        category: 'uncategorized',
        description: '',
        snapshot: {
          entityType: 'cube',
          name: 'TestPrefab',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          material: { baseColor: [1, 0, 0, 1] },
        },
      };
    }
    return undefined;
  }),
  listAllPrefabs: vi.fn().mockReturnValue([
    { id: 'prefab-1', name: 'A', category: 'cat', description: 'desc' },
    { id: 'prefab-2', name: 'B', category: 'cat', description: 'desc2' },
  ]),
  getPrefabsByCategory: vi.fn().mockReturnValue([
    { id: 'prefab-1', name: 'A', category: 'cat', description: 'desc' },
  ]),
  deletePrefab: vi.fn().mockImplementation((id: string) => id === 'prefab-1'),
}));

// Mock materialPresets for material library handlers
vi.mock('@/lib/materialPresets', () => ({
  MATERIAL_PRESETS: [
    { id: 'mp-1', name: 'Red Metal', category: 'metal', description: 'A red metallic material', tags: ['red'], data: {} },
    { id: 'mp-2', name: 'Blue Glass', category: 'glass', description: 'A blue glass material', tags: ['blue'], data: {} },
  ],
  getPresetsByCategory: vi.fn().mockReturnValue([
    { id: 'mp-1', name: 'Red Metal', category: 'metal', description: 'A red metallic material', tags: ['red'], data: {} },
  ]),
  saveCustomMaterial: vi.fn().mockReturnValue({ id: 'custom-1', name: 'MyMat' }),
  deleteCustomMaterial: vi.fn(),
  loadCustomMaterials: vi.fn().mockReturnValue([
    { id: 'custom-1', name: 'MyMat' },
    { id: 'custom-2', name: 'Mat2' },
  ]),
}));

// Mock export engine for export_game handler
vi.mock('@/lib/export/exportEngine', () => ({
  exportGame: vi.fn().mockResolvedValue(new Blob(['game'], { type: 'text/html' })),
  downloadBlob: vi.fn(),
}));

// Lazy-import audioHandlers after mocks are established
let audioHandlers: Record<string, (args: Record<string, unknown>, ctx: ToolCallContext) => Promise<ExecutionResult>>;

beforeEach(async () => {
  const mod = await import('../audioHandlers');
  audioHandlers = mod.audioHandlers;
  // Reset localStorage for snapshot tests
  localStorage.clear();
});

// ===========================================================================
// AUDIO HANDLERS
// ===========================================================================

describe('audioHandlers', () => {
  // -------------------------------------------------------------------------
  // set_adaptive_music
  // -------------------------------------------------------------------------
  describe('set_adaptive_music', () => {
    it('returns error when stems array is missing', async () => {
      const store = createMockStore();
      const result = await audioHandlers.set_adaptive_music({}, { store, dispatchCommand: vi.fn() });
      expect(result.success).toBe(false);
      expect(result.error).toContain('stems');
    });

    it('returns error when stems is empty', async () => {
      const store = createMockStore();
      const result = await audioHandlers.set_adaptive_music(
        { stems: [] },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('stems');
    });

    it('sets up adaptive music with default trackId', async () => {
      const { audioManager } = await import('@/lib/audio/audioManager');
      const store = createMockStore();
      const stems = [
        { name: 'bass', assetId: 'a1' },
        { name: 'drums', assetId: 'a2', baseVolume: 0.9, intensityRange: [0, 0.5] as [number, number] },
      ];
      const result = await audioHandlers.set_adaptive_music(
        { stems, initialIntensity: 0.5 },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(audioManager.setAdaptiveMusic).toHaveBeenCalledWith('default', stems, { bus: undefined, initialIntensity: 0.5 });
      expect(store.setAdaptiveMusicIntensity).toHaveBeenCalledWith(0.5);
      expect(result.result).toContain('bass');
      expect(result.result).toContain('drums');
    });

    it('uses custom trackId when provided', async () => {
      const { audioManager } = await import('@/lib/audio/audioManager');
      const store = createMockStore();
      const stems = [{ name: 'melody', assetId: 'a3' }];
      const result = await audioHandlers.set_adaptive_music(
        { trackId: 'battle', stems, bus: 'music' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(audioManager.setAdaptiveMusic).toHaveBeenCalledWith('battle', stems, { bus: 'music', initialIntensity: undefined });
      expect(result.result).toContain('battle');
    });

    it('defaults intensity to 0 when not provided', async () => {
      const store = createMockStore();
      const stems = [{ name: 'pad', assetId: 'a4' }];
      await audioHandlers.set_adaptive_music(
        { stems },
        { store, dispatchCommand: vi.fn() }
      );
      expect(store.setAdaptiveMusicIntensity).toHaveBeenCalledWith(0);
    });
  });

  // -------------------------------------------------------------------------
  // set_music_intensity
  // -------------------------------------------------------------------------
  describe('set_music_intensity', () => {
    it('returns error when intensity is missing', async () => {
      const store = createMockStore();
      const result = await audioHandlers.set_music_intensity(
        {},
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('intensity');
    });

    it('clamps intensity to [0,1] and calls audioManager', async () => {
      const { audioManager } = await import('@/lib/audio/audioManager');
      const store = createMockStore();
      const result = await audioHandlers.set_music_intensity(
        { intensity: 1.5 },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(audioManager.setMusicIntensity).toHaveBeenCalledWith('default', 1, undefined);
      expect(store.setAdaptiveMusicIntensity).toHaveBeenCalledWith(1);
    });

    it('clamps negative intensity to 0', async () => {
      const { audioManager } = await import('@/lib/audio/audioManager');
      const store = createMockStore();
      await audioHandlers.set_music_intensity(
        { intensity: -0.5 },
        { store, dispatchCommand: vi.fn() }
      );
      expect(audioManager.setMusicIntensity).toHaveBeenCalledWith('default', 0, undefined);
      expect(store.setAdaptiveMusicIntensity).toHaveBeenCalledWith(0);
    });

    it('uses custom trackId and rampMs', async () => {
      const { audioManager } = await import('@/lib/audio/audioManager');
      const store = createMockStore();
      const result = await audioHandlers.set_music_intensity(
        { trackId: 'calm', intensity: 0.3, rampMs: 2000 },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(audioManager.setMusicIntensity).toHaveBeenCalledWith('calm', 0.3, 2000);
      expect(result.result).toContain('calm');
      expect(result.result).toContain('2000ms');
    });
  });

  // -------------------------------------------------------------------------
  // transition_music_segment
  // -------------------------------------------------------------------------
  describe('transition_music_segment', () => {
    it('returns error when segment is missing', async () => {
      const store = createMockStore();
      const result = await audioHandlers.transition_music_segment(
        {},
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('segment');
    });

    it('sets segment on store and returns success', async () => {
      const store = createMockStore();
      const result = await audioHandlers.transition_music_segment(
        { segment: 'battle' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(store.setCurrentMusicSegment).toHaveBeenCalledWith('battle');
      expect(result.result).toContain('battle');
    });

    it('includes crossfade duration in result message when provided', async () => {
      const store = createMockStore();
      const result = await audioHandlers.transition_music_segment(
        { segment: 'exploration', crossfadeDurationMs: 500 },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(result.result).toContain('500ms');
    });
  });

  // -------------------------------------------------------------------------
  // create_audio_snapshot
  // -------------------------------------------------------------------------
  describe('create_audio_snapshot', () => {
    it('creates and stores audio snapshot in localStorage', async () => {
      const buses = [
        { name: 'master', volume: 1.0, muted: false, soloed: false, effects: [] },
        { name: 'sfx', volume: 0.8, muted: false, soloed: false, effects: [] },
      ];
      const store = createMockStore({ audioBuses: buses });
      const result = await audioHandlers.create_audio_snapshot(
        { name: 'BattleSnapshot' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(result.result).toContain('BattleSnapshot');

      const stored = JSON.parse(localStorage.getItem('audioSnapshots') || '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe('BattleSnapshot');
      expect(stored[0].buses).toHaveLength(2);
    });

    it('appends to existing snapshots', async () => {
      localStorage.setItem('audioSnapshots', JSON.stringify([{ name: 'Old', buses: [], timestamp: 1 }]));
      const store = createMockStore({ audioBuses: [] });
      await audioHandlers.create_audio_snapshot(
        { name: 'New' },
        { store, dispatchCommand: vi.fn() }
      );
      const stored = JSON.parse(localStorage.getItem('audioSnapshots') || '[]');
      expect(stored).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // apply_audio_snapshot
  // -------------------------------------------------------------------------
  describe('apply_audio_snapshot', () => {
    it('returns error when snapshot is not found', async () => {
      const store = createMockStore();
      const result = await audioHandlers.apply_audio_snapshot(
        { name: 'NonExistent' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('NonExistent');
    });

    it('applies stored snapshot with default crossfade', async () => {
      const snapshot = {
        name: 'MySnap',
        buses: [
          { name: 'master', volume: 0.5, muted: true, effects: [{ type: 'reverb' }] },
        ],
        timestamp: 1000,
      };
      localStorage.setItem('audioSnapshots', JSON.stringify([snapshot]));
      const store = createMockStore();
      const result = await audioHandlers.apply_audio_snapshot(
        { name: 'MySnap' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(result.result).toContain('MySnap');
      expect(result.result).toContain('1000ms');
      expect(store.updateAudioBus).toHaveBeenCalledWith('master', { volume: 0.5, muted: true });
      expect(store.setBusEffects).toHaveBeenCalledWith('master', [{ type: 'reverb' }]);
    });

    it('applies snapshot with custom crossfade duration', async () => {
      const snapshot = {
        name: 'Fast',
        buses: [{ name: 'sfx', volume: 0.7, muted: false }],
        timestamp: 2000,
      };
      localStorage.setItem('audioSnapshots', JSON.stringify([snapshot]));
      const store = createMockStore();
      const result = await audioHandlers.apply_audio_snapshot(
        { name: 'Fast', crossfadeDurationMs: 250 },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(result.result).toContain('250ms');
    });

    it('skips setBusEffects if bus has no effects', async () => {
      const snapshot = {
        name: 'NoFx',
        buses: [{ name: 'music', volume: 0.6, muted: false }],
        timestamp: 3000,
      };
      localStorage.setItem('audioSnapshots', JSON.stringify([snapshot]));
      const store = createMockStore();
      await audioHandlers.apply_audio_snapshot(
        { name: 'NoFx' },
        { store, dispatchCommand: vi.fn() }
      );
      expect(store.setBusEffects).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // set_audio_occlusion
  // -------------------------------------------------------------------------
  describe('set_audio_occlusion', () => {
    it('returns error when entityId is missing', async () => {
      const store = createMockStore();
      const result = await audioHandlers.set_audio_occlusion(
        { enabled: true },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('entityId');
    });

    it('enables occlusion for entity', async () => {
      const { audioManager } = await import('@/lib/audio/audioManager');
      const store = createMockStore();
      const result = await audioHandlers.set_audio_occlusion(
        { entityId: 'ent1', enabled: true },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(audioManager.setOcclusion).toHaveBeenCalledWith('ent1', true);
      expect(result.result).toContain('enabled');
    });

    it('disables occlusion for entity', async () => {
      const { audioManager } = await import('@/lib/audio/audioManager');
      const store = createMockStore();
      const result = await audioHandlers.set_audio_occlusion(
        { entityId: 'ent2', enabled: false },
        { store, dispatchCommand: vi.fn() }
      );
      expect(result.success).toBe(true);
      expect(audioManager.setOcclusion).toHaveBeenCalledWith('ent2', false);
      expect(result.result).toContain('disabled');
    });
  });
});

// ===========================================================================
// PHYSICS & JOINT HANDLERS
// ===========================================================================

describe('physicsJointHandlers', () => {
  // -------------------------------------------------------------------------
  // update_physics
  // -------------------------------------------------------------------------
  describe('update_physics', () => {
    it('merges physics data from args with default base', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'update_physics', {
        entityId: 'ent1',
        restitution: 0.7,
        friction: 0.3,
      });
      expect(result.success).toBe(true);
      expect(store.updatePhysics).toHaveBeenCalledWith('ent1', expect.objectContaining({
        bodyType: 'dynamic',
        restitution: 0.7,
        friction: 0.3,
        density: 1.0,
      }));
    });

    it('merges with existing primaryPhysics when available', async () => {
      const existing = {
        bodyType: 'kinematic' as const,
        colliderShape: 'cuboid' as const,
        restitution: 0.5,
        friction: 0.5,
        density: 2.0,
        gravityScale: 1.0,
        lockTranslationX: false,
        lockTranslationY: false,
        lockTranslationZ: false,
        lockRotationX: false,
        lockRotationY: false,
        lockRotationZ: false,
        isSensor: false,
      };
      const { result, store } = await invokeHandler(
        physicsJointHandlers,
        'update_physics',
        { entityId: 'ent2', density: 5.0 },
        { primaryPhysics: existing }
      );
      expect(result.success).toBe(true);
      expect(store.updatePhysics).toHaveBeenCalledWith('ent2', expect.objectContaining({
        bodyType: 'kinematic',
        density: 5.0,
        restitution: 0.5,
      }));
    });

    it('ignores unknown fields in physics merge', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'update_physics', {
        entityId: 'ent3',
        unknownField: 'ignored',
        bodyType: 'fixed',
      });
      expect(result.success).toBe(true);
      const calledWith = (store.updatePhysics as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(calledWith.bodyType).toBe('fixed');
      expect(calledWith).not.toHaveProperty('unknownField');
    });
  });

  // -------------------------------------------------------------------------
  // toggle_physics
  // -------------------------------------------------------------------------
  describe('toggle_physics', () => {
    it('enables physics on an entity', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'toggle_physics', {
        entityId: 'ent1',
        enabled: true,
      });
      expect(result.success).toBe(true);
      expect(store.togglePhysics).toHaveBeenCalledWith('ent1', true);
      expect((result.result as { message: string }).message).toContain('enabled');
    });

    it('disables physics on an entity', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'toggle_physics', {
        entityId: 'ent2',
        enabled: false,
      });
      expect(result.success).toBe(true);
      expect(store.togglePhysics).toHaveBeenCalledWith('ent2', false);
      expect((result.result as { message: string }).message).toContain('disabled');
    });
  });

  // -------------------------------------------------------------------------
  // toggle_debug_physics
  // -------------------------------------------------------------------------
  describe('toggle_debug_physics', () => {
    it('calls toggleDebugPhysics on store', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'toggle_debug_physics');
      expect(result.success).toBe(true);
      expect(store.toggleDebugPhysics).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // get_physics
  // -------------------------------------------------------------------------
  describe('get_physics', () => {
    it('returns null physics when not set', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'get_physics');
      expect(result.success).toBe(true);
      const data = result.result as { physics: unknown; enabled: boolean };
      expect(data.physics).toBeNull();
      expect(data.enabled).toBe(false);
    });

    it('returns physics data and enabled state when set', async () => {
      const physicsData = { bodyType: 'dynamic', restitution: 0.5 };
      const { result } = await invokeHandler(
        physicsJointHandlers,
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

  // -------------------------------------------------------------------------
  // apply_force
  // -------------------------------------------------------------------------
  describe('apply_force', () => {
    it('enables physics and returns queued message', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'apply_force', {
        entityId: 'ent1',
        force: [10, 0, 0],
      });
      expect(result.success).toBe(true);
      expect(store.togglePhysics).toHaveBeenCalledWith('ent1', true);
      expect((result.result as { message: string }).message).toContain('Play');
    });
  });

  // -------------------------------------------------------------------------
  // create_joint
  // -------------------------------------------------------------------------
  describe('create_joint', () => {
    it('returns error when entityId is missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'create_joint', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('entityId');
    });

    it('creates a revolute joint with defaults', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
        entityId: 'ent1',
        connectedEntityId: 'ent2',
      });
      expect(result.success).toBe(true);
      expect(store.createJoint).toHaveBeenCalledWith('ent1', expect.objectContaining({
        jointType: 'revolute',
        connectedEntityId: 'ent2',
        anchorSelf: [0, 0, 0],
        anchorOther: [0, 0, 0],
        axis: [0, 1, 0],
        limits: null,
        motor: null,
      }));
      expect((result.result as { message: string }).message).toContain('revolute');
    });

    it('creates a joint with specified parameters', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
        entityId: 'ent1',
        jointType: 'prismatic',
        connectedEntityId: 'ent3',
        anchorSelf: [1, 0, 0],
        anchorOther: [0, 1, 0],
        axis: [1, 0, 0],
        limits: { min: -5, max: 5 },
        motor: { targetVelocity: 2, maxForce: 100 },
      });
      expect(result.success).toBe(true);
      expect(store.createJoint).toHaveBeenCalledWith('ent1', {
        jointType: 'prismatic',
        connectedEntityId: 'ent3',
        anchorSelf: [1, 0, 0],
        anchorOther: [0, 1, 0],
        axis: [1, 0, 0],
        limits: { min: -5, max: 5 },
        motor: { targetVelocity: 2, maxForce: 100 },
      });
      expect((result.result as { message: string }).message).toContain('prismatic');
    });
  });

  // -------------------------------------------------------------------------
  // update_joint
  // -------------------------------------------------------------------------
  describe('update_joint', () => {
    it('returns error when entityId is missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'update_joint', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('entityId');
    });

    it('updates only specified joint properties', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'update_joint', {
        entityId: 'ent1',
        limits: { min: -90, max: 90 },
      });
      expect(result.success).toBe(true);
      expect(store.updateJoint).toHaveBeenCalledWith('ent1', { limits: { min: -90, max: 90 } });
      expect((result.result as { message: string }).message).toContain('ent1');
    });

    it('updates multiple joint properties at once', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'update_joint', {
        entityId: 'ent2',
        jointType: 'spherical',
        connectedEntityId: 'ent5',
        axis: [0, 0, 1],
      });
      expect(result.success).toBe(true);
      expect(store.updateJoint).toHaveBeenCalledWith('ent2', {
        jointType: 'spherical',
        connectedEntityId: 'ent5',
        axis: [0, 0, 1],
      });
    });

    it('sends empty updates when no properties given', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'update_joint', {
        entityId: 'ent3',
      });
      expect(result.success).toBe(true);
      expect(store.updateJoint).toHaveBeenCalledWith('ent3', {});
    });
  });

  // -------------------------------------------------------------------------
  // remove_joint
  // -------------------------------------------------------------------------
  describe('remove_joint', () => {
    it('returns error when entityId is missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'remove_joint', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('entityId');
    });

    it('removes joint from entity', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'remove_joint', {
        entityId: 'ent1',
      });
      expect(result.success).toBe(true);
      expect(store.removeJoint).toHaveBeenCalledWith('ent1');
      expect((result.result as { message: string }).message).toContain('ent1');
    });
  });

  // -------------------------------------------------------------------------
  // get_joint
  // -------------------------------------------------------------------------
  describe('get_joint', () => {
    it('returns null joint when none exists', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'get_joint');
      expect(result.success).toBe(true);
      const data = result.result as { joint: unknown };
      expect(data.joint).toBeNull();
    });

    it('returns joint data when present', async () => {
      const joint = { jointType: 'fixed', connectedEntityId: 'ent2' };
      const { result } = await invokeHandler(
        physicsJointHandlers,
        'get_joint',
        {},
        { primaryJoint: joint }
      );
      expect(result.success).toBe(true);
      const data = result.result as { joint: unknown };
      expect(data.joint).toEqual(joint);
    });
  });

  // -------------------------------------------------------------------------
  // CSG operations
  // -------------------------------------------------------------------------
  describe('csg_union', () => {
    it('returns error when entityIdA is missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'csg_union', { entityIdB: 'b' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('entityIdA');
    });

    it('returns error when entityIdB is missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'csg_union', { entityIdA: 'a' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('entityIdB');
    });

    it('performs union with default deleteSources=true', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'csg_union', {
        entityIdA: 'a',
        entityIdB: 'b',
      });
      expect(result.success).toBe(true);
      expect(store.csgUnion).toHaveBeenCalledWith('a', 'b', true);
    });

    it('performs union with deleteSources=false', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'csg_union', {
        entityIdA: 'a',
        entityIdB: 'b',
        deleteSources: false,
      });
      expect(result.success).toBe(true);
      expect(store.csgUnion).toHaveBeenCalledWith('a', 'b', false);
    });
  });

  describe('csg_subtract', () => {
    it('returns error when missing entity IDs', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'csg_subtract', {});
      expect(result.success).toBe(false);
    });

    it('performs subtraction', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'csg_subtract', {
        entityIdA: 'a',
        entityIdB: 'b',
        deleteSources: false,
      });
      expect(result.success).toBe(true);
      expect(store.csgSubtract).toHaveBeenCalledWith('a', 'b', false);
    });
  });

  describe('csg_intersect', () => {
    it('returns error when missing entity IDs', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'csg_intersect', {});
      expect(result.success).toBe(false);
    });

    it('performs intersection', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'csg_intersect', {
        entityIdA: 'a',
        entityIdB: 'b',
      });
      expect(result.success).toBe(true);
      expect(store.csgIntersect).toHaveBeenCalledWith('a', 'b', true);
    });
  });

  // -------------------------------------------------------------------------
  // spawn_terrain
  // -------------------------------------------------------------------------
  describe('spawn_terrain', () => {
    it('spawns terrain with default params', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'spawn_terrain', {});
      expect(result.success).toBe(true);
      expect(store.spawnTerrain).toHaveBeenCalledWith(expect.objectContaining({}));
    });

    it('spawns terrain with custom params', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'spawn_terrain', {
        noiseType: 'simplex',
        octaves: 6,
        frequency: 0.02,
        heightScale: 20,
        seed: 42,
        resolution: 128,
        size: 200,
      });
      expect(result.success).toBe(true);
      expect(store.spawnTerrain).toHaveBeenCalledWith({
        noiseType: 'simplex',
        octaves: 6,
        frequency: 0.02,
        amplitude: undefined,
        heightScale: 20,
        seed: 42,
        resolution: 128,
        size: 200,
      });
    });
  });

  // -------------------------------------------------------------------------
  // update_terrain
  // -------------------------------------------------------------------------
  describe('update_terrain', () => {
    it('returns error when entityId is missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'update_terrain', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('entityId');
    });

    it('returns error when entity is not a terrain', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'update_terrain', {
        entityId: 'notTerrain',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('terrain');
    });

    it('updates terrain parameters', async () => {
      const existingTerrain = {
        noiseType: 'perlin',
        octaves: 4,
        frequency: 0.01,
        amplitude: 1.0,
        heightScale: 10,
        seed: 42,
        resolution: 64,
        size: 100,
      };
      const { result, store } = await invokeHandler(
        physicsJointHandlers,
        'update_terrain',
        { entityId: 't1', octaves: 8, heightScale: 30 },
        { terrainData: { t1: existingTerrain } }
      );
      expect(result.success).toBe(true);
      expect(store.updateTerrain).toHaveBeenCalledWith('t1', expect.objectContaining({
        noiseType: 'perlin',
        octaves: 8,
        heightScale: 30,
        frequency: 0.01,
      }));
    });
  });

  // -------------------------------------------------------------------------
  // sculpt_terrain
  // -------------------------------------------------------------------------
  describe('sculpt_terrain', () => {
    it('returns error when required params are missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'sculpt_terrain', {
        entityId: 'ent1',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('sculpts terrain with valid params', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'sculpt_terrain', {
        entityId: 't1',
        position: [10, 20],
        radius: 5,
        strength: 0.5,
      });
      expect(result.success).toBe(true);
      expect(store.sculptTerrain).toHaveBeenCalledWith('t1', [10, 20], 5, 0.5);
    });
  });

  // -------------------------------------------------------------------------
  // get_terrain
  // -------------------------------------------------------------------------
  describe('get_terrain (physicsJointHandlers)', () => {
    it('returns error when entityId is missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'get_terrain', {});
      expect(result.success).toBe(false);
    });

    it('returns error when entity is not terrain', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'get_terrain', {
        entityId: 'nonTerrain',
      });
      expect(result.success).toBe(false);
    });

    it('returns terrain data', async () => {
      const terrainData = { noiseType: 'perlin', octaves: 4 };
      const { result } = await invokeHandler(
        physicsJointHandlers,
        'get_terrain',
        { entityId: 't1' },
        { terrainData: { t1: terrainData } }
      );
      expect(result.success).toBe(true);
      expect((result.result as { terrainData: unknown }).terrainData).toEqual(terrainData);
    });
  });

  // -------------------------------------------------------------------------
  // extrude_shape
  // -------------------------------------------------------------------------
  describe('extrude_shape', () => {
    it('returns error when shape is missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'extrude_shape', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('shape');
    });

    it('returns error for invalid shape', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'extrude_shape', {
        shape: 'triangle',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('extrudes a circle shape with options', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'extrude_shape', {
        shape: 'circle',
        radius: 2,
        length: 5,
        segments: 32,
        name: 'Cylinder',
      });
      expect(result.success).toBe(true);
      expect(store.extrudeShape).toHaveBeenCalledWith('circle', expect.objectContaining({
        radius: 2,
        length: 5,
        segments: 32,
        name: 'Cylinder',
      }));
    });

    it('extrudes a star shape', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'extrude_shape', {
        shape: 'star',
        starPoints: 5,
        innerRadius: 0.5,
      });
      expect(result.success).toBe(true);
      expect(store.extrudeShape).toHaveBeenCalledWith('star', expect.objectContaining({
        starPoints: 5,
        innerRadius: 0.5,
      }));
    });

    it.each(['circle', 'square', 'hexagon', 'star'])('accepts valid shape: %s', async (shape) => {
      const { result } = await invokeHandler(physicsJointHandlers, 'extrude_shape', { shape });
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // lathe_shape
  // -------------------------------------------------------------------------
  describe('lathe_shape', () => {
    it('returns error when profile is missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'lathe_shape', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('profile');
    });

    it('returns error when profile has fewer than 2 points', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'lathe_shape', {
        profile: [[0, 0]],
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('lathes a valid profile', async () => {
      const profile: [number, number][] = [[0, 0], [1, 0.5], [0.5, 1]];
      const { result, store } = await invokeHandler(physicsJointHandlers, 'lathe_shape', {
        profile,
        segments: 16,
        name: 'Vase',
      });
      expect(result.success).toBe(true);
      expect(store.latheShape).toHaveBeenCalledWith(profile, { segments: 16, name: 'Vase', position: undefined });
    });
  });

  // -------------------------------------------------------------------------
  // array_entity
  // -------------------------------------------------------------------------
  describe('array_entity', () => {
    it('returns error when entityId is missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'array_entity', {
        pattern: 'grid',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('entityId');
    });

    it('returns error for invalid pattern', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'array_entity', {
        entityId: 'ent1',
        pattern: 'spiral',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('pattern');
    });

    it('creates a grid array', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'array_entity', {
        entityId: 'ent1',
        pattern: 'grid',
        countX: 3,
        countY: 2,
        spacingX: 2,
        spacingY: 2,
      });
      expect(result.success).toBe(true);
      expect(store.arrayEntity).toHaveBeenCalledWith('ent1', expect.objectContaining({
        pattern: 'grid',
        countX: 3,
        countY: 2,
        spacingX: 2,
        spacingY: 2,
      }));
      expect((result.result as { message: string }).message).toContain('grid');
    });

    it('creates a circle array', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'array_entity', {
        entityId: 'ent1',
        pattern: 'circle',
        circleCount: 8,
        circleRadius: 5,
      });
      expect(result.success).toBe(true);
      expect(store.arrayEntity).toHaveBeenCalledWith('ent1', expect.objectContaining({
        pattern: 'circle',
        circleCount: 8,
        circleRadius: 5,
      }));
    });
  });

  // -------------------------------------------------------------------------
  // combine_meshes
  // -------------------------------------------------------------------------
  describe('combine_meshes', () => {
    it('returns error when entityIds is missing', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'combine_meshes', {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error when fewer than 2 entities', async () => {
      const { result } = await invokeHandler(physicsJointHandlers, 'combine_meshes', {
        entityIds: ['single'],
      });
      expect(result.success).toBe(false);
    });

    it('combines meshes', async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'combine_meshes', {
        entityIds: ['a', 'b', 'c'],
        deleteSources: false,
        name: 'Combined',
      });
      expect(result.success).toBe(true);
      expect(store.combineMeshes).toHaveBeenCalledWith(['a', 'b', 'c'], false, 'Combined');
      expect((result.result as { message: string }).message).toContain('3');
    });
  });
});

// ===========================================================================
// GAMEPLAY HANDLERS
// ===========================================================================

describe('gameplayHandlers', () => {
  // -------------------------------------------------------------------------
  // add_game_component
  // -------------------------------------------------------------------------
  describe('add_game_component', () => {
    it('returns error for unknown component type', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'ent1',
        componentType: 'nonexistent_type',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown component type');
    });

    it('adds character_controller with defaults', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'player',
        componentType: 'character_controller',
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('player', {
        type: 'characterController',
        characterController: {
          speed: 5,
          jumpHeight: 8,
          gravityScale: 1,
          canDoubleJump: false,
        },
      });
    });

    it('adds character_controller with custom props', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'player',
        componentType: 'character_controller',
        properties: { speed: 10, jumpHeight: 12, canDoubleJump: true },
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('player', {
        type: 'characterController',
        characterController: {
          speed: 10,
          jumpHeight: 12,
          gravityScale: 1,
          canDoubleJump: true,
        },
      });
    });

    it('adds health component', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'player',
        componentType: 'health',
        properties: { maxHealth: 200, invincibilitySecs: 2 },
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('player', expect.objectContaining({
        type: 'health',
        health: expect.objectContaining({
          maxHp: 200,
          currentHp: 200,
          invincibilitySecs: 2,
        }),
      }));
    });

    it('adds collectible component', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'coin',
        componentType: 'collectible',
        properties: { value: 10, rotateSpeed: 180 },
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('coin', expect.objectContaining({
        type: 'collectible',
        collectible: expect.objectContaining({ value: 10, rotateSpeed: 180 }),
      }));
    });

    it('adds damage_zone component', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'lava',
        componentType: 'damage_zone',
        properties: { damagePerSecond: 50, oneShot: true },
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('lava', expect.objectContaining({
        type: 'damageZone',
        damageZone: { damagePerSecond: 50, oneShot: true },
      }));
    });

    it('adds checkpoint component', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'cp1',
        componentType: 'checkpoint',
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('cp1', expect.objectContaining({
        type: 'checkpoint',
        checkpoint: { autoSave: true },
      }));
    });

    it('adds teleporter component', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'tp1',
        componentType: 'teleporter',
        properties: { targetPosition: [5, 0, 5], cooldownSecs: 2 },
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('tp1', expect.objectContaining({
        type: 'teleporter',
        teleporter: { targetPosition: [5, 0, 5], cooldownSecs: 2 },
      }));
    });

    it('adds moving_platform component', async () => {
      const waypoints: [number, number, number][] = [[0, 0, 0], [0, 5, 0], [5, 5, 0]];
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'plat1',
        componentType: 'moving_platform',
        properties: { speed: 3, waypoints, loopMode: 'loop' },
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('plat1', expect.objectContaining({
        type: 'movingPlatform',
        movingPlatform: expect.objectContaining({ speed: 3, waypoints, loopMode: 'loop' }),
      }));
    });

    it('adds trigger_zone component', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'zone1',
        componentType: 'trigger_zone',
        properties: { eventName: 'door_open', oneShot: true },
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('zone1', expect.objectContaining({
        type: 'triggerZone',
        triggerZone: { eventName: 'door_open', oneShot: true },
      }));
    });

    it('adds spawner component', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'sp1',
        componentType: 'spawner',
        properties: { entityType: 'sphere', intervalSecs: 1, maxCount: 10 },
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('sp1', expect.objectContaining({
        type: 'spawner',
        spawner: expect.objectContaining({ entityType: 'sphere', intervalSecs: 1, maxCount: 10 }),
      }));
    });

    it('adds follower component', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'enemy1',
        componentType: 'follower',
        properties: { targetEntityId: 'player', speed: 5, stopDistance: 2 },
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('enemy1', expect.objectContaining({
        type: 'follower',
        follower: expect.objectContaining({ targetEntityId: 'player', speed: 5, stopDistance: 2 }),
      }));
    });

    it('adds projectile component', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'bullet',
        componentType: 'projectile',
        properties: { speed: 30, damage: 20, gravity: true },
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('bullet', expect.objectContaining({
        type: 'projectile',
        projectile: expect.objectContaining({ speed: 30, damage: 20, gravity: true }),
      }));
    });

    it('adds win_condition component', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'goal',
        componentType: 'win_condition',
        properties: { conditionType: 'reach_goal', targetEntityId: 'flag' },
      });
      expect(result.success).toBe(true);
      expect(store.addGameComponent).toHaveBeenCalledWith('goal', expect.objectContaining({
        type: 'winCondition',
        winCondition: expect.objectContaining({ conditionType: 'reach_goal', targetEntityId: 'flag' }),
      }));
    });
  });

  // -------------------------------------------------------------------------
  // update_game_component
  // -------------------------------------------------------------------------
  describe('update_game_component', () => {
    it('returns error for unknown component type', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'update_game_component', {
        entityId: 'ent1',
        componentType: 'bad_type',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown component type');
    });

    it('updates health component', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'update_game_component', {
        entityId: 'player',
        componentType: 'health',
        properties: { maxHp: 50, currentHp: 25 },
      });
      expect(result.success).toBe(true);
      expect(store.updateGameComponent).toHaveBeenCalledWith('player', expect.objectContaining({
        type: 'health',
        health: expect.objectContaining({ maxHp: 50, currentHp: 25 }),
      }));
    });
  });

  // -------------------------------------------------------------------------
  // remove_game_component
  // -------------------------------------------------------------------------
  describe('remove_game_component', () => {
    it('removes component by name', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'remove_game_component', {
        entityId: 'ent1',
        componentName: 'health',
      });
      expect(result.success).toBe(true);
      expect(store.removeGameComponent).toHaveBeenCalledWith('ent1', 'health');
    });
  });

  // -------------------------------------------------------------------------
  // get_game_components
  // -------------------------------------------------------------------------
  describe('get_game_components', () => {
    it('returns empty array when entity has no components', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'get_game_components', {
        entityId: 'ent1',
      });
      expect(result.success).toBe(true);
      const data = result.result as { components: unknown[]; count: number };
      expect(data.components).toEqual([]);
      expect(data.count).toBe(0);
    });

    it('returns components and count for entity', async () => {
      const components = [
        { type: 'health', health: { maxHp: 100 } },
        { type: 'collectible', collectible: { value: 5 } },
      ];
      const { result } = await invokeHandler(
        gameplayHandlers,
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

  // -------------------------------------------------------------------------
  // list_game_component_types
  // -------------------------------------------------------------------------
  describe('list_game_component_types', () => {
    it('returns all 12 component types', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'list_game_component_types');
      expect(result.success).toBe(true);
      const data = result.result as { types: { name: string; description: string }[] };
      expect(data.types).toHaveLength(12);
    });

    it('includes expected component type names', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'list_game_component_types');
      const data = result.result as { types: { name: string }[] };
      const names = data.types.map(t => t.name);
      expect(names).toContain('character_controller');
      expect(names).toContain('health');
      expect(names).toContain('collectible');
      expect(names).toContain('damage_zone');
      expect(names).toContain('checkpoint');
      expect(names).toContain('teleporter');
      expect(names).toContain('moving_platform');
      expect(names).toContain('trigger_zone');
      expect(names).toContain('spawner');
      expect(names).toContain('follower');
      expect(names).toContain('projectile');
      expect(names).toContain('win_condition');
    });

    it('every type has name and description strings', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'list_game_component_types');
      const data = result.result as { types: { name: string; description: string }[] };
      for (const t of data.types) {
        expect(typeof t.name).toBe('string');
        expect(typeof t.description).toBe('string');
        expect(t.description.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // set_game_camera
  // -------------------------------------------------------------------------
  describe('set_game_camera', () => {
    it('sets game camera with mode and target', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
        entityId: 'cam1',
        mode: 'thirdPersonFollow',
        targetEntity: 'player',
        followDistance: 8,
        followHeight: 3,
      });
      expect(result.success).toBe(true);
      expect(store.setGameCamera).toHaveBeenCalledWith('cam1', expect.objectContaining({
        mode: 'thirdPersonFollow',
        targetEntity: 'player',
        followDistance: 8,
        followHeight: 3,
      }));
      expect((result.result as { message: string }).message).toContain('thirdPersonFollow');
    });

    it('sets camera with no target entity', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
        entityId: 'cam2',
        mode: 'fixed',
      });
      expect(result.success).toBe(true);
      expect(store.setGameCamera).toHaveBeenCalledWith('cam2', expect.objectContaining({
        mode: 'fixed',
        targetEntity: null,
      }));
    });
  });

  // -------------------------------------------------------------------------
  // set_active_game_camera
  // -------------------------------------------------------------------------
  describe('set_active_game_camera', () => {
    it('sets the active game camera', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'set_active_game_camera', {
        entityId: 'cam1',
      });
      expect(result.success).toBe(true);
      expect(store.setActiveGameCamera).toHaveBeenCalledWith('cam1');
      expect((result.result as { message: string }).message).toContain('cam1');
    });
  });

  // -------------------------------------------------------------------------
  // camera_shake
  // -------------------------------------------------------------------------
  describe('camera_shake', () => {
    it('triggers camera shake', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'camera_shake', {
        entityId: 'cam1',
        intensity: 0.5,
        duration: 0.3,
      });
      expect(result.success).toBe(true);
      expect(store.cameraShake).toHaveBeenCalledWith('cam1', 0.5, 0.3);
      expect((result.result as { message: string }).message).toContain('0.5');
      expect((result.result as { message: string }).message).toContain('0.3');
    });
  });

  // -------------------------------------------------------------------------
  // get_game_camera
  // -------------------------------------------------------------------------
  describe('get_game_camera', () => {
    it('returns null camera and isActive false when entity has no camera', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'get_game_camera', {
        entityId: 'nocam',
      });
      expect(result.success).toBe(true);
      const data = result.result as { camera: unknown; isActive: boolean };
      expect(data.camera).toBeNull();
      expect(data.isActive).toBe(false);
    });

    it('returns camera data and isActive true when active', async () => {
      const cameraData = { mode: 'sideScroller', targetEntity: 'player' };
      const { result } = await invokeHandler(
        gameplayHandlers,
        'get_game_camera',
        { entityId: 'cam1' },
        { allGameCameras: { cam1: cameraData }, activeGameCameraId: 'cam1' }
      );
      expect(result.success).toBe(true);
      const data = result.result as { camera: unknown; isActive: boolean };
      expect(data.camera).toEqual(cameraData);
      expect(data.isActive).toBe(true);
    });

    it('returns isActive false when entity has camera but is not active', async () => {
      const cameraData = { mode: 'orbital', targetEntity: null };
      const { result } = await invokeHandler(
        gameplayHandlers,
        'get_game_camera',
        { entityId: 'cam1' },
        { allGameCameras: { cam1: cameraData }, activeGameCameraId: 'cam2' }
      );
      expect(result.success).toBe(true);
      const data = result.result as { isActive: boolean };
      expect(data.isActive).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // save_as_prefab
  // -------------------------------------------------------------------------
  describe('save_as_prefab', () => {
    it('saves entity as prefab with name and category', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'save_as_prefab', {
        entityId: 'ent1',
        name: 'MyPrefab',
        category: 'custom',
        description: 'A test prefab',
      });
      expect(result.success).toBe(true);
      const data = result.result as { prefabId: string; message: string };
      expect(data.prefabId).toBe('prefab-1');
      expect(data.message).toContain('MyPrefab');
    });
  });

  // -------------------------------------------------------------------------
  // instantiate_prefab
  // -------------------------------------------------------------------------
  describe('instantiate_prefab', () => {
    it('returns error when prefab is not found', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'instantiate_prefab', {
        prefabId: 'nonexistent',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('instantiates an existing prefab', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'instantiate_prefab', {
        prefabId: 'prefab-1',
      });
      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'TestPrefab');
      expect((result.result as { message: string }).message).toContain('TestPrefab');
    });

    it('uses custom name when provided', async () => {
      const { result, store } = await invokeHandler(gameplayHandlers, 'instantiate_prefab', {
        prefabId: 'prefab-1',
        name: 'CustomName',
      });
      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'CustomName');
    });
  });

  // -------------------------------------------------------------------------
  // list_prefabs
  // -------------------------------------------------------------------------
  describe('list_prefabs', () => {
    it('lists all prefabs when no category given', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'list_prefabs', {});
      expect(result.success).toBe(true);
      const data = result.result as { prefabs: { id: string }[] };
      expect(data.prefabs).toHaveLength(2);
    });

    it('filters by category', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'list_prefabs', {
        category: 'cat',
      });
      expect(result.success).toBe(true);
      const data = result.result as { prefabs: { id: string }[] };
      expect(data.prefabs).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // delete_prefab
  // -------------------------------------------------------------------------
  describe('delete_prefab', () => {
    it('deletes existing prefab', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'delete_prefab', {
        prefabId: 'prefab-1',
      });
      expect(result.success).toBe(true);
    });

    it('returns error for non-existent prefab', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'delete_prefab', {
        prefabId: 'nonexistent',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // -------------------------------------------------------------------------
  // get_prefab
  // -------------------------------------------------------------------------
  describe('get_prefab', () => {
    it('returns prefab data for existing prefab', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'get_prefab', {
        prefabId: 'prefab-1',
      });
      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty('id', 'prefab-1');
    });

    it('returns error for non-existent prefab', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'get_prefab', {
        prefabId: 'missing',
      });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // get_export_status
  // -------------------------------------------------------------------------
  describe('get_export_status', () => {
    it('returns default export status', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'get_export_status');
      expect(result.success).toBe(true);
      const data = result.result as { isExporting: boolean; engineMode: string };
      expect(data.isExporting).toBe(false);
      expect(data.engineMode).toBe('edit');
    });

    it('returns exporting true when in progress', async () => {
      const { result } = await invokeHandler(
        gameplayHandlers,
        'get_export_status',
        {},
        { isExporting: true, engineMode: 'play' }
      );
      expect(result.success).toBe(true);
      const data = result.result as { isExporting: boolean; engineMode: string };
      expect(data.isExporting).toBe(true);
      expect(data.engineMode).toBe('play');
    });
  });

  // -------------------------------------------------------------------------
  // list_material_presets
  // -------------------------------------------------------------------------
  describe('list_material_presets', () => {
    it('returns all presets when no category given', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'list_material_presets', {});
      expect(result.success).toBe(true);
      const data = result.result as { id: string; name: string }[];
      expect(data).toHaveLength(2);
      expect(data[0].name).toBe('Red Metal');
    });

    it('returns filtered presets by category', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'list_material_presets', {
        category: 'metal',
      });
      expect(result.success).toBe(true);
      const data = result.result as { id: string; name: string }[];
      expect(data).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // save_material_to_library
  // -------------------------------------------------------------------------
  describe('save_material_to_library', () => {
    it('returns error when name is missing', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'save_material_to_library', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('returns error when no entity is selected', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'save_material_to_library', {
        name: 'TestMat',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No entity selected');
    });

    it('returns error when entity has no material', async () => {
      const { result } = await invokeHandler(
        gameplayHandlers,
        'save_material_to_library',
        { name: 'TestMat', entityId: 'ent1' },
        { primaryId: 'ent1', primaryMaterial: null }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('no material');
    });

    it('saves material to library', async () => {
      const material = { baseColor: [1, 0, 0, 1], metallic: 0.5 };
      const { result } = await invokeHandler(
        gameplayHandlers,
        'save_material_to_library',
        { name: 'RedMat' },
        { primaryId: 'ent1', primaryMaterial: material }
      );
      expect(result.success).toBe(true);
      const data = result.result as { id: string; name: string };
      expect(data.id).toBe('custom-1');
      expect(data.name).toBe('MyMat');
    });
  });

  // -------------------------------------------------------------------------
  // delete_library_material
  // -------------------------------------------------------------------------
  describe('delete_library_material', () => {
    it('returns error when materialId is missing', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'delete_library_material', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('materialId');
    });

    it('deletes custom material', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'delete_library_material', {
        materialId: 'custom-1',
      });
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // list_custom_materials
  // -------------------------------------------------------------------------
  describe('list_custom_materials', () => {
    it('returns custom materials list', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'list_custom_materials', {});
      expect(result.success).toBe(true);
      const data = result.result as { id: string; name: string }[];
      expect(data).toHaveLength(2);
      expect(data[0].name).toBe('MyMat');
    });
  });
});
