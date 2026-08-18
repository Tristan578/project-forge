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

// Mock the Web Audio graph — these tests cover what the event writes to the
// store, and the graph has its own suite.
vi.mock('@/lib/audio/entityAudioGraph', () => ({
  syncEntityAudioInstance: vi.fn(),
  ingestImportedAudioAsset: vi.fn(),
  forgetImportedAudioAsset: vi.fn(),
}));

import { useEditorStore } from '@/stores/editorStore';
import {
  syncEntityAudioInstance,
  ingestImportedAudioAsset,
  forgetImportedAudioAsset,
} from '@/lib/audio/entityAudioGraph';
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

  // Every payload below is the shape `engine/src/bridge/events.rs` actually
  // emits: `ScriptPayload { entity_id, script }` and `AudioPayload { entity_id,
  // audio }`, neither of which carries `#[serde(flatten)]`, so the component
  // arrives NESTED under its own key. These tests used to send the fields flat
  // and passed against a handler that read them flat — two halves of the same
  // wrong assumption, agreeing with each other while production wrote an empty
  // component for every field. Assertions are `toEqual` on the full object
  // rather than `objectContaining`, because the payload IS the behaviour here:
  // `objectContaining` is blind to an invented field sitting alongside.
  describe('SCRIPT_CHANGED', () => {
    it('records the nested script under the entity the engine named', () => {
      const result = handleAudioEvent(
        'SCRIPT_CHANGED',
        {
          entityId: 'entity-1',
          script: { source: 'forge.log("hello");', enabled: true, template: 'basic' },
        },
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
      const result = handleAudioEvent(
        'SCRIPT_CHANGED',
        {
          entityId: 'entity-2',
          script: { source: '// custom script', enabled: false, template: null },
        },
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

    it('fills defaults for a partially-populated script', () => {
      handleAudioEvent(
        'SCRIPT_CHANGED',
        { entityId: 'entity-3', script: { source: 'x' } },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(actions.setEntityScript).toHaveBeenCalledWith('entity-3', {
        source: 'x',
        enabled: false,
        template: null,
      });
    });

    it('clears the script when the engine omits the component', () => {
      // The engine omits the key entirely rather than sending an empty object,
      // which is how a removed script reaches JS.
      handleAudioEvent('SCRIPT_CHANGED', { entityId: 'entity-4' }, mockSetGet.set, mockSetGet.get);

      expect(actions.setEntityScript).toHaveBeenCalledWith('entity-4', null);
    });

    it('keeps each entity under its own key', () => {
      handleAudioEvent(
        'SCRIPT_CHANGED',
        { entityId: 'ent-a', script: { source: 'a' } },
        mockSetGet.set,
        mockSetGet.get
      );
      handleAudioEvent(
        'SCRIPT_CHANGED',
        { entityId: 'ent-b', script: { source: 'b' } },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(actions.setEntityScript).toHaveBeenNthCalledWith(1, 'ent-a', { source: 'a', enabled: false, template: null });
      expect(actions.setEntityScript).toHaveBeenNthCalledWith(2, 'ent-b', { source: 'b', enabled: false, template: null });
    });
  });

  describe('AUDIO_CHANGED', () => {
    /** Every field the handler defaults, for entities that supply none of them. */
    const DEFAULTS = {
      volume: 1.0,
      pitch: 1.0,
      loopAudio: false,
      spatial: false,
      maxDistance: 50,
      refDistance: 1,
      rolloffFactor: 1,
      autoplay: false,
      bus: 'sfx',
    };

    it('records the nested component and rebuilds the graph for that entity', () => {
      const audio = {
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
        { entityId: 'entity-audio-1', audio },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityAudio).toHaveBeenCalledWith('entity-audio-1', audio);
      // The engine emits this for whichever entity changed, so the Web Audio
      // node is rebuilt for that entity rather than for the selected one.
      expect(vi.mocked(syncEntityAudioInstance)).toHaveBeenCalledWith('entity-audio-1', audio);
    });

    it('fills in defaults for missing optional fields', () => {
      const result = handleAudioEvent(
        'AUDIO_CHANGED',
        { entityId: 'entity-audio-2', audio: { assetId: 'sound-asset-2' } },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityAudio).toHaveBeenCalledWith('entity-audio-2', {
        assetId: 'sound-asset-2',
        ...DEFAULTS,
      });
    });

    it('handles a component with no asset assigned yet', () => {
      const result = handleAudioEvent(
        'AUDIO_CHANGED',
        { entityId: 'entity-audio-3', audio: { assetId: null } },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityAudio).toHaveBeenCalledWith('entity-audio-3', {
        assetId: null,
        ...DEFAULTS,
      });
    });

    it('clears audio when the engine omits the component', () => {
      const result = handleAudioEvent(
        'AUDIO_CHANGED',
        { entityId: 'entity-audio-4' },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityAudio).toHaveBeenCalledWith('entity-audio-4', null);
      expect(vi.mocked(syncEntityAudioInstance)).toHaveBeenCalledWith('entity-audio-4', null);
    });

    it('does not read the fields flat off the payload', () => {
      // The regression this whole describe exists for. A flat payload carries no
      // `audio` key, so the only correct reading of it is "no component" — if
      // the handler ever goes back to reading flat, this stores a populated
      // component instead of `null` and the test fails.
      handleAudioEvent(
        'AUDIO_CHANGED',
        { entityId: 'entity-audio-5', assetId: 'flat-asset', volume: 0.25 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(actions.setEntityAudio).toHaveBeenCalledWith('entity-audio-5', null);
    });

    it('keeps each entity under its own key', () => {
      // A single stored component meant the second event overwrote the first,
      // so a scene with two sound sources kept only the latest.
      handleAudioEvent('AUDIO_CHANGED', { entityId: 'ent-a', audio: { assetId: 'a' } }, mockSetGet.set, mockSetGet.get);
      handleAudioEvent('AUDIO_CHANGED', { entityId: 'ent-b', audio: { assetId: 'b' } }, mockSetGet.set, mockSetGet.get);

      expect(actions.setEntityAudio).toHaveBeenNthCalledWith(1, 'ent-a', { assetId: 'a', ...DEFAULTS });
      expect(actions.setEntityAudio).toHaveBeenNthCalledWith(2, 'ent-b', { assetId: 'b', ...DEFAULTS });
    });
  });

  describe('REVERB_ZONE_CHANGED', () => {
    it('routes to the state-only action, never the dispatching one', () => {
      // `setReverbZone` sends `set_reverb_zone` + `toggle_reverb_zone` at the
      // engine, and this handler runs *because* the engine just applied a
      // command — so routing there is an unbounded ping-pong that also floods
      // the history stack with one entry per frame.
      handleAudioEvent(
        'REVERB_ZONE_CHANGED',
        {
          entityId: 'reverb-0',
          enabled: true,
          shape: { type: 'sphere' as const, radius: 4 },
          preset: 'cave',
          wetMix: 0.9,
          decayTime: 4,
          preDelay: 0.05,
          blendRadius: 2,
          priority: 0,
        },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(actions.applyReverbZoneFromEngine).toHaveBeenCalledTimes(1);
      expect(actions.setReverbZone).not.toHaveBeenCalled();
      expect(actions.updateReverbZone).not.toHaveBeenCalled();
    });

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
      expect(actions.applyReverbZoneFromEngine).toHaveBeenCalledWith(
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
      expect(actions.applyReverbZoneFromEngine).toHaveBeenCalledWith(
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
      expect(actions.applyReverbZoneFromEngine).toHaveBeenCalledWith(
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
      expect(actions.applyReverbZoneFromEngine).toHaveBeenCalledWith(
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
      expect(actions.applyReverbZoneRemovedFromEngine).toHaveBeenCalledWith('reverb-5');
      expect(actions.removeReverbZone).not.toHaveBeenCalled();
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

    it('hands an audio import to the graph with the id the engine minted', () => {
      // This event is the ONLY moment JS learns that id — the engine drops the
      // bytes and mints its own uuid — so the ingest call is the whole seam
      // between an imported clip and a clip that can be played.
      handleAudioEvent(
        'ASSET_IMPORTED',
        { assetId: 'audio-1', name: 'jump.wav', kind: 'audio', fileSize: 0 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(vi.mocked(ingestImportedAudioAsset)).toHaveBeenCalledWith(
        'audio-1',
        'jump.wav',
        expect.any(Function)
      );
      // A getter, not a store import: a value-import of `@/stores/` from `lib/`
      // is the module edge that broke `next build` in PF-1118.
      const getter = vi.mocked(ingestImportedAudioAsset).mock.calls[0]![2];
      actions.entityAudio = { 'ent-1': { assetId: 'audio-1' } };
      expect(getter()).toEqual({ 'ent-1': { assetId: 'audio-1' } });
    });

    it('does not touch the audio graph for a non-audio import', () => {
      handleAudioEvent(
        'ASSET_IMPORTED',
        { assetId: 'tex-1', name: 'brick.png', kind: 'texture', fileSize: 1 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(vi.mocked(ingestImportedAudioAsset)).not.toHaveBeenCalled();
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

    it('drops the name alias so a reused name cannot resolve to a dead asset', () => {
      handleAudioEvent('ASSET_DELETED', { assetId: 'asset-789' }, mockSetGet.set, mockSetGet.get);

      expect(vi.mocked(forgetImportedAudioAsset)).toHaveBeenCalledWith('asset-789');
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
