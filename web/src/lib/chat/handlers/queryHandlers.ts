/**
 * Query handlers - read-only operations that return scene/state data.
 */

import type { ToolHandler } from './types';

export const queryHandlers: Record<string, ToolHandler> = {
  get_scene_graph: async (args, { store }) => {
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
    const node = store.sceneGraph.nodes[args.entityId as string];
    if (!node) return { success: false, error: `Entity not found: ${args.entityId}` };
    return { success: true, result: { name: node.name, components: node.components, visible: node.visible, children: node.children } };
  },

  get_selection: async (args, { store }) => {
    return { success: true, result: { selectedIds: [...store.selectedIds], primaryId: store.primaryId } };
  },

  get_camera_state: async (args, { store }) => {
    return { success: true, result: { preset: store.currentCameraPreset } };
  },

  get_mode: async (args, { store }) => {
    return { success: true, result: { mode: store.engineMode } };
  },

  get_physics: async (args, { store }) => {
    return {
      success: true,
      result: {
        physics: store.primaryPhysics,
        enabled: store.physicsEnabled,
      },
    };
  },

  get_script: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    const script = store.allScripts[entityId];
    if (!script) return { success: true, result: { hasScript: false } };
    return { success: true, result: { hasScript: true, source: script.source, enabled: script.enabled, template: script.template } };
  },

  get_audio: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    const audio = store.primaryAudio;
    if (!audio) return { success: true, result: { hasAudio: false } };
    return { success: true, result: { hasAudio: true, ...audio } };
  },

  get_audio_buses: async (args, { store }) => {
    return {
      success: true,
      result: { buses: store.audioBuses, count: store.audioBuses.length },
    };
  },

  get_animation_state: async (args, { store }) => {
    const anim = store.primaryAnimation;
    if (!anim) return { success: true, result: { hasAnimation: false } };
    return { success: true, result: { hasAnimation: true, ...anim } };
  },

  list_animations: async (args, { store }) => {
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
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    // Query will be handled via QUERY_ANIMATION_GRAPH event
    return { success: true, result: { message: `Querying animation graph for ${entityId}` } };
  },

  get_scene_name: async (args, { store }) => {
    return { success: true, result: { sceneName: store.sceneName, modified: store.sceneModified } };
  },

  get_input_bindings: async (args, { store }) => {
    return {
      success: true,
      result: {
        bindings: store.inputBindings,
        preset: store.inputPreset,
        count: store.inputBindings.length,
      },
    };
  },

  get_input_state: async (args, { store }) => {
    // Input state is transient and only meaningful during Play mode
    return {
      success: true,
      result: { message: 'Input state is only available during Play mode', mode: store.engineMode },
    };
  },

  get_joint: async (args, { store }) => {
    return { success: true, result: { joint: store.primaryJoint } };
  },

  get_terrain: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    const terrainData = store.terrainData[entityId];
    if (!terrainData) return { success: false, error: 'Entity is not a terrain' };
    return { success: true, result: { terrainData } };
  },

  list_assets: async (args, { store }) => {
    const assets = Object.values(store.assetRegistry);
    return {
      success: true,
      result: {
        assets: assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, fileSize: a.fileSize })),
        count: assets.length,
      },
    };
  },

  get_particle: async (args, { store }) => {
    const particle = store.primaryParticle;
    const enabled = store.particleEnabled;
    return { success: true, result: { particle, enabled } };
  },

  get_export_status: async (args, { store }) => {
    return {
      success: true,
      result: { isExporting: store.isExporting, engineMode: store.engineMode },
    };
  },

  get_quality_settings: async (args, { store }) => {
    return { success: true, result: { preset: store.qualityPreset } };
  },

  get_animation_clip: async (args, { store }) => {
    const clipState = store.primaryAnimationClip;
    return { success: true, result: clipState || { message: 'No animation clip on selected entity' } };
  },

  get_sprite: async (args, { store }) => {
    const entityId = args.entity_id as string;
    const spriteData = store.sprites[entityId];
    if (!spriteData) {
      return { success: false, error: 'No sprite data for this entity' };
    }
    return { success: true, result: spriteData };
  },

  get_physics2d: async (args, { store }) => {
    const data = store.physics2d[args.entityId as string];
    if (!data) return { success: false, error: 'No 2D physics data' };
    return { success: true, result: { data } };
  },

  get_tilemap: async (args, { store }) => {
    const entityId = args.entityId as string;
    const tilemapData = store.tilemaps[entityId];
    if (!tilemapData) {
      return { success: false, error: `No tilemap data for entity ${entityId}` };
    }
    return { success: true, result: tilemapData };
  },

  get_skeleton2d: async (args, { store }) => {
    const entityId = args.entityId as string;
    const skeleton = store.skeletons2d[entityId];
    if (!skeleton) {
      return { success: false, error: `No skeleton data for entity ${entityId}` };
    }
    return { success: true, result: skeleton };
  },

  get_game_components: async (args, { store }) => {
    const entityId = args.entityId as string;
    const components = store.allGameComponents[entityId] ?? [];
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
    const { entityId } = args as { entityId: string };
    const camera = store.allGameCameras[entityId];
    const isActive = store.activeGameCameraId === entityId;
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
    // Client-side: return what we have in the user store
    const { useUserStore } = await import('@/stores/userStore');
    const balance = useUserStore.getState().tokenBalance;
    return { success: true, result: balance ?? { message: 'Balance not loaded' } };
  },

  get_token_pricing: async (_args, _ctx) => {
    const { TOKEN_COSTS, TIER_MONTHLY_TOKENS, TOKEN_PACKAGES } = await import('@/lib/tokens/pricing');
    return { success: true, result: { costs: TOKEN_COSTS, monthlyAllocations: TIER_MONTHLY_TOKENS, packages: TOKEN_PACKAGES } };
  },

  get_sprite_generation_status: async (args, _ctx) => {
    const jobId = args.jobId as string;
    if (!jobId) return { success: false, error: 'Missing jobId' };
    // TODO: Query generation store for job status
    return {
      success: true,
      result: {
        jobId,
        status: 'pending',
        progress: 0,
      },
    };
  },
};
