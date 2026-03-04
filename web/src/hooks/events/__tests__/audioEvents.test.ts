// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions, type StoreState } from './eventTestUtils';

// Mock the editor store module
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

// Mock the audio manager (used by AUDIO_BUSES_CHANGED and AUDIO_PLAYBACK)
vi.mock('@/lib/audio/audioManager', () => ({
  audioManager: {
    applyBusConfig: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { handleAudioEvent } from '../audioEvents';

describe('handleAudioEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    vi.clearAllMocks();
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as unknown as StoreState);
  });

  it('returns false for unknown event types', () => {
    const result = handleAudioEvent(
      'UNKNOWN_EVENT',
      {},
      mockSetGet.set,
      mockSetGet.get
    );
    expect(result).toBe(false);
  });

  describe('SCRIPT_CHANGED', () => {
    it('calls setEntityScript with entityId and script data', () => {
      const payload = {
        entityId: 'entity-1',
        source: 'forge.log("hello");',
        enabled: true,
        template: 'basic',
      };

      const result = handleAudioEvent(
        'SCRIPT_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityScript).toHaveBeenCalledWith('entity-1', {
        source: 'forge.log("hello");',
        enabled: true,
        template: 'basic',
      });
    });

    it('handles null template', () => {
      const payload = {
        entityId: 'entity-2',
        source: '// custom script',
        enabled: false,
        template: null,
      };

      const result = handleAudioEvent(
        'SCRIPT_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityScript).toHaveBeenCalledWith('entity-2', {
        source: '// custom script',
        enabled: false,
        template: null,
      });
    });
  });

  describe('AUDIO_CHANGED', () => {
    it('constructs audio data with defaults and calls setEntityAudio', () => {
      const payload = {
        entityId: 'entity-audio-1',
        assetId: 'sound-asset-1',
        volume: 0.8,
        pitch: 1.2,
        loopAudio: true,
        spatial: true,
        maxDistance: 100,
        refDistance: 2,
        rolloffFactor: 1.5,
        autoplay: true,
        bus: 'music',
      };

      const result = handleAudioEvent(
        'AUDIO_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityAudio).toHaveBeenCalledWith('entity-audio-1', {
        assetId: 'sound-asset-1',
        volume: 0.8,
        pitch: 1.2,
        loopAudio: true,
        spatial: true,
        maxDistance: 100,
        refDistance: 2,
        rolloffFactor: 1.5,
        autoplay: true,
        bus: 'music',
      });
    });

    it('fills in defaults for missing optional fields', () => {
      const payload = {
        entityId: 'entity-audio-2',
        assetId: 'sound-asset-2',
      };

      const result = handleAudioEvent(
        'AUDIO_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityAudio).toHaveBeenCalledWith('entity-audio-2', {
        assetId: 'sound-asset-2',
        volume: 1.0,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        autoplay: false,
        bus: 'sfx',
      });
    });

    it('handles null assetId (audio exists but no asset assigned)', () => {
      const payload = {
        entityId: 'entity-audio-3',
        assetId: null,
      };

      const result = handleAudioEvent(
        'AUDIO_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityAudio).toHaveBeenCalledWith('entity-audio-3', {
        assetId: null,
        volume: 1.0,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        autoplay: false,
        bus: 'sfx',
      });
    });

    it('clears audio when assetId is undefined (no audio data)', () => {
      const payload = {
        entityId: 'entity-audio-4',
        // assetId intentionally omitted
      };

      const result = handleAudioEvent(
        'AUDIO_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityAudio).toHaveBeenCalledWith('entity-audio-4', null);
    });
  });

  describe('REVERB_ZONE_CHANGED', () => {
    it('handles sphere shape reverb zone', () => {
      const payload = {
        entityId: 'reverb-1',
        enabled: true,
        shape: { type: 'sphere' as const, radius: 10 },
        preset: 'large_hall',
        wetMix: 0.6,
        decayTime: 2.5,
        preDelay: 0.02,
        blendRadius: 3,
        priority: 5,
      };

      const result = handleAudioEvent(
        'REVERB_ZONE_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setReverbZone).toHaveBeenCalledWith(
        'reverb-1',
        {
          shape: { type: 'sphere', radius: 10 },
          preset: 'large_hall',
          wetMix: 0.6,
          decayTime: 2.5,
          preDelay: 0.02,
          blendRadius: 3,
          priority: 5,
        },
        true
      );
    });

    it('handles box shape reverb zone', () => {
      const payload = {
        entityId: 'reverb-2',
        enabled: false,
        shape: { type: 'box' as const, size: [20, 10, 15] },
        preset: 'small_room',
        wetMix: 0.3,
        decayTime: 0.8,
        preDelay: 0.01,
        blendRadius: 1,
        priority: 2,
      };

      const result = handleAudioEvent(
        'REVERB_ZONE_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setReverbZone).toHaveBeenCalledWith(
        'reverb-2',
        {
          shape: { type: 'box', size: [20, 10, 15] },
          preset: 'small_room',
          wetMix: 0.3,
          decayTime: 0.8,
          preDelay: 0.01,
          blendRadius: 1,
          priority: 2,
        },
        false
      );
    });

    it('defaults sphere radius to 5 when not provided', () => {
      const payload = {
        entityId: 'reverb-3',
        enabled: true,
        shape: { type: 'sphere' as const },
        preset: 'outdoor',
        wetMix: 0.2,
        decayTime: 1.0,
        preDelay: 0.0,
        blendRadius: 2,
        priority: 1,
      };

      const result = handleAudioEvent(
        'REVERB_ZONE_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setReverbZone).toHaveBeenCalledWith(
        'reverb-3',
        expect.objectContaining({
          shape: { type: 'sphere', radius: 5 },
        }),
        true
      );
    });

    it('defaults box size to [10,5,10] when not provided', () => {
      const payload = {
        entityId: 'reverb-4',
        enabled: true,
        shape: { type: 'box' as const },
        preset: 'cave',
        wetMix: 0.9,
        decayTime: 4.0,
        preDelay: 0.05,
        blendRadius: 5,
        priority: 10,
      };

      const result = handleAudioEvent(
        'REVERB_ZONE_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setReverbZone).toHaveBeenCalledWith(
        'reverb-4',
        expect.objectContaining({
          shape: { type: 'box', size: [10, 5, 10] },
        }),
        true
      );
    });
  });

  describe('REVERB_ZONE_REMOVED', () => {
    it('calls removeReverbZone with entityId', () => {
      const payload = { entityId: 'reverb-5' };

      const result = handleAudioEvent(
        'REVERB_ZONE_REMOVED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.removeReverbZone).toHaveBeenCalledWith('reverb-5');
    });
  });

  describe('AUDIO_BUSES_CHANGED', () => {
    it('calls setAudioBuses with buses array', () => {
      const payload = {
        buses: [
          { name: 'master', volume: 1.0, mute: false },
          { name: 'sfx', volume: 0.8, mute: false },
          { name: 'music', volume: 0.5, mute: true },
        ],
      };

      const result = handleAudioEvent(
        'AUDIO_BUSES_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setAudioBuses).toHaveBeenCalledWith(payload.buses);
    });
  });

  describe('AUDIO_PLAYBACK', () => {
    it('returns true for play action', () => {
      const payload = { entityId: 'entity-1', action: 'play' };

      const result = handleAudioEvent(
        'AUDIO_PLAYBACK',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
    });

    it('returns true for stop action', () => {
      const payload = { entityId: 'entity-1', action: 'stop' };

      const result = handleAudioEvent(
        'AUDIO_PLAYBACK',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
    });

    it('returns true for pause action', () => {
      const payload = { entityId: 'entity-1', action: 'pause' };

      const result = handleAudioEvent(
        'AUDIO_PLAYBACK',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
    });

    it('returns true for resume action', () => {
      const payload = { entityId: 'entity-1', action: 'resume' };

      const result = handleAudioEvent(
        'AUDIO_PLAYBACK',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
    });
  });

  describe('INPUT_BINDINGS_CHANGED', () => {
    it('converts Rust InputMap format to InputBinding array and calls setInputBindings', () => {
      const payload = {
        actions: {
          move_forward: {
            name: 'move_forward',
            actionType: { type: 'Digital' },
            sources: [{ type: 'Key', value: 'KeyW' }],
            deadZone: 0.1,
          },
          jump: {
            name: 'jump',
            actionType: { type: 'Digital' },
            sources: [{ type: 'Key', value: 'Space' }],
            deadZone: 0.0,
          },
        },
        preset: 'fps',
      };

      const result = handleAudioEvent(
        'INPUT_BINDINGS_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setInputBindings).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            actionName: 'move_forward',
            actionType: 'digital',
            sources: ['KeyW'],
            deadZone: 0.1,
          }),
          expect.objectContaining({
            actionName: 'jump',
            actionType: 'digital',
            sources: ['Space'],
            deadZone: 0.0,
          }),
        ]),
        'fps'
      );
    });

    it('handles axis type with positive and negative keys', () => {
      const payload = {
        actions: {
          move_horizontal: {
            name: 'move_horizontal',
            actionType: {
              type: 'Axis',
              positive: [{ type: 'Key', value: 'KeyD' }],
              negative: [{ type: 'Key', value: 'KeyA' }],
            },
            sources: [],
            deadZone: 0.15,
          },
        },
        preset: null,
      };

      const result = handleAudioEvent(
        'INPUT_BINDINGS_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setInputBindings).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            actionName: 'move_horizontal',
            actionType: 'axis',
            positiveKeys: ['KeyD'],
            negativeKeys: ['KeyA'],
            deadZone: 0.15,
          }),
        ],
        null
      );
    });
  });

  describe('ASSET_IMPORTED', () => {
    it('calls addAssetToRegistry with constructed asset metadata', () => {
      const payload = {
        assetId: 'asset-123',
        name: 'tree.glb',
        kind: 'gltf_model',
        fileSize: 1024000,
      };

      const result = handleAudioEvent(
        'ASSET_IMPORTED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.addAssetToRegistry).toHaveBeenCalledWith({
        id: 'asset-123',
        name: 'tree.glb',
        kind: 'gltf_model',
        fileSize: 1024000,
        source: { type: 'upload', filename: 'tree.glb' },
      });
    });

    it('handles texture asset type', () => {
      const payload = {
        assetId: 'tex-456',
        name: 'brick_diffuse.png',
        kind: 'texture',
        fileSize: 512000,
      };

      const result = handleAudioEvent(
        'ASSET_IMPORTED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.addAssetToRegistry).toHaveBeenCalledWith({
        id: 'tex-456',
        name: 'brick_diffuse.png',
        kind: 'texture',
        fileSize: 512000,
        source: { type: 'upload', filename: 'brick_diffuse.png' },
      });
    });
  });

  describe('ASSET_DELETED', () => {
    it('calls removeAssetFromRegistry with assetId', () => {
      const payload = { assetId: 'asset-789' };

      const result = handleAudioEvent(
        'ASSET_DELETED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.removeAssetFromRegistry).toHaveBeenCalledWith('asset-789');
    });
  });

  describe('ASSET_LIST', () => {
    it('calls setAssetRegistry with assets record', () => {
      const assets = {
        'asset-1': { id: 'asset-1', name: 'model.glb', kind: 'gltf_model', fileSize: 500, source: { type: 'upload', filename: 'model.glb' } },
        'asset-2': { id: 'asset-2', name: 'tex.png', kind: 'texture', fileSize: 200, source: { type: 'upload', filename: 'tex.png' } },
      };
      const payload = { assets };

      const result = handleAudioEvent(
        'ASSET_LIST',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setAssetRegistry).toHaveBeenCalledWith(assets);
    });
  });
});
