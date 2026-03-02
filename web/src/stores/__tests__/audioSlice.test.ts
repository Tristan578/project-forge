/**
 * Unit tests for the audioSlice — audio CRUD, buses, reverb zones.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAudioSlice, setAudioDispatcher, type AudioSlice } from '../slices/audioSlice';

function createTestStore() {
  const store = { state: null as unknown as AudioSlice };
  const set = (partial: Partial<AudioSlice> | ((s: AudioSlice) => Partial<AudioSlice>)) => {
    if (typeof partial === 'function') Object.assign(store.state, partial(store.state));
    else Object.assign(store.state, partial);
  };
  const get = () => store.state;
  store.state = createAudioSlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

describe('audioSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setAudioDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should have null primary audio', () => {
      expect(store.getState().primaryAudio).toBeNull();
    });

    it('should have 5 default buses (master, sfx, music, ambient, voice)', () => {
      const buses = store.getState().audioBuses;
      expect(buses).toHaveLength(5);
      expect(buses.map(b => b.name)).toEqual(['master', 'sfx', 'music', 'ambient', 'voice']);
    });

    it('should have mixer panel closed', () => {
      expect(store.getState().mixerPanelOpen).toBe(false);
    });

    it('should have empty reverb zones', () => {
      expect(store.getState().reverbZones).toEqual({});
      expect(store.getState().reverbZonesEnabled).toEqual({});
    });

    it('should have default adaptive music state', () => {
      expect(store.getState().adaptiveMusicIntensity).toBe(0);
      expect(store.getState().currentMusicSegment).toBe('intro');
    });
  });

  describe('Audio CRUD', () => {
    it('setAudio dispatches set_audio command', () => {
      store.getState().setAudio('ent-1', { volume: 0.8, pitch: 1.0, loopAudio: false });
      expect(mockDispatch).toHaveBeenCalledWith('set_audio', {
        entityId: 'ent-1', volume: 0.8, pitch: 1.0, loopAudio: false,
      });
    });

    it('removeAudio dispatches remove command', () => {
      store.getState().removeAudio('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('remove_audio', { entityId: 'ent-1' });
    });

    it('playAudio dispatches play command', () => {
      store.getState().playAudio('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('play_audio', { entityId: 'ent-1' });
    });

    it('stopAudio dispatches stop command', () => {
      store.getState().stopAudio('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('stop_audio', { entityId: 'ent-1' });
    });

    it('pauseAudio dispatches pause command', () => {
      store.getState().pauseAudio('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('pause_audio', { entityId: 'ent-1' });
    });

    it('setEntityAudio sets primary audio state', () => {
      const audio = { assetId: 'sfx-01', volume: 0.8, pitch: 1.0, loopAudio: false, spatial: false, maxDistance: 50, refDistance: 1, rolloffFactor: 1, autoplay: false, bus: 'sfx' };
      store.getState().setEntityAudio('ent-1', audio);
      expect(store.getState().primaryAudio).toEqual(audio);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Audio buses', () => {
    it('setAudioBuses replaces entire list', () => {
      const newBuses = [{ name: 'only', volume: 1.0, muted: false, soloed: false, effects: [] }];
      store.getState().setAudioBuses(newBuses);
      expect(store.getState().audioBuses).toEqual(newBuses);
    });

    it('updateAudioBus merges updates for matching bus', () => {
      store.getState().updateAudioBus('master', { volume: 0.5 });
      const master = store.getState().audioBuses.find(b => b.name === 'master');
      expect(master?.volume).toBe(0.5);
    });

    it('updateAudioBus mutes a bus', () => {
      store.getState().updateAudioBus('sfx', { muted: true });
      const sfx = store.getState().audioBuses.find(b => b.name === 'sfx');
      expect(sfx?.muted).toBe(true);
    });

    it('createAudioBus appends new bus', () => {
      store.getState().createAudioBus('dialogue', 0.9);
      expect(store.getState().audioBuses).toHaveLength(6);
      const last = store.getState().audioBuses[5];
      expect(last.name).toBe('dialogue');
      expect(last.volume).toBe(0.9);
    });

    it('createAudioBus uses default volume 1.0', () => {
      store.getState().createAudioBus('custom');
      const custom = store.getState().audioBuses.find(b => b.name === 'custom');
      expect(custom?.volume).toBe(1.0);
    });

    it('deleteAudioBus removes by name', () => {
      store.getState().deleteAudioBus('voice');
      expect(store.getState().audioBuses).toHaveLength(4);
      expect(store.getState().audioBuses.find(b => b.name === 'voice')).toBeUndefined();
    });

    it('setBusEffects sets effects for a bus', () => {
      const effects = [{ effectType: 'reverb', params: { wet: 0.3, dry: 0.7 }, enabled: true }];
      store.getState().setBusEffects('sfx', effects);
      const sfx = store.getState().audioBuses.find(b => b.name === 'sfx');
      expect(sfx?.effects).toEqual(effects);
    });
  });

  describe('Mixer panel', () => {
    it('toggleMixerPanel toggles state', () => {
      expect(store.getState().mixerPanelOpen).toBe(false);
      store.getState().toggleMixerPanel();
      expect(store.getState().mixerPanelOpen).toBe(true);
      store.getState().toggleMixerPanel();
      expect(store.getState().mixerPanelOpen).toBe(false);
    });
  });

  describe('Reverb zones', () => {
    const sampleReverb = {
      shape: { type: 'sphere' as const, radius: 10 },
      preset: 'large_hall',
      wetMix: 0.3,
      decayTime: 2.0,
      preDelay: 20,
      blendRadius: 1.0,
      priority: 0,
    };

    it('setReverbZone stores and dispatches', () => {
      store.getState().setReverbZone('ent-1', sampleReverb, true);
      expect(store.getState().reverbZones['ent-1']).toEqual(sampleReverb);
      expect(store.getState().reverbZonesEnabled['ent-1']).toBe(true);
      expect(mockDispatch).toHaveBeenCalledWith('set_reverb_zone', {
        entityId: 'ent-1', ...sampleReverb, enabled: true,
      });
    });

    it('removeReverbZone removes from both maps', () => {
      store.getState().setReverbZone('ent-1', sampleReverb, true);
      store.getState().removeReverbZone('ent-1');
      expect(store.getState().reverbZones['ent-1']).toBeUndefined();
      expect(store.getState().reverbZonesEnabled['ent-1']).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('remove_reverb_zone', { entityId: 'ent-1' });
    });

    it('updateReverbZone updates data and dispatches', () => {
      store.getState().setReverbZone('ent-1', sampleReverb, true);
      const updated = { ...sampleReverb, wetMix: 0.8 };
      store.getState().updateReverbZone('ent-1', updated);
      expect(store.getState().reverbZones['ent-1']).toEqual(updated);
      expect(mockDispatch).toHaveBeenCalledWith('update_reverb_zone', {
        entityId: 'ent-1', ...updated,
      });
    });
  });

  describe('Adaptive music', () => {
    it('setAdaptiveMusicIntensity updates state', () => {
      store.getState().setAdaptiveMusicIntensity(0.7);
      expect(store.getState().adaptiveMusicIntensity).toBe(0.7);
    });

    it('setCurrentMusicSegment updates segment', () => {
      store.getState().setCurrentMusicSegment('battle');
      expect(store.getState().currentMusicSegment).toBe('battle');
    });
  });
});
