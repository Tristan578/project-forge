/**
 * Tests for animation and particle chat handlers.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { animationParticleHandlers } from '../animationParticleHandlers';
import { invokeHandler } from './handlerTestUtils';

describe('animationParticleHandlers', () => {
  // --- Particle handlers ---
  describe('set_particle', () => {
    it('calls setParticle with entityId stripped from data', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'set_particle', {
        entityId: 'ent-1', preset: 'fire', maxParticles: 500,
      });
      expect(result.success).toBe(true);
      expect(store.setParticle).toHaveBeenCalledWith('ent-1', { preset: 'fire', maxParticles: 500 });
    });
  });

  describe('remove_particle', () => {
    it('calls removeParticle', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'remove_particle', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.removeParticle).toHaveBeenCalledWith('ent-1');
    });
  });

  describe('toggle_particle', () => {
    it('calls toggleParticle with enabled', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'toggle_particle', { entityId: 'ent-1', enabled: true });
      expect(result.success).toBe(true);
      expect(store.toggleParticle).toHaveBeenCalledWith('ent-1', true);
    });
  });

  describe('set_particle_preset', () => {
    it('calls setParticlePreset', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'set_particle_preset', { entityId: 'ent-1', preset: 'smoke' });
      expect(result.success).toBe(true);
      expect(store.setParticlePreset).toHaveBeenCalledWith('ent-1', 'smoke');
    });
  });

  describe('play_particle', () => {
    it('calls playParticle', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'play_particle', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.playParticle).toHaveBeenCalledWith('ent-1');
    });
  });

  describe('stop_particle', () => {
    it('calls stopParticle', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'stop_particle', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.stopParticle).toHaveBeenCalledWith('ent-1');
    });
  });

  describe('burst_particle', () => {
    it('calls burstParticle with count', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'burst_particle', { entityId: 'ent-1', count: 50 });
      expect(result.success).toBe(true);
      expect(store.burstParticle).toHaveBeenCalledWith('ent-1', 50);
    });

    it('defaults count to undefined', async () => {
      const { store } = await invokeHandler(animationParticleHandlers, 'burst_particle', { entityId: 'ent-1' });
      expect(store.burstParticle).toHaveBeenCalledWith('ent-1', undefined);
    });
  });

  describe('get_particle', () => {
    it('returns particle state', async () => {
      const { result } = await invokeHandler(animationParticleHandlers, 'get_particle', {}, {
        primaryParticle: { preset: 'fire' },
        particleEnabled: true,
      });
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)).toEqual({ particle: { preset: 'fire' }, enabled: true });
    });
  });

  // --- GLTF Animation handlers ---
  describe('play_animation', () => {
    it('calls playAnimation with default crossfade', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'play_animation', { entityId: 'ent-1', clipName: 'idle' });
      expect(result.success).toBe(true);
      expect(store.playAnimation).toHaveBeenCalledWith('ent-1', 'idle', 0.3);
    });

    it('fails without required params', async () => {
      const { result } = await invokeHandler(animationParticleHandlers, 'play_animation', {});
      expect(result.success).toBe(false);
    });
  });

  describe('pause_animation', () => {
    it('calls pauseAnimation', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'pause_animation', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.pauseAnimation).toHaveBeenCalledWith('ent-1');
    });

    it('fails without entityId', async () => {
      const { result } = await invokeHandler(animationParticleHandlers, 'pause_animation', {});
      expect(result.success).toBe(false);
    });
  });

  describe('resume_animation', () => {
    it('calls resumeAnimation', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'resume_animation', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.resumeAnimation).toHaveBeenCalledWith('ent-1');
    });
  });

  describe('stop_animation', () => {
    it('calls stopAnimation', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'stop_animation', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.stopAnimation).toHaveBeenCalledWith('ent-1');
    });
  });

  describe('seek_animation', () => {
    it('calls seekAnimation', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'seek_animation', { entityId: 'ent-1', timeSecs: 2.5 });
      expect(result.success).toBe(true);
      expect(store.seekAnimation).toHaveBeenCalledWith('ent-1', 2.5);
    });

    it('fails without timeSecs', async () => {
      const { result } = await invokeHandler(animationParticleHandlers, 'seek_animation', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  describe('set_animation_speed', () => {
    it('calls setAnimationSpeed', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'set_animation_speed', { entityId: 'ent-1', speed: 2.0 });
      expect(result.success).toBe(true);
      expect(store.setAnimationSpeed).toHaveBeenCalledWith('ent-1', 2.0);
    });
  });

  describe('set_animation_loop', () => {
    it('calls setAnimationLoop', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'set_animation_loop', { entityId: 'ent-1', looping: true });
      expect(result.success).toBe(true);
      expect(store.setAnimationLoop).toHaveBeenCalledWith('ent-1', true);
    });
  });

  describe('get_animation_state', () => {
    it('returns hasAnimation false when null', async () => {
      const { result } = await invokeHandler(animationParticleHandlers, 'get_animation_state', {});
      expect((result.result as Record<string, unknown>)).toEqual({ hasAnimation: false });
    });

    it('returns animation data when present', async () => {
      const anim = { entityId: 'ent-1', availableClips: [], activeClipName: null, isPlaying: false };
      const { result } = await invokeHandler(animationParticleHandlers, 'get_animation_state', {}, { primaryAnimation: anim });
      expect((result.result as Record<string, unknown>).hasAnimation).toBe(true);
    });
  });

  describe('list_animations', () => {
    it('returns empty when no animation', async () => {
      const { result } = await invokeHandler(animationParticleHandlers, 'list_animations', {});
      expect((result.result as Record<string, unknown>)).toEqual({ clips: [], count: 0 });
    });

    it('returns clip list', async () => {
      const anim = {
        availableClips: [{ name: 'idle', durationSecs: 2.0, nodeIndex: 0 }],
        activeClipName: 'idle',
        isPlaying: true,
      };
      const { result } = await invokeHandler(animationParticleHandlers, 'list_animations', {}, { primaryAnimation: anim });
      const r = result.result as Record<string, unknown>;
      expect(r.count).toBe(1);
      expect((r.clips as Record<string, unknown>[])[0]).toEqual({ name: 'idle', duration: 2.0 });
    });
  });

  describe('set_animation_blend_weight', () => {
    it('calls setAnimationBlendWeight', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'set_animation_blend_weight', {
        entityId: 'ent-1', clipName: 'walk', weight: 0.5,
      });
      expect(result.success).toBe(true);
      expect(store.setAnimationBlendWeight).toHaveBeenCalledWith('ent-1', 'walk', 0.5);
    });

    it('fails without required params', async () => {
      const { result } = await invokeHandler(animationParticleHandlers, 'set_animation_blend_weight', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  describe('set_clip_speed', () => {
    it('calls setClipSpeed', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'set_clip_speed', {
        entityId: 'ent-1', clipName: 'run', speed: 1.5,
      });
      expect(result.success).toBe(true);
      expect(store.setClipSpeed).toHaveBeenCalledWith('ent-1', 'run', 1.5);
    });
  });

  describe('get_animation_graph', () => {
    it('returns message', async () => {
      const { result } = await invokeHandler(animationParticleHandlers, 'get_animation_graph', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
    });

    it('fails without entityId', async () => {
      const { result } = await invokeHandler(animationParticleHandlers, 'get_animation_graph', {});
      expect(result.success).toBe(false);
    });
  });

  // --- Keyframe animation clip handlers ---
  describe('create_animation_clip', () => {
    it('calls createAnimationClip', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'create_animation_clip', { entityId: 'ent-1', duration: 3.0, playMode: 'loop' });
      expect(result.success).toBe(true);
      expect(store.createAnimationClip).toHaveBeenCalledWith('ent-1', 3.0, 'loop');
    });
  });

  describe('add_clip_keyframe', () => {
    it('calls addClipKeyframe', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'add_clip_keyframe', {
        entityId: 'ent-1', target: 'position_x', time: 0.5, value: 10, interpolation: 'linear',
      });
      expect(result.success).toBe(true);
      expect(store.addClipKeyframe).toHaveBeenCalledWith('ent-1', 'position_x', 0.5, 10, 'linear');
    });
  });

  describe('remove_clip_keyframe', () => {
    it('calls removeClipKeyframe', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'remove_clip_keyframe', {
        entityId: 'ent-1', target: 'rotation_y', time: 1.0,
      });
      expect(result.success).toBe(true);
      expect(store.removeClipKeyframe).toHaveBeenCalledWith('ent-1', 'rotation_y', 1.0);
    });
  });

  describe('update_clip_keyframe', () => {
    it('calls updateClipKeyframe', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'update_clip_keyframe', {
        entityId: 'ent-1', target: 'scale_x', time: 0, value: 2.0, interpolation: 'ease_in', newTime: 0.5,
      });
      expect(result.success).toBe(true);
      expect(store.updateClipKeyframe).toHaveBeenCalledWith('ent-1', 'scale_x', 0, 2.0, 'ease_in', 0.5);
    });
  });

  describe('set_clip_property', () => {
    it('calls setClipProperty', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'set_clip_property', {
        entityId: 'ent-1', duration: 5.0, speed: 2.0,
      });
      expect(result.success).toBe(true);
      expect(store.setClipProperty).toHaveBeenCalledWith('ent-1', 5.0, undefined, 2.0, undefined);
    });
  });

  describe('preview_clip', () => {
    it('calls previewClip', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'preview_clip', {
        entityId: 'ent-1', action: 'play',
      });
      expect(result.success).toBe(true);
      expect(store.previewClip).toHaveBeenCalledWith('ent-1', 'play', undefined);
    });
  });

  describe('remove_animation_clip', () => {
    it('calls removeAnimationClip', async () => {
      const { result, store } = await invokeHandler(animationParticleHandlers, 'remove_animation_clip', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.removeAnimationClip).toHaveBeenCalledWith('ent-1');
    });
  });

  describe('get_animation_clip', () => {
    it('returns clip state', async () => {
      const clip = { tracks: [], duration: 2.0, playMode: 'loop' };
      const { result } = await invokeHandler(animationParticleHandlers, 'get_animation_clip', {}, { primaryAnimationClip: clip });
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)).toEqual(clip);
    });

    it('returns message when no clip', async () => {
      const { result } = await invokeHandler(animationParticleHandlers, 'get_animation_clip', {});
      expect((result.result as Record<string, unknown>).message).toBeDefined();
    });
  });
});
