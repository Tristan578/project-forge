// @vitest-environment jsdom
/**
 * Tests for audioEntityHandlers — core entity audio, bus management,
 * layering, transitions, reverb zones, and ducking rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});
import { createMockStore } from './handlerTestUtils';
import { audioEntityHandlers } from '../audioEntityHandlers';

// ---------------------------------------------------------------------------
// Mock audioManager for set_music_stems (dynamic import inside handler)
// ---------------------------------------------------------------------------
vi.mock('@/lib/audio/audioManager', () => ({
  audioManager: {
    setAdaptiveMusic: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helper: invoke with extra store methods that audioEntityHandlers use
// ---------------------------------------------------------------------------
function makeAudioStore(overrides: Record<string, unknown> = {}) {
  return {
    setAudio: vi.fn(),
    removeAudio: vi.fn(),
    playAudio: vi.fn(),
    stopAudio: vi.fn(),
    pauseAudio: vi.fn(),
    primaryAudio: null,
    audioBuses: [] as unknown[],
    updateAudioBus: vi.fn(),
    createAudioBus: vi.fn(),
    deleteAudioBus: vi.fn(),
    setBusEffects: vi.fn(),
    crossfadeAudio: vi.fn(),
    fadeInAudio: vi.fn(),
    fadeOutAudio: vi.fn(),
    playOneShotAudio: vi.fn(),
    addAudioLayer: vi.fn(),
    removeAudioLayer: vi.fn(),
    setDuckingRule: vi.fn(),
    reverbZones: {} as Record<string, Record<string, unknown>>,
    updateReverbZone: vi.fn(),
    removeReverbZone: vi.fn(),
    ...overrides,
  };
}

async function invoke(
  name: string,
  args: Record<string, unknown> = {},
  storeOverrides: Record<string, unknown> = {},
) {
  const store = createMockStore({ ...makeAudioStore(), ...storeOverrides });
  const result = await audioEntityHandlers[name](args, {
    store,
    dispatchCommand: vi.fn(),
  });
  return { result, store };
}

// ===========================================================================
// set_audio
// ===========================================================================
describe('audioEntityHandlers', () => {
  describe('set_audio', () => {
    it('calls setAudio with entityId and audio data', async () => {
      const { result, store } = await invoke('set_audio', {
        entityId: 'ent-1',
        volume: 0.8,
        pitch: 1.2,
        loopAudio: true,
        spatial: true,
      });
      expect(result.success).toBe(true);
      expect(store.setAudio).toHaveBeenCalledWith('ent-1', {
        volume: 0.8,
        pitch: 1.2,
        loopAudio: true,
        spatial: true,
      });
    });

    it('works with only entityId (no optional fields)', async () => {
      const { result, store } = await invoke('set_audio', { entityId: 'ent-2' });
      expect(result.success).toBe(true);
      expect(store.setAudio).toHaveBeenCalledWith('ent-2', {});
    });

    it('fails without entityId', async () => {
      const { result } = await invoke('set_audio', {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('includes assetId when provided', async () => {
      const { result, store } = await invoke('set_audio', {
        entityId: 'ent-1',
        assetId: 'sound-footstep',
      });
      expect(result.success).toBe(true);
      expect(store.setAudio).toHaveBeenCalledWith('ent-1', { assetId: 'sound-footstep' });
    });

    it('includes spatial parameters', async () => {
      const { result, store } = await invoke('set_audio', {
        entityId: 'ent-1',
        maxDistance: 50,
        refDistance: 2,
        rolloffFactor: 0.5,
        autoplay: true,
      });
      expect(result.success).toBe(true);
      expect(store.setAudio).toHaveBeenCalledWith('ent-1', {
        maxDistance: 50,
        refDistance: 2,
        rolloffFactor: 0.5,
        autoplay: true,
      });
    });
  });

  // =========================================================================
  // remove_audio
  // =========================================================================
  describe('remove_audio', () => {
    it('calls removeAudio', async () => {
      const { result, store } = await invoke('remove_audio', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.removeAudio).toHaveBeenCalledWith('ent-1');
    });

    it('fails without entityId', async () => {
      const { result } = await invoke('remove_audio', {});
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // play_audio / stop_audio / pause_audio
  // =========================================================================
  describe('play_audio', () => {
    it('calls playAudio', async () => {
      const { result, store } = await invoke('play_audio', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.playAudio).toHaveBeenCalledWith('ent-1');
    });

    it('fails without entityId', async () => {
      const { result } = await invoke('play_audio', {});
      expect(result.success).toBe(false);
    });
  });

  describe('stop_audio', () => {
    it('calls stopAudio', async () => {
      const { result, store } = await invoke('stop_audio', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.stopAudio).toHaveBeenCalledWith('ent-1');
    });
  });

  describe('pause_audio', () => {
    it('calls pauseAudio', async () => {
      const { result, store } = await invoke('pause_audio', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.pauseAudio).toHaveBeenCalledWith('ent-1');
    });
  });

  // =========================================================================
  // get_audio
  // =========================================================================
  describe('get_audio', () => {
    it('returns hasAudio false when no audio', async () => {
      const { result } = await invoke('get_audio', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).hasAudio).toBe(false);
    });

    it('returns audio data when present', async () => {
      const audio = { volume: 0.5, spatial: true };
      const { result } = await invoke('get_audio', { entityId: 'ent-1' }, { primaryAudio: audio });
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.hasAudio).toBe(true);
      expect(r.volume).toBe(0.5);
      expect(r.spatial).toBe(true);
    });

    it('fails without entityId', async () => {
      const { result } = await invoke('get_audio', {});
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // Bus management
  // =========================================================================
  describe('update_audio_bus', () => {
    it('updates bus with volume and muted', async () => {
      const { result, store } = await invoke('update_audio_bus', {
        busName: 'music',
        volume: 0.6,
        muted: true,
      });
      expect(result.success).toBe(true);
      expect(store.updateAudioBus).toHaveBeenCalledWith('music', { volume: 0.6, muted: true });
    });

    it('fails without busName', async () => {
      const { result } = await invoke('update_audio_bus', {});
      expect(result.success).toBe(false);
    });

    it('fails with empty busName', async () => {
      const { result } = await invoke('update_audio_bus', { busName: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('create_audio_bus', () => {
    it('creates bus with default volume', async () => {
      const { result, store } = await invoke('create_audio_bus', { name: 'sfx' });
      expect(result.success).toBe(true);
      expect(store.createAudioBus).toHaveBeenCalledWith('sfx', 1.0);
    });

    it('creates bus with custom volume', async () => {
      const { result, store } = await invoke('create_audio_bus', { name: 'ambient', volume: 0.3 });
      expect(result.success).toBe(true);
      expect(store.createAudioBus).toHaveBeenCalledWith('ambient', 0.3);
    });

    it('fails without name', async () => {
      const { result } = await invoke('create_audio_bus', {});
      expect(result.success).toBe(false);
    });
  });

  describe('delete_audio_bus', () => {
    it('deletes bus', async () => {
      const { result, store } = await invoke('delete_audio_bus', { busName: 'sfx' });
      expect(result.success).toBe(true);
      expect(store.deleteAudioBus).toHaveBeenCalledWith('sfx');
    });
  });

  describe('get_audio_buses', () => {
    it('returns empty buses list', async () => {
      const { result } = await invoke('get_audio_buses');
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.count).toBe(0);
      expect(r.buses).toEqual([]);
    });

    it('returns populated buses list', async () => {
      const buses = [{ name: 'music', volume: 0.8 }, { name: 'sfx', volume: 1.0 }];
      const { result } = await invoke('get_audio_buses', {}, { audioBuses: buses });
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.count).toBe(2);
    });
  });

  // =========================================================================
  // set_bus_effects
  // =========================================================================
  describe('set_bus_effects', () => {
    it('sets effects on bus', async () => {
      const effects = [
        { effectType: 'reverb', params: { decay: 2.0 }, enabled: true },
      ];
      const { result, store } = await invoke('set_bus_effects', {
        busName: 'music',
        effects,
      });
      expect(result.success).toBe(true);
      expect(store.setBusEffects).toHaveBeenCalledWith('music', effects);
      const r = result.result as Record<string, unknown>;
      expect(r.effectCount).toBe(1);
    });

    it('fails with empty busName', async () => {
      const { result } = await invoke('set_bus_effects', {
        busName: '',
        effects: [],
      });
      expect(result.success).toBe(false);
    });

    it('fails without effects array', async () => {
      const { result } = await invoke('set_bus_effects', { busName: 'music' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // audio_crossfade
  // =========================================================================
  describe('audio_crossfade', () => {
    it('crossfades with default duration', async () => {
      const { result, store } = await invoke('audio_crossfade', {
        fromEntityId: 'ent-1',
        toEntityId: 'ent-2',
      });
      expect(result.success).toBe(true);
      expect(store.crossfadeAudio).toHaveBeenCalledWith('ent-1', 'ent-2', 1000);
    });

    it('crossfades with custom duration', async () => {
      const { result, store } = await invoke('audio_crossfade', {
        fromEntityId: 'ent-1',
        toEntityId: 'ent-2',
        durationMs: 500,
      });
      expect(result.success).toBe(true);
      expect(store.crossfadeAudio).toHaveBeenCalledWith('ent-1', 'ent-2', 500);
    });

    it('fails without required entity IDs', async () => {
      const { result } = await invoke('audio_crossfade', { fromEntityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // audio_fade_in / audio_fade_out
  // =========================================================================
  describe('audio_fade_in', () => {
    it('fades in with default duration', async () => {
      const { result, store } = await invoke('audio_fade_in', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.fadeInAudio).toHaveBeenCalledWith('ent-1', 1000);
    });

    it('fades in with custom duration', async () => {
      const { result, store } = await invoke('audio_fade_in', { entityId: 'ent-1', durationMs: 250 });
      expect(result.success).toBe(true);
      expect(store.fadeInAudio).toHaveBeenCalledWith('ent-1', 250);
    });
  });

  describe('audio_fade_out', () => {
    it('fades out with default duration', async () => {
      const { result, store } = await invoke('audio_fade_out', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.fadeOutAudio).toHaveBeenCalledWith('ent-1', 1000);
    });
  });

  // =========================================================================
  // audio_play_one_shot
  // =========================================================================
  describe('audio_play_one_shot', () => {
    it('plays one-shot with required assetId', async () => {
      const { result, store } = await invoke('audio_play_one_shot', { assetId: 'sfx-boom' });
      expect(result.success).toBe(true);
      expect(store.playOneShotAudio).toHaveBeenCalledWith('sfx-boom', {
        position: undefined,
        bus: undefined,
        volume: undefined,
        pitch: undefined,
      });
    });

    it('passes optional params through', async () => {
      const { result, store } = await invoke('audio_play_one_shot', {
        assetId: 'sfx-boom',
        position: [1, 2, 3],
        bus: 'sfx',
        volume: 0.5,
        pitch: 1.5,
      });
      expect(result.success).toBe(true);
      expect(store.playOneShotAudio).toHaveBeenCalledWith('sfx-boom', {
        position: [1, 2, 3],
        bus: 'sfx',
        volume: 0.5,
        pitch: 1.5,
      });
    });

    it('fails without assetId', async () => {
      const { result } = await invoke('audio_play_one_shot', {});
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // audio_add_layer / audio_remove_layer
  // =========================================================================
  describe('audio_add_layer', () => {
    it('adds layer with required fields', async () => {
      const { result, store } = await invoke('audio_add_layer', {
        entityId: 'ent-1',
        slotName: 'footstep',
        assetId: 'sfx-step',
      });
      expect(result.success).toBe(true);
      expect(store.addAudioLayer).toHaveBeenCalledWith('ent-1', 'footstep', 'sfx-step', {
        volume: undefined,
        loop: undefined,
        bus: undefined,
      });
    });

    it('passes optional layer options', async () => {
      const { result, store } = await invoke('audio_add_layer', {
        entityId: 'ent-1',
        slotName: 'ambient',
        assetId: 'sfx-wind',
        volume: 0.3,
        loop: true,
        bus: 'ambient',
      });
      expect(result.success).toBe(true);
      expect(store.addAudioLayer).toHaveBeenCalledWith('ent-1', 'ambient', 'sfx-wind', {
        volume: 0.3,
        loop: true,
        bus: 'ambient',
      });
    });

    it('fails without slotName', async () => {
      const { result } = await invoke('audio_add_layer', { entityId: 'ent-1', assetId: 'x' });
      expect(result.success).toBe(false);
    });
  });

  describe('audio_remove_layer', () => {
    it('removes layer', async () => {
      const { result, store } = await invoke('audio_remove_layer', {
        entityId: 'ent-1',
        slotName: 'footstep',
      });
      expect(result.success).toBe(true);
      expect(store.removeAudioLayer).toHaveBeenCalledWith('ent-1', 'footstep');
    });

    it('fails without slotName', async () => {
      const { result } = await invoke('audio_remove_layer', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // set_ducking_rule
  // =========================================================================
  describe('set_ducking_rule', () => {
    it('sets ducking rule with required fields', async () => {
      const { result, store } = await invoke('set_ducking_rule', {
        triggerBus: 'voice',
        targetBus: 'music',
      });
      expect(result.success).toBe(true);
      expect(store.setDuckingRule).toHaveBeenCalledWith({
        triggerBus: 'voice',
        targetBus: 'music',
        duckLevel: undefined,
        attackMs: undefined,
        releaseMs: undefined,
      });
    });

    it('passes optional ducking params', async () => {
      const { result, store } = await invoke('set_ducking_rule', {
        triggerBus: 'voice',
        targetBus: 'music',
        duckLevel: 0.2,
        attackMs: 100,
        releaseMs: 500,
      });
      expect(result.success).toBe(true);
      expect(store.setDuckingRule).toHaveBeenCalledWith({
        triggerBus: 'voice',
        targetBus: 'music',
        duckLevel: 0.2,
        attackMs: 100,
        releaseMs: 500,
      });
    });

    it('fails without triggerBus', async () => {
      const { result } = await invoke('set_ducking_rule', { targetBus: 'music' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // set_reverb_zone / remove_reverb_zone
  // =========================================================================
  describe('set_reverb_zone', () => {
    it('sets box reverb zone with defaults', async () => {
      const { result, store } = await invoke('set_reverb_zone', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.updateReverbZone).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        shape: { type: 'box', size: [10, 5, 10] },
        preset: 'hall',
        wetMix: 0.5,
      }));
    });

    it('sets sphere reverb zone', async () => {
      const { result, store } = await invoke('set_reverb_zone', {
        entityId: 'ent-1',
        shape: 'sphere',
        radius: 12,
      });
      expect(result.success).toBe(true);
      expect(store.updateReverbZone).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        shape: { type: 'sphere', radius: 12 },
      }));
    });

    it('uses existing zone values when present', async () => {
      const existing = {
        preset: 'cave',
        wetMix: 0.8,
        decayTime: 4.0,
        preDelay: 30,
        blendRadius: 3.0,
        priority: 5,
      };
      const reverbZones = { 'ent-1': existing };
      const { result, store } = await invoke('set_reverb_zone', { entityId: 'ent-1' }, { reverbZones });
      expect(result.success).toBe(true);
      expect(store.updateReverbZone).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        preset: 'cave',
        wetMix: 0.8,
        decayTime: 4.0,
        preDelay: 30,
        blendRadius: 3.0,
        priority: 5,
      }));
    });

    it('overrides existing values with provided args', async () => {
      const existing = { preset: 'cave', wetMix: 0.8, decayTime: 4.0, preDelay: 30, blendRadius: 3.0, priority: 0 };
      const reverbZones = { 'ent-1': existing };
      const { result, store } = await invoke('set_reverb_zone', {
        entityId: 'ent-1',
        reverbType: 'room',
        wetMix: 0.3,
      }, { reverbZones });
      expect(result.success).toBe(true);
      expect(store.updateReverbZone).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        preset: 'room',
        wetMix: 0.3,
      }));
    });
  });

  describe('remove_reverb_zone', () => {
    it('removes reverb zone', async () => {
      const { result, store } = await invoke('remove_reverb_zone', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.removeReverbZone).toHaveBeenCalledWith('ent-1');
    });

    it('fails without entityId', async () => {
      const { result } = await invoke('remove_reverb_zone', {});
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // set_music_stems
  // =========================================================================
  describe('set_music_stems', () => {
    it('sets music stems via audioManager', async () => {
      const { audioManager } = await import('@/lib/audio/audioManager');
      const stems = [{ name: 'bass', assetId: 'bass-track' }];
      const { result } = await invoke('set_music_stems', { stems });
      expect(result.success).toBe(true);
      expect(audioManager.setAdaptiveMusic).toHaveBeenCalledWith('default', stems);
    });

    it('uses custom trackId', async () => {
      const { audioManager } = await import('@/lib/audio/audioManager');
      const stems = [{ name: 'drums', assetId: 'drum-loop' }];
      const { result } = await invoke('set_music_stems', { trackId: 'battle', stems });
      expect(result.success).toBe(true);
      expect(audioManager.setAdaptiveMusic).toHaveBeenCalledWith('battle', stems);
    });

    it('fails with empty stems', async () => {
      const { result } = await invoke('set_music_stems', { stems: [] });
      expect(result.success).toBe(false);
    });

    it('fails without stems', async () => {
      const { result } = await invoke('set_music_stems', {});
      expect(result.success).toBe(false);
    });
  });
});
