/**
 * Animation and particle handlers for MCP commands.
 * Covers particles, GLTF animation playback, and keyframe animation clips.
 */

import { z } from 'zod';
import { zEntityId, parseArgs } from './types';
import type { ToolHandler } from './types';
import type { ParticlePreset } from '@/stores/editorStore';

export const animationParticleHandlers: Record<string, ToolHandler> = {
  set_particle: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }).passthrough(), args);
    if (p.error) return p.error;
    const { entityId, ...rest } = p.data as { entityId: string } & Record<string, unknown>;
    ctx.store.setParticle(entityId, rest);
    return { success: true, result: { message: `Set particles on entity: ${entityId}` } };
  },

  remove_particle: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.removeParticle(p.data.entityId);
    return { success: true, result: { message: `Removed particles from entity: ${p.data.entityId}` } };
  },

  toggle_particle: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId, enabled: z.boolean() }), args);
    if (p.error) return p.error;
    ctx.store.toggleParticle(p.data.entityId, p.data.enabled);
    return {
      success: true,
      result: { message: `${p.data.enabled ? 'Enabled' : 'Disabled'} particles on entity: ${p.data.entityId}` },
    };
  },

  set_particle_preset: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId, preset: z.string().min(1) }), args);
    if (p.error) return p.error;
    ctx.store.setParticlePreset(p.data.entityId, p.data.preset as ParticlePreset);
    return { success: true, result: { message: `Applied ${p.data.preset} preset to entity: ${p.data.entityId}` } };
  },

  play_particle: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.playParticle(p.data.entityId);
    return { success: true, result: { message: `Started particles on entity: ${p.data.entityId}` } };
  },

  stop_particle: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.stopParticle(p.data.entityId);
    return { success: true, result: { message: `Stopped particles on entity: ${p.data.entityId}` } };
  },

  burst_particle: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId, count: z.number().int().positive().optional() }), args);
    if (p.error) return p.error;
    ctx.store.burstParticle(p.data.entityId, p.data.count);
    return {
      success: true,
      result: { message: `Burst ${p.data.count ?? 100} particles on entity: ${p.data.entityId}` },
    };
  },

  get_particle: async (_args, ctx) => {
    const particle = ctx.store.primaryParticle;
    const enabled = ctx.store.particleEnabled;
    return { success: true, result: { particle, enabled } };
  },

  play_animation: async (args, ctx) => {
    const p = parseArgs(
      z.object({ entityId: zEntityId, clipName: z.string().min(1), crossfadeSecs: z.number().optional() }),
      args,
    );
    if (p.error) return p.error;
    const crossfadeSecs = p.data.crossfadeSecs ?? 0.3;
    ctx.store.playAnimation(p.data.entityId, p.data.clipName, crossfadeSecs);
    return {
      success: true,
      result: { message: `Playing animation "${p.data.clipName}" on ${p.data.entityId}` },
    };
  },

  pause_animation: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.pauseAnimation(p.data.entityId);
    return { success: true, result: { message: `Paused animation on ${p.data.entityId}` } };
  },

  resume_animation: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.resumeAnimation(p.data.entityId);
    return { success: true, result: { message: `Resumed animation on ${p.data.entityId}` } };
  },

  stop_animation: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.stopAnimation(p.data.entityId);
    return { success: true, result: { message: `Stopped animation on ${p.data.entityId}` } };
  },

  seek_animation: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId, timeSecs: z.number().finite() }), args);
    if (p.error) return p.error;
    ctx.store.seekAnimation(p.data.entityId, p.data.timeSecs);
    return { success: true, result: { message: `Seeked to ${p.data.timeSecs}s on ${p.data.entityId}` } };
  },

  set_animation_speed: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId, speed: z.number().finite() }), args);
    if (p.error) return p.error;
    ctx.store.setAnimationSpeed(p.data.entityId, p.data.speed);
    return {
      success: true,
      result: { message: `Set animation speed to ${p.data.speed}x on ${p.data.entityId}` },
    };
  },

  set_animation_loop: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId, looping: z.boolean() }), args);
    if (p.error) return p.error;
    ctx.store.setAnimationLoop(p.data.entityId, p.data.looping);
    return {
      success: true,
      result: { message: `Set animation loop=${p.data.looping} on ${p.data.entityId}` },
    };
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
    const p = parseArgs(
      z.object({ entityId: zEntityId, clipName: z.string().min(1), weight: z.number().finite() }),
      args,
    );
    if (p.error) return p.error;
    ctx.store.setAnimationBlendWeight(p.data.entityId, p.data.clipName, p.data.weight);
    return {
      success: true,
      result: {
        message: `Set blend weight for "${p.data.clipName}" to ${p.data.weight.toFixed(2)} on ${p.data.entityId}`,
      },
    };
  },

  set_clip_speed: async (args, ctx) => {
    const p = parseArgs(
      z.object({ entityId: zEntityId, clipName: z.string().min(1), speed: z.number().finite() }),
      args,
    );
    if (p.error) return p.error;
    ctx.store.setClipSpeed(p.data.entityId, p.data.clipName, p.data.speed);
    return {
      success: true,
      result: { message: `Set speed for "${p.data.clipName}" to ${p.data.speed}x on ${p.data.entityId}` },
    };
  },

  get_animation_graph: async (args, _ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    return { success: true, result: { message: `Querying animation graph for ${p.data.entityId}` } };
  },

  // --- Keyframe animation clip commands (Phase D-2) ---
  create_animation_clip: async (args, ctx) => {
    const p = parseArgs(
      z.object({ entityId: zEntityId, duration: z.number().positive().optional(), playMode: z.string().optional() }),
      args,
    );
    if (p.error) return p.error;
    ctx.store.createAnimationClip(p.data.entityId, p.data.duration, p.data.playMode);
    return { success: true, result: { message: 'Animation clip created' } };
  },

  add_clip_keyframe: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        target: z.string().min(1),
        time: z.number().finite(),
        value: z.number().finite(),
        interpolation: z.string().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    ctx.store.addClipKeyframe(p.data.entityId, p.data.target, p.data.time, p.data.value, p.data.interpolation);
    return { success: true, result: { message: 'Keyframe added' } };
  },

  remove_clip_keyframe: async (args, ctx) => {
    const p = parseArgs(
      z.object({ entityId: zEntityId, target: z.string().min(1), time: z.number().finite() }),
      args,
    );
    if (p.error) return p.error;
    ctx.store.removeClipKeyframe(p.data.entityId, p.data.target, p.data.time);
    return { success: true, result: { message: 'Keyframe removed' } };
  },

  update_clip_keyframe: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        target: z.string().min(1),
        time: z.number().finite(),
        value: z.number().finite().optional(),
        interpolation: z.string().optional(),
        newTime: z.number().finite().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    ctx.store.updateClipKeyframe(
      p.data.entityId,
      p.data.target,
      p.data.time,
      p.data.value,
      p.data.interpolation,
      p.data.newTime,
    );
    return { success: true, result: { message: 'Keyframe updated' } };
  },

  set_clip_property: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        duration: z.number().positive().optional(),
        playMode: z.string().optional(),
        speed: z.number().finite().optional(),
        autoplay: z.boolean().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    ctx.store.setClipProperty(p.data.entityId, p.data.duration, p.data.playMode, p.data.speed, p.data.autoplay);
    return { success: true, result: { message: 'Clip property updated' } };
  },

  preview_clip: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        action: z.enum(['play', 'stop', 'seek']),
        seekTime: z.number().finite().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    ctx.store.previewClip(p.data.entityId, p.data.action, p.data.seekTime);
    return { success: true, result: { message: `Animation preview ${p.data.action}` } };
  },

  remove_animation_clip: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.removeAnimationClip(p.data.entityId);
    return { success: true, result: { message: 'Animation clip removed' } };
  },

  get_animation_clip: async (_args, ctx) => {
    const clipState = ctx.store.primaryAnimationClip;
    return { success: true, result: clipState || { message: 'No animation clip on selected entity' } };
  },
};
