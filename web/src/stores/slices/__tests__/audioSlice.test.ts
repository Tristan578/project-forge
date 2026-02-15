import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createAudioSlice, setAudioDispatcher, type AudioSlice } from '../audioSlice';
import type { AudioData, AudioBusDef, AudioEffectDef, ReverbZoneData } from '../types';

describe('audioSlice', () => {
  let store: ReturnType<typeof createSliceStore<AudioSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setAudioDispatcher(mockDispatch);
    store = createSliceStore(createAudioSlice);
  });

  afterEach(() => {
    setAudioDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should have 5 default audio buses', () => {
      const state = store.getState();
      expect(state.audioBuses).toHaveLength(5);

      const busNames = state.audioBuses.map((bus) => bus.name);
      expect(busNames).toEqual(['master', 'sfx', 'music', 'ambient', 'voice']);
    });

    it('should have null primaryAudio', () => {
      const state = store.getState();
      expect(state.primaryAudio).toBeNull();
    });

    it('should have empty reverb zones', () => {
      const state = store.getState();
      expect(state.reverbZones).toEqual({});
      expect(state.reverbZonesEnabled).toEqual({});
    });

    it('should have mixerPanelOpen false', () => {
      const state = store.getState();
      expect(state.mixerPanelOpen).toBe(false);
    });

    it('should have master bus with volume 1.0 and not muted/soloed', () => {
      const state = store.getState();
      const masterBus = state.audioBuses.find((bus) => bus.name === 'master');
      expect(masterBus).toEqual({
        name: 'master',
        volume: 1.0,
        muted: false,
        soloed: false,
        effects: [],
      });
    });
  });

  describe('Bus CRUD', () => {
    it('should create a new audio bus', () => {
      store.getState().createAudioBus('ui', 0.8);

      const state = store.getState();
      expect(state.audioBuses).toHaveLength(6);

      const uiBus = state.audioBuses.find((bus) => bus.name === 'ui');
      expect(uiBus).toEqual({
        name: 'ui',
        volume: 0.8,
        muted: false,
        soloed: false,
        effects: [],
      });
    });

    it('should create a bus with default volume 1.0 if not specified', () => {
      store.getState().createAudioBus('dialogue');

      const state = store.getState();
      const dialogueBus = state.audioBuses.find((bus) => bus.name === 'dialogue');
      expect(dialogueBus?.volume).toBe(1.0);
    });

    it('should allow creating duplicate bus names', () => {
      const state = store.getState();
      const originalSfxVolume = state.audioBuses.find((bus) => bus.name === 'sfx')?.volume;

      store.getState().createAudioBus('sfx', 0.5);

      const newState = store.getState();
      expect(newState.audioBuses).toHaveLength(6); // Now 6 buses (duplicate allowed)

      const sfxBuses = newState.audioBuses.filter((bus) => bus.name === 'sfx');
      expect(sfxBuses).toHaveLength(2);
      expect(sfxBuses[0].volume).toBe(originalSfxVolume); // Original sfx bus unchanged
      expect(sfxBuses[1].volume).toBe(0.5); // New sfx bus
    });

    it('should delete an audio bus', () => {
      store.getState().deleteAudioBus('voice');

      const state = store.getState();
      expect(state.audioBuses).toHaveLength(4);

      const voiceBus = state.audioBuses.find((bus) => bus.name === 'voice');
      expect(voiceBus).toBeUndefined();
    });

    it('should delete master bus if requested', () => {
      store.getState().deleteAudioBus('master');

      const state = store.getState();
      expect(state.audioBuses).toHaveLength(4); // Now 4 buses

      const masterBus = state.audioBuses.find((bus) => bus.name === 'master');
      expect(masterBus).toBeUndefined();
    });

    it('should update audio bus volume', () => {
      store.getState().updateAudioBus('music', { volume: 0.5 });

      const state = store.getState();
      const musicBus = state.audioBuses.find((bus) => bus.name === 'music');
      expect(musicBus?.volume).toBe(0.5);
    });

    it('should update audio bus muted state', () => {
      store.getState().updateAudioBus('sfx', { muted: true });

      const state = store.getState();
      const sfxBus = state.audioBuses.find((bus) => bus.name === 'sfx');
      expect(sfxBus?.muted).toBe(true);
    });

    it('should update audio bus soloed state', () => {
      store.getState().updateAudioBus('ambient', { soloed: true });

      const state = store.getState();
      const ambientBus = state.audioBuses.find((bus) => bus.name === 'ambient');
      expect(ambientBus?.soloed).toBe(true);
    });

    it('should update multiple bus properties at once', () => {
      store.getState().updateAudioBus('voice', { volume: 0.3, muted: true, soloed: false });

      const state = store.getState();
      const voiceBus = state.audioBuses.find((bus) => bus.name === 'voice');
      expect(voiceBus).toMatchObject({
        name: 'voice',
        volume: 0.3,
        muted: true,
        soloed: false,
      });
    });

    it('should set bus effects', () => {
      const effects: AudioEffectDef[] = [
        { effectType: 'reverb', params: { decay: 2.0, mix: 0.5 }, enabled: true },
        { effectType: 'eq', params: { low: 1.0, mid: 0.8, high: 1.2 }, enabled: true },
      ];

      store.getState().setBusEffects('music', effects);

      const state = store.getState();
      const musicBus = state.audioBuses.find((bus) => bus.name === 'music');
      expect(musicBus?.effects).toEqual(effects);
    });

    it('should replace entire audio buses array', () => {
      const newBuses: AudioBusDef[] = [
        { name: 'master', volume: 1.0, muted: false, soloed: false, effects: [] },
        { name: 'gameplay', volume: 0.9, muted: false, soloed: false, effects: [] },
      ];

      store.getState().setAudioBuses(newBuses);

      const state = store.getState();
      expect(state.audioBuses).toEqual(newBuses);
      expect(state.audioBuses).toHaveLength(2);
    });
  });

  describe('Mixer toggle', () => {
    it('should toggle mixer panel from false to true', () => {
      expect(store.getState().mixerPanelOpen).toBe(false);

      store.getState().toggleMixerPanel();

      expect(store.getState().mixerPanelOpen).toBe(true);
    });

    it('should toggle mixer panel from true to false', () => {
      store.getState().toggleMixerPanel(); // Open
      expect(store.getState().mixerPanelOpen).toBe(true);

      store.getState().toggleMixerPanel(); // Close

      expect(store.getState().mixerPanelOpen).toBe(false);
    });
  });

  describe('Entity audio', () => {
    it('should set entity audio', () => {
      const audioData: AudioData = {
        assetId: 'audio-1',
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

      store.getState().setEntityAudio('entity-1', audioData);

      const state = store.getState();
      expect(state.primaryAudio).toEqual(audioData);
    });

    it('should clear entity audio with null', () => {
      const audioData: AudioData = {
        assetId: 'audio-1',
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

      store.getState().setEntityAudio('entity-1', audioData);
      expect(store.getState().primaryAudio).toEqual(audioData);

      store.getState().setEntityAudio('entity-1', null);

      expect(store.getState().primaryAudio).toBeNull();
    });
  });

  describe('Reverb zones', () => {
    const reverbData: ReverbZoneData = {
      shape: { type: 'sphere', radius: 10.0 },
      preset: 'hall',
      wetMix: 0.5,
      decayTime: 2.5,
      preDelay: 20,
      blendRadius: 2.0,
      priority: 1,
    };

    it('should set reverb zone', () => {
      store.getState().setReverbZone('entity-1', reverbData, true);

      const state = store.getState();
      expect(state.reverbZones['entity-1']).toEqual(reverbData);
      expect(state.reverbZonesEnabled['entity-1']).toBe(true);

      expect(mockDispatch).toHaveBeenCalledWith('set_reverb_zone', {
        entityId: 'entity-1',
        ...reverbData,
        enabled: true,
      });
    });

    it('should set reverb zone with enabled false', () => {
      store.getState().setReverbZone('entity-2', reverbData, false);

      const state = store.getState();
      expect(state.reverbZones['entity-2']).toEqual(reverbData);
      expect(state.reverbZonesEnabled['entity-2']).toBe(false);

      expect(mockDispatch).toHaveBeenCalledWith('set_reverb_zone', {
        entityId: 'entity-2',
        ...reverbData,
        enabled: false,
      });
    });

    it('should update existing reverb zone', () => {
      store.getState().setReverbZone('entity-1', reverbData, true);

      const updatedData: ReverbZoneData = {
        ...reverbData,
        wetMix: 0.7,
        decayTime: 3.0,
      };

      store.getState().updateReverbZone('entity-1', updatedData);

      const state = store.getState();
      expect(state.reverbZones['entity-1']).toEqual(updatedData);

      expect(mockDispatch).toHaveBeenCalledWith('update_reverb_zone', {
        entityId: 'entity-1',
        ...updatedData,
      });
    });

    it('should remove reverb zone', () => {
      store.getState().setReverbZone('entity-1', reverbData, true);
      expect(store.getState().reverbZones['entity-1']).toBeDefined();

      store.getState().removeReverbZone('entity-1');

      const state = store.getState();
      expect(state.reverbZones['entity-1']).toBeUndefined();
      expect(state.reverbZonesEnabled['entity-1']).toBeUndefined();

      expect(mockDispatch).toHaveBeenCalledWith('remove_reverb_zone', {
        entityId: 'entity-1',
      });
    });

    it('should handle removing non-existent reverb zone gracefully', () => {
      store.getState().removeReverbZone('non-existent');

      const state = store.getState();
      expect(state.reverbZones).toEqual({});
      expect(state.reverbZonesEnabled).toEqual({});

      expect(mockDispatch).toHaveBeenCalledWith('remove_reverb_zone', {
        entityId: 'non-existent',
      });
    });
  });

  describe('WASM dispatch', () => {
    const audioData: AudioData = {
      assetId: 'audio-1',
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

    it('should dispatch setAudio command', () => {
      store.getState().setAudio('entity-1', { volume: 0.5, loopAudio: false });

      expect(mockDispatch).toHaveBeenCalledWith('set_audio', {
        entityId: 'entity-1',
        volume: 0.5,
        loopAudio: false,
      });
    });

    it('should dispatch removeAudio command', () => {
      store.getState().removeAudio('entity-1');

      expect(mockDispatch).toHaveBeenCalledWith('remove_audio', {
        entityId: 'entity-1',
      });
    });

    it('should dispatch playAudio command', () => {
      store.getState().playAudio('entity-1');

      expect(mockDispatch).toHaveBeenCalledWith('play_audio', {
        entityId: 'entity-1',
      });
    });

    it('should dispatch stopAudio command', () => {
      store.getState().stopAudio('entity-1');

      expect(mockDispatch).toHaveBeenCalledWith('stop_audio', {
        entityId: 'entity-1',
      });
    });

    it('should dispatch pauseAudio command', () => {
      store.getState().pauseAudio('entity-1');

      expect(mockDispatch).toHaveBeenCalledWith('pause_audio', {
        entityId: 'entity-1',
      });
    });

    it('should dispatch with partial audio data', () => {
      store.getState().setAudio('entity-2', { assetId: 'audio-2' });

      expect(mockDispatch).toHaveBeenCalledWith('set_audio', {
        entityId: 'entity-2',
        assetId: 'audio-2',
      });
    });

    it('should dispatch with full audio data', () => {
      store.getState().setAudio('entity-3', audioData);

      expect(mockDispatch).toHaveBeenCalledWith('set_audio', {
        entityId: 'entity-3',
        ...audioData,
      });
    });
  });
});
