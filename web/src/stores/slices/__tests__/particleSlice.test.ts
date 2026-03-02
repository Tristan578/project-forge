import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createParticleSlice, setParticleDispatcher, type ParticleSlice } from '../particleSlice';

describe('particleSlice', () => {
  let store: ReturnType<typeof createSliceStore<ParticleSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setParticleDispatcher(mockDispatch);
    store = createSliceStore(createParticleSlice);
  });

  afterEach(() => {
    setParticleDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should start with default particle and post-processing state', () => {
      expect(store.getState().primaryParticle).toBeNull();
      expect(store.getState().particleEnabled).toBe(false);
      expect(store.getState().qualityPreset).toBe('high');
      expect(store.getState().postProcessing.bloom.enabled).toBe(false);
      expect(store.getState().postProcessing.chromaticAberration.enabled).toBe(false);
      expect(store.getState().postProcessing.colorGrading.enabled).toBe(false);
      expect(store.getState().postProcessing.sharpening.enabled).toBe(false);
      expect(store.getState().postProcessing.ssao).toBeNull();
      expect(store.getState().postProcessing.depthOfField).toBeNull();
      expect(store.getState().postProcessing.motionBlur).toBeNull();
    });
  });

  describe('particle commands', () => {
    it('setParticle should dispatch', () => {
      store.getState().setParticle('ent-1', { maxParticles: 1000 } as never);
      expect(mockDispatch).toHaveBeenCalledWith('set_particle', { entityId: 'ent-1', maxParticles: 1000 });
    });

    it('removeParticle should dispatch', () => {
      store.getState().removeParticle('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('remove_particle', { entityId: 'ent-1' });
    });

    it('toggleParticle should dispatch', () => {
      store.getState().toggleParticle('ent-1', true);
      expect(mockDispatch).toHaveBeenCalledWith('toggle_particle', { entityId: 'ent-1', enabled: true });
    });

    it('setParticlePreset should dispatch', () => {
      store.getState().setParticlePreset('ent-1', 'fire' as never);
      expect(mockDispatch).toHaveBeenCalledWith('set_particle_preset', { entityId: 'ent-1', preset: 'fire' });
    });

    it('playParticle should dispatch', () => {
      store.getState().playParticle('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('play_particle', { entityId: 'ent-1' });
    });

    it('stopParticle should dispatch', () => {
      store.getState().stopParticle('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('stop_particle', { entityId: 'ent-1' });
    });

    it('burstParticle should dispatch with count', () => {
      store.getState().burstParticle('ent-1', 50);
      expect(mockDispatch).toHaveBeenCalledWith('burst_particle', { entityId: 'ent-1', count: 50 });
    });

    it('burstParticle should dispatch without count', () => {
      store.getState().burstParticle('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('burst_particle', { entityId: 'ent-1', count: undefined });
    });
  });

  describe('particle state setters', () => {
    it('setEntityParticle should set primary particle', () => {
      const data = { maxParticles: 500, lifetime: 2.0 };
      store.getState().setEntityParticle('ent-1', data as never, true);

      expect(store.getState().primaryParticle).toEqual(data);
      expect(store.getState().particleEnabled).toBe(true);
    });

    it('setPrimaryParticle should set primary particle', () => {
      store.getState().setPrimaryParticle({ maxParticles: 200 } as never, false);

      expect(store.getState().primaryParticle).toEqual({ maxParticles: 200 });
      expect(store.getState().particleEnabled).toBe(false);
    });

    it('setPrimaryParticle should clear with null', () => {
      store.getState().setPrimaryParticle({ maxParticles: 100 } as never, true);
      store.getState().setPrimaryParticle(null, false);

      expect(store.getState().primaryParticle).toBeNull();
      expect(store.getState().particleEnabled).toBe(false);
    });
  });

  describe('post-processing', () => {
    it('updatePostProcessing should merge and dispatch', () => {
      store.getState().updatePostProcessing({ bloom: { ...store.getState().postProcessing.bloom, enabled: true } });

      expect(store.getState().postProcessing.bloom.enabled).toBe(true);
      expect(mockDispatch).toHaveBeenCalledWith('update_post_processing', expect.objectContaining({
        bloom: expect.objectContaining({ enabled: true }),
      }));
    });

    it('setPostProcessing should replace entire config', () => {
      const newConfig = {
        bloom: { enabled: true, intensity: 0.5, lowFrequencyBoost: 0.5, lowFrequencyBoostCurvature: 0.5, highPassFrequency: 1.0, prefilterThreshold: 0.0, prefilterThresholdSoftness: 0.0, compositeMode: 'additive', maxMipDimension: 256 },
        chromaticAberration: { enabled: true, intensity: 0.05, maxSamples: 16 },
        colorGrading: store.getState().postProcessing.colorGrading,
        sharpening: store.getState().postProcessing.sharpening,
        ssao: null,
        depthOfField: null,
        motionBlur: null,
      };
      store.getState().setPostProcessing(newConfig as never);
      expect(store.getState().postProcessing.bloom.enabled).toBe(true);
      expect(store.getState().postProcessing.chromaticAberration.intensity).toBe(0.05);
    });

    it('updateBloom should merge bloom settings', () => {
      store.getState().updateBloom({ enabled: true, intensity: 0.8 });
      expect(store.getState().postProcessing.bloom.enabled).toBe(true);
      expect(store.getState().postProcessing.bloom.intensity).toBe(0.8);
      // Other bloom settings unchanged
      expect(store.getState().postProcessing.bloom.lowFrequencyBoost).toBe(0.7);
    });

    it('updateChromaticAberration should merge settings', () => {
      store.getState().updateChromaticAberration({ enabled: true });
      expect(store.getState().postProcessing.chromaticAberration.enabled).toBe(true);
      expect(store.getState().postProcessing.chromaticAberration.intensity).toBe(0.02); // unchanged
    });

    it('updateColorGrading should merge settings', () => {
      store.getState().updateColorGrading({ enabled: true });
      expect(store.getState().postProcessing.colorGrading.enabled).toBe(true);
    });

    it('updateSharpening should merge settings', () => {
      store.getState().updateSharpening({ enabled: true, sharpeningStrength: 0.9 });
      expect(store.getState().postProcessing.sharpening.enabled).toBe(true);
      expect(store.getState().postProcessing.sharpening.sharpeningStrength).toBe(0.9);
    });

    it('updateSsao should set SSAO config', () => {
      store.getState().updateSsao({ quality: 'ultra' });
      expect(store.getState().postProcessing.ssao).toEqual({ quality: 'ultra' });
    });

    it('updateDepthOfField should set DOF config', () => {
      const dof = { focalLength: 50, aperture: 2.8 };
      store.getState().updateDepthOfField(dof);
      expect(store.getState().postProcessing.depthOfField).toEqual(dof);
    });

    it('updateMotionBlur should set motion blur config', () => {
      const mb = { samples: 8, intensity: 0.5 };
      store.getState().updateMotionBlur(mb);
      expect(store.getState().postProcessing.motionBlur).toEqual(mb);
    });
  });

  describe('quality preset', () => {
    it('setQualityPreset should set and dispatch', () => {
      store.getState().setQualityPreset('ultra');
      expect(store.getState().qualityPreset).toBe('ultra');
      expect(mockDispatch).toHaveBeenCalledWith('set_quality_preset', { preset: 'ultra' });
    });

    it('setQualityFromEngine should update preset', () => {
      store.getState().setQualityFromEngine({ preset: 'low' });
      expect(store.getState().qualityPreset).toBe('low');
    });
  });
});
