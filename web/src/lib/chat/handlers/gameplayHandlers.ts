/**
 * Gameplay handlers for MCP commands.
 * Covers game components, game cameras, prefabs, export, and material library.
 */

import type { ToolHandler } from './types';
import type { GameCameraData, GameComponentData, EntityType, PlatformLoopMode, WinConditionType } from '@/stores/editorStore';
import { MATERIAL_PRESETS, getPresetsByCategory, saveCustomMaterial, deleteCustomMaterial, loadCustomMaterials } from '@/lib/materialPresets';

const VALID_COMPONENT_TYPES = [
  'character_controller', 'health', 'collectible', 'damage_zone', 'checkpoint',
  'teleporter', 'moving_platform', 'trigger_zone', 'spawner', 'follower',
  'projectile', 'win_condition',
].join(', ');

function buildGameComponentFromInput(
  type: string,
  props: Record<string, unknown>
): GameComponentData | null {
  switch (type) {
    case 'character_controller':
      return {
        type: 'characterController',
        characterController: {
          speed: (props.speed as number) ?? 5,
          jumpHeight: (props.jumpHeight as number) ?? 8,
          gravityScale: (props.gravityScale as number) ?? 1,
          canDoubleJump: (props.canDoubleJump as boolean) ?? false,
        },
      };
    case 'health':
      return {
        type: 'health',
        health: {
          maxHp: (props.maxHealth as number) ?? (props.maxHp as number) ?? 100,
          currentHp:
            (props.currentHealth as number) ??
            (props.currentHp as number) ??
            (props.maxHealth as number) ??
            (props.maxHp as number) ??
            100,
          invincibilitySecs: (props.invincibilitySecs as number) ?? 0.5,
          respawnOnDeath: (props.respawnOnDeath as boolean) ?? true,
          respawnPoint: (props.respawnPoint as [number, number, number]) ?? [0, 1, 0],
        },
      };
    case 'collectible':
      return {
        type: 'collectible',
        collectible: {
          value: (props.value as number) ?? 1,
          destroyOnCollect: (props.destroyOnCollect as boolean) ?? true,
          pickupSoundAsset: (props.pickupSoundAsset as string | null) ?? null,
          rotateSpeed: (props.rotateSpeed as number) ?? 90,
        },
      };
    case 'damage_zone':
      return {
        type: 'damageZone',
        damageZone: {
          damagePerSecond: (props.damagePerSecond as number) ?? 25,
          oneShot: (props.oneShot as boolean) ?? false,
        },
      };
    case 'checkpoint':
      return {
        type: 'checkpoint',
        checkpoint: {
          autoSave: (props.autoSave as boolean) ?? true,
        },
      };
    case 'teleporter':
      return {
        type: 'teleporter',
        teleporter: {
          targetPosition: (props.targetPosition as [number, number, number]) ?? [0, 1, 0],
          cooldownSecs: (props.cooldownSecs as number) ?? 1,
        },
      };
    case 'moving_platform':
      return {
        type: 'movingPlatform',
        movingPlatform: {
          speed: (props.speed as number) ?? 2,
          waypoints: (props.waypoints as [number, number, number][]) ?? [[0, 0, 0], [0, 3, 0]],
          pauseDuration: (props.pauseDuration as number) ?? 0.5,
          loopMode: (props.loopMode as PlatformLoopMode) ?? 'pingPong',
        },
      };
    case 'trigger_zone':
      return {
        type: 'triggerZone',
        triggerZone: {
          eventName: (props.eventName as string) ?? 'trigger',
          oneShot: (props.oneShot as boolean) ?? false,
        },
      };
    case 'spawner':
      return {
        type: 'spawner',
        spawner: {
          entityType: (props.entityType as string) ?? 'cube',
          intervalSecs: (props.intervalSecs as number) ?? 3,
          maxCount: (props.maxCount as number) ?? 5,
          spawnOffset: (props.spawnOffset as [number, number, number]) ?? [0, 1, 0],
          onTrigger: (props.onTrigger as string | null) ?? null,
        },
      };
    case 'follower':
      return {
        type: 'follower',
        follower: {
          targetEntityId: (props.targetEntityId as string | null) ?? null,
          speed: (props.speed as number) ?? 3,
          stopDistance: (props.stopDistance as number) ?? 1.5,
          lookAtTarget: (props.lookAtTarget as boolean) ?? true,
        },
      };
    case 'projectile':
      return {
        type: 'projectile',
        projectile: {
          speed: (props.speed as number) ?? 15,
          damage: (props.damage as number) ?? 10,
          lifetimeSecs: (props.lifetimeSecs as number) ?? 5,
          gravity: (props.gravity as boolean) ?? false,
          destroyOnHit: (props.destroyOnHit as boolean) ?? true,
        },
      };
    case 'win_condition':
      return {
        type: 'winCondition',
        winCondition: {
          conditionType: (props.conditionType as WinConditionType) ?? 'score',
          targetScore: (props.targetScore as number | null) ?? 10,
          targetEntityId: (props.targetEntityId as string | null) ?? null,
        },
      };
    default:
      return null;
  }
}

export const gameplayHandlers: Record<string, ToolHandler> = {
  add_game_component: async (args, ctx) => {
    const entityId = args.entityId as string;
    const componentType = args.componentType as string;
    const props = (args.properties as Record<string, unknown>) ?? {};

    const component = buildGameComponentFromInput(componentType, props);
    if (!component) {
      return { success: false, error: `Unknown component type: ${componentType}. Valid types: ${VALID_COMPONENT_TYPES}` };
    }
    ctx.store.addGameComponent(entityId, component);
    return { success: true, result: { message: `Added ${componentType}` } };
  },

  update_game_component: async (args, ctx) => {
    const entityId = args.entityId as string;
    const componentType = args.componentType as string;
    const props = (args.properties as Record<string, unknown>) ?? {};

    const component = buildGameComponentFromInput(componentType, props);
    if (!component) {
      return { success: false, error: `Unknown component type: ${componentType}. Valid types: ${VALID_COMPONENT_TYPES}` };
    }
    ctx.store.updateGameComponent(entityId, component);
    return { success: true };
  },

  remove_game_component: async (args, ctx) => {
    const entityId = args.entityId as string;
    const componentName = args.componentName as string;
    ctx.store.removeGameComponent(entityId, componentName);
    return { success: true };
  },

  get_game_components: async (args, ctx) => {
    const entityId = args.entityId as string;
    const components = ctx.store.allGameComponents[entityId] ?? [];
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
    const { entityId, mode, targetEntity, ...rest } = args as {
      entityId: string;
      mode: string;
      targetEntity?: string;
      [key: string]: unknown;
    };
    const cameraData: GameCameraData = {
      mode: mode as GameCameraData['mode'],
      targetEntity: targetEntity ?? null,
      ...rest,
    };
    ctx.store.setGameCamera(entityId, cameraData);
    return { success: true, result: { message: `Game camera set to ${mode} on entity ${entityId}` } };
  },

  set_active_game_camera: async (args, ctx) => {
    const { entityId } = args as { entityId: string };
    ctx.store.setActiveGameCamera(entityId);
    return { success: true, result: { message: `Active game camera set to ${entityId}` } };
  },

  camera_shake: async (args, ctx) => {
    const { entityId, intensity, duration } = args as { entityId: string; intensity: number; duration: number };
    ctx.store.cameraShake(entityId, intensity, duration);
    return { success: true, result: { message: `Camera shake triggered: intensity=${intensity}, duration=${duration}s` } };
  },

  get_game_camera: async (args, ctx) => {
    const { entityId } = args as { entityId: string };
    const camera = ctx.store.allGameCameras[entityId];
    const isActive = ctx.store.activeGameCameraId === entityId;
    return { success: true, result: { camera: camera || null, isActive } };
  },

  save_as_prefab: async (args, ctx) => {
    const { savePrefab } = await import('@/lib/prefabs/prefabStore');
    const entityId = args.entityId as string;
    const name = args.name as string;
    const category = (args.category as string) || 'uncategorized';
    const description = (args.description as string) || '';

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
    const prefabId = args.prefabId as string;
    const prefab = getPrefab(prefabId);
    if (!prefab) return { success: false, error: `Prefab not found: ${prefabId}` };

    const position = args.position as [number, number, number] | undefined;
    const name = args.name as string | undefined;

    ctx.store.spawnEntity(prefab.snapshot.entityType as EntityType, name || prefab.snapshot.name);

    if (prefab.snapshot.material && ctx.store.primaryId) {
      ctx.store.updateMaterial(ctx.store.primaryId, prefab.snapshot.material);
    }

    if (position && ctx.store.primaryId) {
      ctx.store.updateTransform(ctx.store.primaryId, 'position', position);
    }

    return { success: true, result: { message: `Instantiated prefab "${prefab.name}"` } };
  },

  list_prefabs: async (args, _ctx) => {
    const { listAllPrefabs, getPrefabsByCategory } = await import('@/lib/prefabs/prefabStore');
    const category = args.category as string | undefined;
    const prefabs = category ? getPrefabsByCategory(category) : listAllPrefabs();
    return { success: true, result: { prefabs: prefabs.map(p => ({ id: p.id, name: p.name, category: p.category, description: p.description })) } };
  },

  delete_prefab: async (args, _ctx) => {
    const { deletePrefab } = await import('@/lib/prefabs/prefabStore');
    const deleted = deletePrefab(args.prefabId as string);
    return deleted ? { success: true, result: { message: 'Prefab deleted' } } : { success: false, error: 'Prefab not found' };
  },

  get_prefab: async (args, _ctx) => {
    const { getPrefab } = await import('@/lib/prefabs/prefabStore');
    const prefab = getPrefab(args.prefabId as string);
    return prefab ? { success: true, result: prefab } : { success: false, error: 'Prefab not found' };
  },

  export_game: async (args, ctx) => {
    const { exportGame, downloadBlob } = await import('@/lib/export/exportEngine');

    ctx.store.setExporting(true);
    try {
      const resolutionInput = (args.resolution as string) || 'responsive';
      let resolution: 'responsive' | '1920x1080' | '1280x720' = 'responsive';
      if (resolutionInput === '1920x1080' || resolutionInput === '1280x720') {
        resolution = resolutionInput;
      }

      const blob = await exportGame({
        title: (args.title as string) || ctx.store.sceneName,
        mode: (args.mode as 'single-html' | 'zip') || 'single-html',
        resolution,
        bgColor: '#18181b',
        includeDebug: false,
      });

      const filename = `${((args.title as string) || ctx.store.sceneName).replace(/[^a-z0-9_-]/gi, '_')}.html`;
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
    const category = args.category as string | undefined;
    const presets = category
      ? getPresetsByCategory(category)
      : MATERIAL_PRESETS;
    return {
      success: true,
      result: presets.map((p) => ({ id: p.id, name: p.name, category: p.category, description: p.description })),
    };
  },

  save_material_to_library: async (args, ctx) => {
    const name = args.name as string;
    if (!name) return { success: false, error: 'name is required' };
    const entityId = (args.entityId as string) || ctx.store.primaryId;
    if (!entityId) return { success: false, error: 'No entity selected' };
    const mat = ctx.store.primaryMaterial;
    if (!mat) return { success: false, error: 'Selected entity has no material' };
    const saved = saveCustomMaterial(name, mat);
    return { success: true, result: { id: saved.id, name: saved.name } };
  },

  delete_library_material: async (args, _ctx) => {
    const materialId = args.materialId as string;
    if (!materialId) return { success: false, error: 'materialId is required' };
    deleteCustomMaterial(materialId);
    return { success: true, result: `Deleted custom material ${materialId}` };
  },

  list_custom_materials: async (_args, _ctx) => {
    const customs = loadCustomMaterials();
    return {
      success: true,
      result: customs.map((m) => ({ id: m.id, name: m.name })),
    };
  },
};
