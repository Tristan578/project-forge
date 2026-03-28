/**
 * Gameplay handlers for MCP commands.
 * Covers game components, game cameras, prefabs, export, and material library.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, zVec3, parseArgs } from './types';
import type { GameCameraData, EntityType } from '@/stores/editorStore';
import { MATERIAL_PRESETS, getPresetsByCategory, saveCustomMaterial, deleteCustomMaterial, loadCustomMaterials } from '@/lib/materialPresets';
import { buildGameComponentFromInput } from './helpers';

const VALID_COMPONENT_TYPES = [
  'character_controller', 'health', 'collectible', 'damage_zone', 'checkpoint',
  'teleporter', 'moving_platform', 'trigger_zone', 'spawner', 'follower',
  'projectile', 'win_condition',
].join(', ');

// Zod schema for the properties bag passed to game components — any shape is
// accepted here; individual fields are coerced inside buildGameComponentFromInput.
const zPropertiesBag = z.record(z.string(), z.unknown()).optional();

// Game camera mode enum
const zGameCameraMode = z.enum(['thirdPersonFollow', 'firstPerson', 'sideScroller', 'topDown', 'fixed', 'orbital']);

export const gameplayHandlers: Record<string, ToolHandler> = {
  add_game_component: async (args, ctx) => {
    const p = parseArgs(z.object({
      entityId: zEntityId,
      componentType: z.string().min(1),
      properties: zPropertiesBag,
    }), args);
    if (p.error) return p.error;

    const props = p.data.properties ?? {};
    const component = buildGameComponentFromInput(p.data.componentType, props);
    if (!component) {
      return { success: false, error: `Unknown component type: ${p.data.componentType}. Valid types: ${VALID_COMPONENT_TYPES}` };
    }
    ctx.store.addGameComponent(p.data.entityId, component);
    return { success: true, result: { message: `Added ${p.data.componentType}` } };
  },

  update_game_component: async (args, ctx) => {
    const p = parseArgs(z.object({
      entityId: zEntityId,
      componentType: z.string().min(1),
      properties: zPropertiesBag,
    }), args);
    if (p.error) return p.error;

    const props = p.data.properties ?? {};
    const component = buildGameComponentFromInput(p.data.componentType, props);
    if (!component) {
      return { success: false, error: `Unknown component type: ${p.data.componentType}. Valid types: ${VALID_COMPONENT_TYPES}` };
    }
    ctx.store.updateGameComponent(p.data.entityId, component);
    return { success: true };
  },

  remove_game_component: async (args, ctx) => {
    const p = parseArgs(z.object({
      entityId: zEntityId,
      componentName: z.string().min(1),
    }), args);
    if (p.error) return p.error;
    ctx.store.removeGameComponent(p.data.entityId, p.data.componentName);
    return { success: true };
  },

  get_game_components: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const components = ctx.store.allGameComponents[p.data.entityId] ?? [];
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

  set_game_camera: async (args, ctx) => {
    const p = parseArgs(z.object({
      entityId: zEntityId,
      mode: zGameCameraMode,
      targetEntity: z.string().optional(),
      followDistance: z.number().optional(),
      followHeight: z.number().optional(),
      followLookAhead: z.number().optional(),
      followSmoothing: z.number().optional(),
      firstPersonHeight: z.number().optional(),
      firstPersonMouseSensitivity: z.number().optional(),
      sideScrollerDistance: z.number().optional(),
      sideScrollerHeight: z.number().optional(),
      topDownHeight: z.number().optional(),
      topDownAngle: z.number().optional(),
      orbitalDistance: z.number().optional(),
      orbitalAutoRotateSpeed: z.number().optional(),
    }), args);
    if (p.error) return p.error;

    const { entityId, mode, targetEntity, ...rest } = p.data;
    const cameraData: GameCameraData = {
      mode,
      targetEntity: targetEntity ?? null,
      ...rest,
    };
    ctx.store.setGameCamera(entityId, cameraData);
    return { success: true, result: { message: `Game camera set to ${mode} on entity ${entityId}` } };
  },

  set_active_game_camera: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.setActiveGameCamera(p.data.entityId);
    return { success: true, result: { message: `Active game camera set to ${p.data.entityId}` } };
  },

  camera_shake: async (args, ctx) => {
    const p = parseArgs(z.object({
      entityId: zEntityId,
      intensity: z.number().finite(),
      duration: z.number().finite().nonnegative(),
    }), args);
    if (p.error) return p.error;
    ctx.store.cameraShake(p.data.entityId, p.data.intensity, p.data.duration);
    return { success: true, result: { message: `Camera shake triggered: intensity=${p.data.intensity}, duration=${p.data.duration}s` } };
  },

  get_game_camera: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const camera = ctx.store.allGameCameras[p.data.entityId];
    const isActive = ctx.store.activeGameCameraId === p.data.entityId;
    return { success: true, result: { camera: camera || null, isActive } };
  },

  save_as_prefab: async (args, ctx) => {
    const { savePrefab } = await import('@/lib/prefabs/prefabStore');
    const p = parseArgs(z.object({
      entityId: zEntityId,
      name: z.string().min(1),
      category: z.string().optional(),
      description: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    const { entityId, name, category = 'uncategorized', description = '' } = p.data;
    const transforms = ctx.store.primaryTransform;
    const snapshot = {
      entityType: 'cube',
      name: name,
      transform: transforms ? {
        position: transforms.position,
        rotation: transforms.rotation,
        scale: transforms.scale,
      } : { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
      material: ctx.store.primaryMaterial || undefined,
      light: ctx.store.primaryLight || undefined,
      physics: ctx.store.primaryPhysics || undefined,
      script: ctx.store.primaryScript || undefined,
      audio: ctx.store.primaryAudio || undefined,
      particle: ctx.store.primaryParticle || undefined,
    };

    const node = ctx.store.sceneGraph.nodes[entityId];
    if (node) {
      const components = node.components || [];
      if (components.includes('PointLight') || components.includes('DirectionalLight') || components.includes('SpotLight')) {
        snapshot.entityType = ctx.store.primaryLight?.lightType === 'point' ? 'point_light' : ctx.store.primaryLight?.lightType === 'directional' ? 'directional_light' : 'spot_light';
      }
    }

    const prefab = savePrefab(name, category, description, snapshot);
    return { success: true, result: { prefabId: prefab.id, message: `Saved "${name}" as prefab` } };
  },

  instantiate_prefab: async (args, ctx) => {
    const { getPrefab } = await import('@/lib/prefabs/prefabStore');
    const p = parseArgs(z.object({
      prefabId: z.string().min(1),
      position: zVec3.optional(),
      name: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    const prefab = getPrefab(p.data.prefabId);
    if (!prefab) return { success: false, error: `Prefab not found: ${p.data.prefabId}` };

    ctx.store.spawnEntity(prefab.snapshot.entityType as EntityType, p.data.name || prefab.snapshot.name);

    if (prefab.snapshot.material && ctx.store.primaryId) {
      ctx.store.updateMaterial(ctx.store.primaryId, prefab.snapshot.material);
    }

    if (p.data.position && ctx.store.primaryId) {
      ctx.store.updateTransform(ctx.store.primaryId, 'position', p.data.position);
    }

    return { success: true, result: { message: `Instantiated prefab "${prefab.name}"` } };
  },

  list_prefabs: async (args, _ctx) => {
    const { listAllPrefabs, getPrefabsByCategory } = await import('@/lib/prefabs/prefabStore');
    const p = parseArgs(z.object({ category: z.string().optional() }), args);
    if (p.error) return p.error;
    const prefabs = p.data.category ? getPrefabsByCategory(p.data.category) : listAllPrefabs();
    return { success: true, result: { prefabs: prefabs.map(pref => ({ id: pref.id, name: pref.name, category: pref.category, description: pref.description })) } };
  },

  delete_prefab: async (args, _ctx) => {
    const { deletePrefab } = await import('@/lib/prefabs/prefabStore');
    const p = parseArgs(z.object({ prefabId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const deleted = deletePrefab(p.data.prefabId);
    return deleted ? { success: true, result: { message: 'Prefab deleted' } } : { success: false, error: 'Prefab not found' };
  },

  get_prefab: async (args, _ctx) => {
    const { getPrefab } = await import('@/lib/prefabs/prefabStore');
    const p = parseArgs(z.object({ prefabId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const prefab = getPrefab(p.data.prefabId);
    return prefab ? { success: true, result: prefab } : { success: false, error: 'Prefab not found' };
  },

  export_game: async (args, ctx) => {
    const { exportGame, downloadBlob } = await import('@/lib/export/exportEngine');
    const p = parseArgs(z.object({
      title: z.string().optional(),
      mode: z.enum(['single-html', 'zip']).optional(),
      resolution: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    ctx.store.setExporting(true);
    try {
      const resolutionInput = p.data.resolution ?? 'responsive';
      let resolution: 'responsive' | '1920x1080' | '1280x720' = 'responsive';
      if (resolutionInput === '1920x1080' || resolutionInput === '1280x720') {
        resolution = resolutionInput;
      }

      const title = p.data.title ?? ctx.store.sceneName;
      const blob = await exportGame({
        title,
        mode: p.data.mode ?? 'single-html',
        resolution,
        bgColor: '#18181b',
        includeDebug: false,
      });

      const filename = `${title.replace(/[^a-z0-9_-]/gi, '_')}.html`;
      downloadBlob(blob, filename);

      return { success: true, result: { message: 'Game exported successfully', filename } };
    } finally {
      ctx.store.setExporting(false);
    }
  },

  get_export_status: async (_args, ctx) => {
    return {
      success: true,
      result: { isExporting: ctx.store.isExporting, engineMode: ctx.store.engineMode },
    };
  },

  list_material_presets: async (args, _ctx) => {
    const p = parseArgs(z.object({ category: z.string().optional() }), args);
    if (p.error) return p.error;
    const presets = p.data.category
      ? getPresetsByCategory(p.data.category)
      : MATERIAL_PRESETS;
    return {
      success: true,
      result: presets.map((preset) => ({ id: preset.id, name: preset.name, category: preset.category, description: preset.description })),
    };
  },

  save_material_to_library: async (args, ctx) => {
    const p = parseArgs(z.object({
      name: z.string().min(1),
      entityId: z.string().optional(),
    }), args);
    if (p.error) return p.error;
    const entityId = p.data.entityId || ctx.store.primaryId;
    if (!entityId) return { success: false, error: 'No entity selected' };
    const mat = ctx.store.primaryMaterial;
    if (!mat) return { success: false, error: 'Selected entity has no material' };
    const saved = saveCustomMaterial(p.data.name, mat);
    return { success: true, result: { id: saved.id, name: saved.name } };
  },

  delete_library_material: async (args, _ctx) => {
    const p = parseArgs(z.object({ materialId: z.string().min(1) }), args);
    if (p.error) return p.error;
    deleteCustomMaterial(p.data.materialId);
    return { success: true, result: `Deleted custom material ${p.data.materialId}` };
  },

  list_custom_materials: async (_args, _ctx) => {
    const customs = loadCustomMaterials();
    return {
      success: true,
      result: customs.map((m) => ({ id: m.id, name: m.name })),
    };
  },
};
