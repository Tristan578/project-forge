/**
 * Query handlers - read-only operations that return scene/state data.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';

export const queryHandlers: Record<string, ToolHandler> = {
  get_scene_graph: async (_args, { store }) => {
    const { sceneGraph } = store;
    const summary = Object.values(sceneGraph.nodes).map((n) => ({
      id: n.entityId,
      name: n.name,
      parent: n.parentId,
      children: n.children,
      visible: n.visible,
    }));
    return { success: true, result: { entities: summary, count: summary.length } };
  },

  get_entity_details: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const node = store.sceneGraph.nodes[p.data.entityId];
    if (!node) return { success: false, error: `Entity not found: ${p.data.entityId}` };
    return { success: true, result: { name: node.name, components: node.components, visible: node.visible, children: node.children } };
  },

  get_selection: async (_args, { store }) => {
    return { success: true, result: { selectedIds: [...store.selectedIds], primaryId: store.primaryId } };
  },

  get_camera_state: async (_args, { store }) => {
    return { success: true, result: { preset: store.currentCameraPreset } };
  },

  get_mode: async (_args, { store }) => {
    return { success: true, result: { mode: store.engineMode } };
  },

  get_physics: async (_args, { store }) => {
    return {
      success: true,
      result: {
        physics: store.primaryPhysics,
        enabled: store.physicsEnabled,
      },
    };
  },

  get_script: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const script = store.allScripts[p.data.entityId];
    if (!script) return { success: true, result: { hasScript: false } };
    return { success: true, result: { hasScript: true, source: script.source, enabled: script.enabled, template: script.template } };
  },

  get_audio: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const audio = store.primaryAudio;
    if (!audio) return { success: true, result: { hasAudio: false } };
    return { success: true, result: { hasAudio: true, ...audio } };
  },

  get_audio_buses: async (_args, { store }) => {
    return {
      success: true,
      result: { buses: store.audioBuses, count: store.audioBuses.length },
    };
  },

  get_animation_state: async (_args, { store }) => {
    const anim = store.primaryAnimation;
    if (!anim) return { success: true, result: { hasAnimation: false } };
    return { success: true, result: { hasAnimation: true, ...anim } };
  },

  list_animations: async (_args, { store }) => {
    const anim = store.primaryAnimation;
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

  get_animation_graph: async (args) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    return { success: true, result: { message: `Querying animation graph for ${p.data.entityId}` } };
  },

  get_scene_name: async (_args, { store }) => {
    return { success: true, result: { sceneName: store.sceneName, modified: store.sceneModified } };
  },

  get_input_bindings: async (_args, { store }) => {
    return {
      success: true,
      result: {
        bindings: store.inputBindings,
        preset: store.inputPreset,
        count: store.inputBindings.length,
      },
    };
  },

  get_input_state: async (_args, { store }) => {
    return {
      success: true,
      result: { message: 'Input state is only available during Play mode', mode: store.engineMode },
    };
  },

  get_joint: async (_args, { store }) => {
    return { success: true, result: { joint: store.primaryJoint } };
  },

  get_terrain: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const terrainData = store.terrainData[p.data.entityId];
    if (!terrainData) return { success: false, error: 'Entity is not a terrain' };
    return { success: true, result: { terrainData } };
  },

  list_assets: async (_args, { store }) => {
    const assets = Object.values(store.assetRegistry);
    return {
      success: true,
      result: {
        assets: assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, fileSize: a.fileSize })),
        count: assets.length,
      },
    };
  },

  get_particle: async (_args, { store }) => {
    const particle = store.primaryParticle;
    const enabled = store.particleEnabled;
    return { success: true, result: { particle, enabled } };
  },

  get_export_status: async (_args, { store }) => {
    return {
      success: true,
      result: { isExporting: store.isExporting, engineMode: store.engineMode },
    };
  },

  get_quality_settings: async (_args, { store }) => {
    return { success: true, result: { preset: store.qualityPreset } };
  },

  get_animation_clip: async (_args, { store }) => {
    const clipState = store.primaryAnimationClip;
    return { success: true, result: clipState || { message: 'No animation clip on selected entity' } };
  },

  get_sprite: async (args, { store }) => {
    const p = parseArgs(z.object({ entity_id: zEntityId }), args);
    if (p.error) return p.error;
    const spriteData = store.sprites[p.data.entity_id];
    if (!spriteData) {
      return { success: false, error: 'No sprite data for this entity' };
    }
    return { success: true, result: spriteData };
  },

  get_physics2d: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const data = store.physics2d[p.data.entityId];
    if (!data) return { success: false, error: 'No 2D physics data' };
    return { success: true, result: { data } };
  },

  get_tilemap: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const tilemapData = store.tilemaps[p.data.entityId];
    if (!tilemapData) {
      return { success: false, error: `No tilemap data for entity ${p.data.entityId}` };
    }
    return { success: true, result: tilemapData };
  },

  get_skeleton2d: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const skeleton = store.skeletons2d[p.data.entityId];
    if (!skeleton) {
      return { success: false, error: `No skeleton data for entity ${p.data.entityId}` };
    }
    return { success: true, result: skeleton };
  },

  get_game_components: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const components = store.allGameComponents[p.data.entityId] ?? [];
    return { success: true, result: { components, count: components.length } };
  },

  list_game_component_types: async (_args, _ctx) => {
    return {
      success: true,
      result: {
        types: [
          { name: 'character_controller', description: 'First-person or third-person movement controller' },
          { name: 'health', description: 'Health points with damage, invincibility, and respawning' },
          { name: 'collectible', description: 'Item that can be collected for score points' },
          { name: 'damage_zone', description: 'Area that damages entities with Health component' },
          { name: 'checkpoint', description: 'Checkpoint that updates respawn point for characters' },
          { name: 'teleporter', description: 'Teleports entities to a target position' },
          { name: 'moving_platform', description: 'Platform that moves between waypoints' },
          { name: 'trigger_zone', description: 'Zone that emits events when entered' },
          { name: 'spawner', description: 'Spawns entities at intervals or on trigger' },
          { name: 'follower', description: 'Follows a target entity' },
          { name: 'projectile', description: 'Moving object that deals damage on impact' },
          { name: 'win_condition', description: 'Defines game win condition (score, collect all, reach goal)' },
        ],
      },
    };
  },

  get_game_camera: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const camera = store.allGameCameras[p.data.entityId];
    const isActive = store.activeGameCameraId === p.data.entityId;
    return { success: true, result: { camera: camera || null, isActive } };
  },

  list_script_templates: async (_args, _ctx) => {
    const templates = [
      { id: 'character_controller', name: 'Character Controller', description: 'WASD + jump movement' },
      { id: 'collectible', name: 'Collectible', description: 'Rotating pickup item' },
      { id: 'rotating_object', name: 'Rotating Object', description: 'Continuous Y-axis rotation' },
      { id: 'follow_camera', name: 'Follow Camera', description: 'Smooth camera follow with offset' },
    ];
    return { success: true, result: { templates } };
  },

  get_token_balance: async (_args, _ctx) => {
    const { useUserStore } = await import('@/stores/userStore');
    const balance = useUserStore.getState().tokenBalance;
    return { success: true, result: balance ?? { message: 'Balance not loaded' } };
  },

  get_token_pricing: async (_args, _ctx) => {
    const { TOKEN_COSTS, TIER_MONTHLY_TOKENS, TOKEN_PACKAGES } = await import('@/lib/tokens/pricing');
    return { success: true, result: { costs: TOKEN_COSTS, monthlyAllocations: TIER_MONTHLY_TOKENS, packages: TOKEN_PACKAGES } };
  },

  get_sprite_generation_status: async (args, _ctx) => {
    const p = parseArgs(z.object({ jobId: z.string().min(1) }), args);
    if (p.error) return p.error;

    const { useGenerationStore } = await import('@/stores/generationStore');
    const jobs = useGenerationStore.getState().jobs;
    const job = Object.values(jobs).find((j) => j.jobId === p.data.jobId);

    if (!job) {
      return { success: false, error: `No generation job found with ID: ${p.data.jobId}` };
    }

    return {
      success: true,
      result: {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        resultUrl: job.resultUrl,
        error: job.error,
      },
    };
  },
};
