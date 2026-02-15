/**
 * Lighting slice - manages lights, environment, and skybox.
 * TODO: Extract full implementation from editorStore.ts
 */

import { StateCreator } from 'zustand';
import type { LightData, AmbientLightData, EnvironmentData } from './types';

export interface LightingSlice {
  primaryLight: LightData | null;
  ambientLight: AmbientLightData;
  environment: EnvironmentData;

  setPrimaryLight: (light: LightData) => void;
  updateLight: (entityId: string, light: LightData) => void;
  setAmbientLight: (data: AmbientLightData) => void;
  updateAmbientLight: (data: Partial<AmbientLightData>) => void;
  setEnvironment: (data: EnvironmentData) => void;
  updateEnvironment: (data: Partial<EnvironmentData>) => void;
  setSkybox: (preset: string) => void;
  removeSkybox: () => void;
  updateSkybox: (changes: { brightness?: number; iblIntensity?: number; rotation?: number }) => void;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setLightingDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createLightingSlice: StateCreator<LightingSlice, [], [], LightingSlice> = (set, get) => ({
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

  setPrimaryLight: (light) => set({ primaryLight: light }),
  updateLight: (entityId, light) => {
    set({ primaryLight: light });
    if (dispatchCommand) dispatchCommand('update_light', { entityId, ...light });
  },
  setAmbientLight: (data) => set({ ambientLight: data }),
  updateAmbientLight: (data) => {
    const state = get();
    const updated = { ...state.ambientLight, ...data };
    set({ ambientLight: updated });
    if (dispatchCommand) dispatchCommand('update_ambient_light', data);
  },
  setEnvironment: (data) => set({ environment: data }),
  updateEnvironment: (data) => {
    const state = get();
    const updated = { ...state.environment, ...data };
    set({ environment: updated });
    if (dispatchCommand) dispatchCommand('update_environment', data);
  },
  setSkybox: (preset) => {
    if (dispatchCommand) dispatchCommand('set_skybox', { preset });
  },
  removeSkybox: () => {
    if (dispatchCommand) dispatchCommand('remove_skybox', {});
  },
  updateSkybox: (changes) => {
    if (dispatchCommand) dispatchCommand('update_skybox', changes);
  },
});
