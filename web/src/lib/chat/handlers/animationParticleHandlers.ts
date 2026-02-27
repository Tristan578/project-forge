/**
 * Animation and particle handlers for MCP commands.
 * Covers particles, GLTF animation playback, and keyframe animation clips.
 */

import type { ToolHandler } from './types';
import type { ParticlePreset } from '@/stores/editorStore';

export const animationParticleHandlers: Record<string, ToolHandler> = {
  set_particle: async (args, ctx) => {
    const entityId = args.entityId as string;
    const particleData = { ...args } as Record<string, unknown>;
    delete particleData.entityId;
    ctx.store.setParticle(entityId, particleData);
    return { success: true, result: { message: `Set particles on entity: ${entityId}` } };
  },

  remove_particle: async (args, ctx) => {
    const entityId = args.entityId as string;
    ctx.store.removeParticle(entityId);
    return { success: true, result: { message: `Removed particles from entity: ${entityId}` } };
  },

  toggle_particle: async (args, ctx) => {
    const entityId = args.entityId as string;
    const enabled = args.enabled as boolean;
    ctx.store.toggleParticle(entityId, enabled);
    return { success: true, result: { message: `${enabled ? 'Enabled' : 'Disabled'} particles on entity: ${entityId}` } };
  },

  set_particle_preset: async (args, ctx) => {
    const entityId = args.entityId as string;
    const preset = args.preset as ParticlePreset;
    ctx.store.setParticlePreset(entityId, preset);
    return { success: true, result: { message: `Applied ${preset} preset to entity: ${entityId}` } };
  },

  play_particle: async (args, ctx) => {
    const entityId = args.entityId as string;
    ctx.store.playParticle(entityId);
    return { success: true, result: { message: `Started particles on entity: ${entityId}` } };
  },

  stop_particle: async (args, ctx) => {
    const entityId = args.entityId as string;
    ctx.store.stopParticle(entityId);
    return { success: true, result: { message: `Stopped particles on entity: ${entityId}` } };
  },

  burst_particle: async (args, ctx) => {
    const entityId = args.entityId as string;
    const count = args.count as number | undefined;
    ctx.store.burstParticle(entityId, count);
    return { success: true, result: { message: `Burst ${count ?? 100} particles on entity: ${entityId}` } };
  },

  get_particle: async (_args, ctx) => {
    const particle = ctx.store.primaryParticle;
    const enabled = ctx.store.particleEnabled;
    return { success: true, result: { particle, enabled } };
  },

  play_animation: async (args, ctx) => {
    const entityId = args.entityId as string;
    const clipName = args.clipName as string;
    if (!entityId || !clipName) return { success: false, error: 'Missing entityId or clipName' };
    const crossfadeSecs = (args.crossfadeSecs as number) ?? 0.3;
    ctx.store.playAnimation(entityId, clipName, crossfadeSecs);
    return { success: true, result: { message: `Playing animation "${clipName}" on ${entityId}` } };
  },

  pause_animation: async (args, ctx) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    ctx.store.pauseAnimation(entityId);
    return { success: true, result: { message: `Paused animation on ${entityId}` } };
  },

  resume_animation: async (args, ctx) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    ctx.store.resumeAnimation(entityId);
    return { success: true, result: { message: `Resumed animation on ${entityId}` } };
  },

  stop_animation: async (args, ctx) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    ctx.store.stopAnimation(entityId);
    return { success: true, result: { message: `Stopped animation on ${entityId}` } };
  },

  seek_animation: async (args, ctx) => {
    const entityId = args.entityId as string;
    const timeSecs = args.timeSecs as number;
    if (!entityId || timeSecs === undefined) return { success: false, error: 'Missing entityId or timeSecs' };
    ctx.store.seekAnimation(entityId, timeSecs);
    return { success: true, result: { message: `Seeked to ${timeSecs}s on ${entityId}` } };
  },

  set_animation_speed: async (args, ctx) => {
    const entityId = args.entityId as string;
    const speed = args.speed as number;
    if (!entityId || speed === undefined) return { success: false, error: 'Missing entityId or speed' };
    ctx.store.setAnimationSpeed(entityId, speed);
    return { success: true, result: { message: `Set animation speed to ${speed}x on ${entityId}` } };
  },

  set_animation_loop: async (args, ctx) => {
    const entityId = args.entityId as string;
    const looping = args.looping as boolean;
    if (!entityId || looping === undefined) return { success: false, error: 'Missing entityId or looping' };
    ctx.store.setAnimationLoop(entityId, looping);
    return { success: true, result: { message: `Set animation loop=${looping} on ${entityId}` } };
  },

  get_animation_state: async (_args, ctx) => {
    const anim = ctx.store.primaryAnimation;
    if (!anim) return { success: true, result: { hasAnimation: false } };
    return { success: true, result: { hasAnimation: true, ...anim } };
  },

  list_animations: async (_args, ctx) => {
    const anim = ctx.store.primaryAnimation;
    if (!anim || anim.availableClips.length === 0) {
      return { success: true, result: { clips: [], count: 0 } };
    }
    return {
      success: true,
      result: {
        clips: anim.availableClips.map((c) => ({ name: c.name, duration: c.durationSecs })),
        count: anim.availableClips.length,
        activeClip: anim.activeClipName,
        isPlaying: anim.isPlaying,
      },
    };
  },

  set_animation_blend_weight: async (args, ctx) => {
    const entityId = args.entityId as string;
    const clipName = args.clipName as string;
    const weight = args.weight as number;
    if (!entityId || !clipName || weight === undefined) {
      return { success: false, error: 'Missing entityId, clipName, or weight' };
    }
    ctx.store.setAnimationBlendWeight(entityId, clipName, weight);
    return { success: true, result: { message: `Set blend weight for "${clipName}" to ${weight.toFixed(2)} on ${entityId}` } };
  },

  set_clip_speed: async (args, ctx) => {
    const entityId = args.entityId as string;
    const clipName = args.clipName as string;
    const speed = args.speed as number;
    if (!entityId || !clipName || speed === undefined) {
      return { success: false, error: 'Missing entityId, clipName, or speed' };
    }
    ctx.store.setClipSpeed(entityId, clipName, speed);
    return { success: true, result: { message: `Set speed for "${clipName}" to ${speed}x on ${entityId}` } };
  },

  get_animation_graph: async (args, _ctx) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    return { success: true, result: { message: `Querying animation graph for ${entityId}` } };
  },

  // --- Keyframe animation clip commands (Phase D-2) ---
  create_animation_clip: async (args, ctx) => {
    ctx.store.createAnimationClip(
      args.entityId as string,
      args.duration as number | undefined,
      args.playMode as string | undefined,
    );
    return { success: true, result: { message: 'Animation clip created' } };
  },

  add_clip_keyframe: async (args, ctx) => {
    ctx.store.addClipKeyframe(
      args.entityId as string,
      args.target as string,
      args.time as number,
      args.value as number,
      args.interpolation as string | undefined,
    );
    return { success: true, result: { message: 'Keyframe added' } };
  },

  remove_clip_keyframe: async (args, ctx) => {
    ctx.store.removeClipKeyframe(
      args.entityId as string,
      args.target as string,
      args.time as number,
    );
    return { success: true, result: { message: 'Keyframe removed' } };
  },

  update_clip_keyframe: async (args, ctx) => {
    ctx.store.updateClipKeyframe(
      args.entityId as string,
      args.target as string,
      args.time as number,
      args.value as number | undefined,
      args.interpolation as string | undefined,
      args.newTime as number | undefined,
    );
    return { success: true, result: { message: 'Keyframe updated' } };
  },

  set_clip_property: async (args, ctx) => {
    ctx.store.setClipProperty(
      args.entityId as string,
      args.duration as number | undefined,
      args.playMode as string | undefined,
      args.speed as number | undefined,
      args.autoplay as boolean | undefined,
    );
    return { success: true, result: { message: 'Clip property updated' } };
  },

  preview_clip: async (args, ctx) => {
    ctx.store.previewClip(
      args.entityId as string,
      args.action as 'play' | 'stop' | 'seek',
      args.seekTime as number | undefined,
    );
    return { success: true, result: { message: `Animation preview ${args.action}` } };
  },

  remove_animation_clip: async (args, ctx) => {
    ctx.store.removeAnimationClip(args.entityId as string);
    return { success: true, result: { message: 'Animation clip removed' } };
  },

  get_animation_clip: async (_args, ctx) => {
    const clipState = ctx.store.primaryAnimationClip;
    return { success: true, result: clipState || { message: 'No animation clip on selected entity' } };
  },
};
