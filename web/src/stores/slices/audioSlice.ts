/**
 * Audio slice - manages audio, buses, reverb zones, and audio effects.
 * TODO: Extract full implementation from editorStore.ts
 */

import { StateCreator } from 'zustand';
import type { AudioData, AudioBusDef, AudioEffectDef, ReverbZoneData } from './types';

export interface AudioSlice {
  primaryAudio: AudioData | null;
  audioBuses: AudioBusDef[];
  mixerPanelOpen: boolean;
  reverbZones: Record<string, ReverbZoneData>;
  reverbZonesEnabled: Record<string, boolean>;

  setAudio: (entityId: string, data: Partial<AudioData>) => void;
  removeAudio: (entityId: string) => void;
  playAudio: (entityId: string) => void;
  stopAudio: (entityId: string) => void;
  pauseAudio: (entityId: string) => void;
  setEntityAudio: (entityId: string, audio: AudioData | null) => void;
  setAudioBuses: (buses: AudioBusDef[]) => void;
  updateAudioBus: (busName: string, update: { volume?: number; muted?: boolean; soloed?: boolean }) => void;
  createAudioBus: (name: string, volume?: number) => void;
  deleteAudioBus: (busName: string) => void;
  setBusEffects: (busName: string, effects: AudioEffectDef[]) => void;
  toggleMixerPanel: () => void;
  crossfadeAudio: (fromEntityId: string, toEntityId: string, durationMs: number) => void;
  setReverbZone: (entityId: string, data: ReverbZoneData, enabled: boolean) => void;
  removeReverbZone: (entityId: string) => void;
  updateReverbZone: (entityId: string, data: ReverbZoneData) => void;
  fadeInAudio: (entityId: string, durationMs: number) => void;
  fadeOutAudio: (entityId: string, durationMs: number) => void;
  playOneShotAudio: (assetId: string, options?: { position?: [number, number, number]; bus?: string; volume?: number; pitch?: number }) => void;
  addAudioLayer: (entityId: string, slotName: string, assetId: string, options?: { volume?: number; loop?: boolean; bus?: string }) => void;
  removeAudioLayer: (entityId: string, slotName: string) => void;
  setDuckingRule: (rule: { triggerBus: string; targetBus: string; duckLevel?: number; attackMs?: number; releaseMs?: number }) => void;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setAudioDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createAudioSlice: StateCreator<AudioSlice, [], [], AudioSlice> = (set, get) => ({
  primaryAudio: null,
  audioBuses: [
    { name: 'master', volume: 1.0, muted: false, soloed: false, effects: [] },
    { name: 'sfx', volume: 1.0, muted: false, soloed: false, effects: [] },
    { name: 'music', volume: 0.8, muted: false, soloed: false, effects: [] },
    { name: 'ambient', volume: 0.7, muted: false, soloed: false, effects: [] },
    { name: 'voice', volume: 1.0, muted: false, soloed: false, effects: [] },
  ],
  mixerPanelOpen: false,
  reverbZones: {},
  reverbZonesEnabled: {},

  setAudio: (entityId, data) => {
    if (dispatchCommand) dispatchCommand('set_audio', { entityId, ...data });
  },
  removeAudio: (entityId) => {
    if (dispatchCommand) dispatchCommand('remove_audio', { entityId });
  },
  playAudio: (entityId) => {
    if (dispatchCommand) dispatchCommand('play_audio', { entityId });
  },
  stopAudio: (entityId) => {
    if (dispatchCommand) dispatchCommand('stop_audio', { entityId });
  },
  pauseAudio: (entityId) => {
    if (dispatchCommand) dispatchCommand('pause_audio', { entityId });
  },
  setEntityAudio: (entityId, audio) => set({ primaryAudio: audio }),
  setAudioBuses: (buses) => set({ audioBuses: buses }),
  updateAudioBus: (busName, update) => {
    const state = get();
    const updated = state.audioBuses.map(bus =>
      bus.name === busName ? { ...bus, ...update } : bus
    );
    set({ audioBuses: updated });
  },
  createAudioBus: (name, volume = 1.0) => {
    const state = get();
    set({ audioBuses: [...state.audioBuses, { name, volume, muted: false, soloed: false, effects: [] }] });
  },
  deleteAudioBus: (busName) => {
    const state = get();
    set({ audioBuses: state.audioBuses.filter(bus => bus.name !== busName) });
  },
  setBusEffects: (busName, effects) => {
    const state = get();
    const updated = state.audioBuses.map(bus =>
      bus.name === busName ? { ...bus, effects } : bus
    );
    set({ audioBuses: updated });
  },
  toggleMixerPanel: () => {
    const state = get();
    set({ mixerPanelOpen: !state.mixerPanelOpen });
  },
  crossfadeAudio: (_fromEntityId, _toEntityId, _durationMs) => {
    // JS-only implementation (no WASM dispatch)
  },
  setReverbZone: (entityId, data, enabled) => {
    set(state => ({
      reverbZones: { ...state.reverbZones, [entityId]: data },
      reverbZonesEnabled: { ...state.reverbZonesEnabled, [entityId]: enabled },
    }));
    if (dispatchCommand) dispatchCommand('set_reverb_zone', { entityId, ...data, enabled });
  },
  removeReverbZone: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.reverbZones;
      const { [entityId]: _enabled, ...restEnabled } = state.reverbZonesEnabled;
      return { reverbZones: rest, reverbZonesEnabled: restEnabled };
    });
    if (dispatchCommand) dispatchCommand('remove_reverb_zone', { entityId });
  },
  updateReverbZone: (entityId, data) => {
    set(state => ({ reverbZones: { ...state.reverbZones, [entityId]: data } }));
    if (dispatchCommand) dispatchCommand('update_reverb_zone', { entityId, ...data });
  },
  fadeInAudio: (_entityId, _durationMs) => {},
  fadeOutAudio: (_entityId, _durationMs) => {},
  playOneShotAudio: (_assetId, _options) => {},
  addAudioLayer: (_entityId, _slotName, _assetId, _options) => {},
  removeAudioLayer: (_entityId, _slotName) => {},
  setDuckingRule: (_rule) => {},
});
