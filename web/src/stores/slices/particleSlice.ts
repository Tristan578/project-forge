/**
 * Particle slice - manages particle systems.
 * TODO: Extract full implementation from editorStore.ts
 */

import { StateCreator } from 'zustand';
import type { ParticleData, ParticlePreset, PostProcessingData, QualityPreset } from './types';

export interface ParticleSlice {
  primaryParticle: ParticleData | null;
  particleEnabled: boolean;
  postProcessing: PostProcessingData;
  qualityPreset: QualityPreset;

  setParticle: (entityId: string, data: Partial<ParticleData>) => void;
  removeParticle: (entityId: string) => void;
  toggleParticle: (entityId: string, enabled: boolean) => void;
  setParticlePreset: (entityId: string, preset: ParticlePreset) => void;
  playParticle: (entityId: string) => void;
  stopParticle: (entityId: string) => void;
  burstParticle: (entityId: string, count?: number) => void;
  setEntityParticle: (entityId: string, data: ParticleData | null, enabled: boolean) => void;
  setPrimaryParticle: (data: ParticleData | null, enabled: boolean) => void;
  updatePostProcessing: (partial: Partial<PostProcessingData>) => void;
  setPostProcessing: (data: PostProcessingData) => void;
  setQualityPreset: (preset: QualityPreset) => void;
  setQualityFromEngine: (data: unknown) => void;
  updateBloom: (partial: unknown) => void;
  updateChromaticAberration: (partial: unknown) => void;
  updateColorGrading: (partial: unknown) => void;
  updateSharpening: (partial: unknown) => void;
  updateSsao: (data: unknown) => void;
  updateDepthOfField: (data: unknown) => void;
  updateMotionBlur: (data: unknown) => void;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setParticleDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createParticleSlice: StateCreator<ParticleSlice, [], [], ParticleSlice> = (set, get) => ({
  primaryParticle: null,
  particleEnabled: false,
  postProcessing: {
    bloom: { enabled: false, intensity: 0.15, lowFrequencyBoost: 0.7, lowFrequencyBoostCurvature: 0.95, highPassFrequency: 1.0, prefilterThreshold: 0.0, prefilterThresholdSoftness: 0.0, compositeMode: 'energy_conserving', maxMipDimension: 512 },
    chromaticAberration: { enabled: false, intensity: 0.02, maxSamples: 8 },
    colorGrading: { enabled: false, global: { exposure: 0.0, temperature: 0.0, tint: 0.0, hue: 0.0, postSaturation: 1.0 }, shadows: { saturation: 1.0, contrast: 1.0, gamma: 1.0, gain: 1.0, lift: 0.0 }, midtones: { saturation: 1.0, contrast: 1.0, gamma: 1.0, gain: 1.0, lift: 0.0 }, highlights: { saturation: 1.0, contrast: 1.0, gamma: 1.0, gain: 1.0, lift: 0.0 } },
    sharpening: { enabled: false, sharpeningStrength: 0.6, denoise: false },
    ssao: null,
    depthOfField: null,
    motionBlur: null,
  },
  qualityPreset: 'high',

  setParticle: (entityId, data) => {
    if (dispatchCommand) dispatchCommand('set_particle', { entityId, ...data });
  },
  removeParticle: (entityId) => {
    if (dispatchCommand) dispatchCommand('remove_particle', { entityId });
  },
  toggleParticle: (entityId, enabled) => {
    if (dispatchCommand) dispatchCommand('toggle_particle', { entityId, enabled });
  },
  setParticlePreset: (entityId, preset) => {
    if (dispatchCommand) dispatchCommand('set_particle_preset', { entityId, preset });
  },
  playParticle: (entityId) => {
    if (dispatchCommand) dispatchCommand('play_particle', { entityId });
  },
  stopParticle: (entityId) => {
    if (dispatchCommand) dispatchCommand('stop_particle', { entityId });
  },
  burstParticle: (entityId, count) => {
    if (dispatchCommand) dispatchCommand('burst_particle', { entityId, count });
  },
  setEntityParticle: (_entityId, data, enabled) => set({ primaryParticle: data, particleEnabled: enabled }),
  setPrimaryParticle: (data, enabled) => set({ primaryParticle: data, particleEnabled: enabled }),
  updatePostProcessing: (partial) => {
    const state = get();
    set({ postProcessing: { ...state.postProcessing, ...partial } });
    if (dispatchCommand) dispatchCommand('update_post_processing', partial);
  },
  setPostProcessing: (data) => set({ postProcessing: data }),
  setQualityPreset: (preset) => {
    set({ qualityPreset: preset });
    if (dispatchCommand) dispatchCommand('set_quality_preset', { preset });
  },
  setQualityFromEngine: (data) => {
    // Implementation from original store
    set({ qualityPreset: (data as { preset: string }).preset as QualityPreset });
  },
  updateBloom: (partial) => {
    const state = get();
    set({ postProcessing: { ...state.postProcessing, bloom: { ...state.postProcessing.bloom, ...(partial as object) } } });
  },
  updateChromaticAberration: (partial) => {
    const state = get();
    set({ postProcessing: { ...state.postProcessing, chromaticAberration: { ...state.postProcessing.chromaticAberration, ...(partial as object) } } });
  },
  updateColorGrading: (partial) => {
    const state = get();
    set({ postProcessing: { ...state.postProcessing, colorGrading: { ...state.postProcessing.colorGrading, ...(partial as object) } } });
  },
  updateSharpening: (partial) => {
    const state = get();
    set({ postProcessing: { ...state.postProcessing, sharpening: { ...state.postProcessing.sharpening, ...(partial as object) } } });
  },
  updateSsao: (data) => {
    const state = get();
    set({ postProcessing: { ...state.postProcessing, ssao: data as  { quality: 'low' | 'medium' | 'high' | 'ultra' } | null } });
  },
  updateDepthOfField: (data) => {
    const state = get();
    set({ postProcessing: { ...state.postProcessing, depthOfField: data as never } });
  },
  updateMotionBlur: (data) => {
    const state = get();
    set({ postProcessing: { ...state.postProcessing, motionBlur: data as never } });
  },
});
