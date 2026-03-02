/**
 * Unit tests for the particleSlice — particles, post-processing, quality presets.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createParticleSlice, setParticleDispatcher, type ParticleSlice } from '../slices/particleSlice';

function createTestStore() {
  const store = { state: {} as ParticleSlice };
  const set = (partial: Partial<ParticleSlice> | ((s: ParticleSlice) => Partial<ParticleSlice>)) => {
    if (typeof partial === 'function') Object.assign(store.state, partial(store.state));
    else Object.assign(store.state, partial);
  };
  const get = () => store.state;
  store.state = createParticleSlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

describe('particleSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setParticleDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should have null primary particle', () => {
      expect(store.getState().primaryParticle).toBeNull();
    });

    it('should have particles disabled', () => {
      expect(store.getState().particleEnabled).toBe(false);
    });

    it('should have default quality preset', () => {
      expect(store.getState().qualityPreset).toBe('high');
    });

    it('should have default post-processing with bloom disabled', () => {
      expect(store.getState().postProcessing.bloom.enabled).toBe(false);
    });

    it('should have null SSAO, DOF, motion blur', () => {
      expect(store.getState().postProcessing.ssao).toBeNull();
      expect(store.getState().postProcessing.depthOfField).toBeNull();
      expect(store.getState().postProcessing.motionBlur).toBeNull();
    });
  });

  describe('Particle commands', () => {
    it('setParticle dispatches command', () => {
      store.getState().setParticle('ent-1', { preset: 'fire' });
      expect(mockDispatch).toHaveBeenCalledWith('set_particle', { entityId: 'ent-1', preset: 'fire' });
    });

    it('removeParticle dispatches command', () => {
      store.getState().removeParticle('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('remove_particle', { entityId: 'ent-1' });
    });

    it('toggleParticle dispatches with enabled flag', () => {
      store.getState().toggleParticle('ent-1', true);
      expect(mockDispatch).toHaveBeenCalledWith('toggle_particle', { entityId: 'ent-1', enabled: true });
    });

    it('setParticlePreset dispatches preset', () => {
      store.getState().setParticlePreset('ent-1', 'smoke');
      expect(mockDispatch).toHaveBeenCalledWith('set_particle_preset', { entityId: 'ent-1', preset: 'smoke' });
    });

    it('playParticle dispatches', () => {
      store.getState().playParticle('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('play_particle', { entityId: 'ent-1' });
    });

    it('stopParticle dispatches', () => {
      store.getState().stopParticle('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('stop_particle', { entityId: 'ent-1' });
    });

    it('burstParticle dispatches with count', () => {
      store.getState().burstParticle('ent-1', 50);
      expect(mockDispatch).toHaveBeenCalledWith('burst_particle', { entityId: 'ent-1', count: 50 });
    });
  });

  describe('Primary particle state', () => {
    it('setPrimaryParticle sets state without dispatch', () => {
      const data = { preset: 'fire', enabled: true } as never;
      store.getState().setPrimaryParticle(data, true);
      expect(store.getState().primaryParticle).toEqual(data);
      expect(store.getState().particleEnabled).toBe(true);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('setEntityParticle sets primary state', () => {
      store.getState().setEntityParticle('ent-1', null, false);
      expect(store.getState().primaryParticle).toBeNull();
      expect(store.getState().particleEnabled).toBe(false);
    });
  });

  describe('Post-processing', () => {
    it('updatePostProcessing merges and dispatches', () => {
      store.getState().updatePostProcessing({ bloom: { ...store.getState().postProcessing.bloom, enabled: true } });
      expect(store.getState().postProcessing.bloom.enabled).toBe(true);
      expect(mockDispatch).toHaveBeenCalledWith('update_post_processing', expect.objectContaining({ bloom: expect.objectContaining({ enabled: true }) }));
    });

    it('setPostProcessing replaces without dispatch', () => {
      const pp = store.getState().postProcessing;
      const updated = { ...pp, sharpening: { ...pp.sharpening, enabled: true } };
      store.getState().setPostProcessing(updated);
      expect(store.getState().postProcessing.sharpening.enabled).toBe(true);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('updateBloom merges bloom settings', () => {
      store.getState().updateBloom({ intensity: 0.5 });
      expect(store.getState().postProcessing.bloom.intensity).toBe(0.5);
      expect(store.getState().postProcessing.bloom.enabled).toBe(false); // unchanged
    });

    it('updateChromaticAberration merges CA settings', () => {
      store.getState().updateChromaticAberration({ enabled: true, intensity: 0.1 });
      expect(store.getState().postProcessing.chromaticAberration.enabled).toBe(true);
      expect(store.getState().postProcessing.chromaticAberration.intensity).toBe(0.1);
    });

    it('updateSharpening merges sharpening settings', () => {
      store.getState().updateSharpening({ enabled: true });
      expect(store.getState().postProcessing.sharpening.enabled).toBe(true);
    });

    it('updateSsao sets SSAO config', () => {
      store.getState().updateSsao({ quality: 'high' });
      expect(store.getState().postProcessing.ssao).toEqual({ quality: 'high' });
    });

    it('updateDepthOfField sets DOF config', () => {
      store.getState().updateDepthOfField({ focalDistance: 5.0 });
      expect(store.getState().postProcessing.depthOfField).toEqual({ focalDistance: 5.0 });
    });

    it('updateMotionBlur sets motion blur config', () => {
      store.getState().updateMotionBlur({ strength: 0.5 });
      expect(store.getState().postProcessing.motionBlur).toEqual({ strength: 0.5 });
    });
  });

  describe('Quality presets', () => {
    it('setQualityPreset updates and dispatches', () => {
      store.getState().setQualityPreset('ultra');
      expect(store.getState().qualityPreset).toBe('ultra');
      expect(mockDispatch).toHaveBeenCalledWith('set_quality_preset', { preset: 'ultra' });
    });

    it('setQualityFromEngine updates without dispatch', () => {
      store.getState().setQualityFromEngine({ preset: 'low' });
      expect(store.getState().qualityPreset).toBe('low');
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Dispatcher not set', () => {
    it('does not throw when dispatcher is null', () => {
      setParticleDispatcher(null as never);
      store = createTestStore();
      expect(() => store.getState().setParticle('e', {})).not.toThrow();
      expect(() => store.getState().setQualityPreset('low')).not.toThrow();
    });
  });
});
