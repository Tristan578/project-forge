/**
 * Gameplay handlers for MCP commands.
 * Covers game components, game cameras, prefabs, export, and material library.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, zVec3, parseArgs } from './types';
import type { GameCameraData, EntityType } from '@/stores/editorStore';
import { MATERIAL_PRESETS, getPresetsByCategory, saveCustomMaterial, deleteCustomMaterial, loadCustomMaterials } from '@/lib/materialPresets';
import { buildStoreComponent, ENGINE_COMPONENT_TYPES, ENGINE_COMPONENT_CATALOG } from '@/lib/engine/gameComponentWire';
import { NUMERIC_CAMERA_FIELDS } from '@/lib/game/gameCameraPayload';

// Derived, not hand-listed: the hand-written list had silently fallen one type
// behind the engine (it omitted `dialogue_trigger`), so the AI was told that type
// was invalid and could never add one.
const VALID_COMPONENT_TYPES = ENGINE_COMPONENT_TYPES.join(', ');

// Zod schema for the properties bag passed to game components — any shape is
// accepted here; individual fields are coerced inside `buildStoreComponent`.
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
    const component = buildStoreComponent(p.data.componentType, props);
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
    const component = buildStoreComponent(p.data.componentType, props);
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

  // Derived from the same table `add_game_component` validates against, so the
  // catalogue the AI is shown can never drift from what the engine accepts. The
  // hand-written list this replaced had gone stale exactly that way — it never
  // mentioned `dialogue_trigger`, so the AI had no reason to ever add one.
  list_game_component_types: async (_args, _ctx) => {
    return { success: true, result: { types: ENGINE_COMPONENT_CATALOG } };
  },

  // The schema below IS the vocabulary the AI is taught, so a parameter it can
  // name but the engine cannot receive is worse than no parameter at all — the
  // model keeps emitting it and every call silently loses that intent. It listed
  // three such phantoms: `followLookAhead` (`ThirdPersonFollow` is
  // offset/damping/min_distance/max_distance/look_at_target/collision_avoidance
  // and nothing else), `sideScrollerHeight` (`SideScroller` is
  // z_offset/follow_y/y_bounds/damping — vertical framing comes from follow_y),
  // and `topDownAngle` (`TopDown` is height/damping/follow_rotation, no angle).
  set_game_camera: async (args, ctx) => {
    const p = parseArgs(z.object({
      entityId: zEntityId,
      mode: zGameCameraMode,
      // `zEntityId` (min 1), not a bare string: `parseGameCameraWire` normalizes
      // `''` back to `null` on the way in precisely because an empty id is
      // truthy-but-unresolvable to every consumer, so it must not be storable
      // on the way out either.
      targetEntity: zEntityId.optional(),
      followDistance: z.number().optional(),
      followHeight: z.number().optional(),
      followSmoothing: z.number().optional(),
      firstPersonHeight: z.number().optional(),
      firstPersonMouseSensitivity: z.number().optional(),
      sideScrollerDistance: z.number().optional(),
      topDownHeight: z.number().optional(),
      orbitalDistance: z.number().optional(),
      orbitalAutoRotateSpeed: z.number().optional(),
    }), args);
    if (p.error) return p.error;

    // Built key-by-key, never `{ ...rest }`: TypeScript's excess-property check
    // does not apply to properties introduced by a spread, so a spread would
    // type-check happily while carrying any key the schema happened to declare
    // straight into the store. `setGameCamera` then translates this authoring
    // shape into the engine's wire form via `buildSetGameCameraPayload`.
    const d = p.data;
    const cameraData: GameCameraData = { mode: d.mode, targetEntity: d.targetEntity ?? null };

    // Carry the EXISTING camera forward before applying this call's arguments.
    // This is an UPDATE verb but it replaces the whole `GameCameraData`, so every
    // field the caller left out came back as the engine's default: the LLM says
    // "raise the camera" and the follow smoothing the user tuned a turn ago is
    // gone. Same destructive-full-replace shape as PF-1123, and it reaches
    // `followOffsetX` — the one field with no control at all, whose entire job is
    // to survive — so a shoulder offset set here was lost on the next call.
    //
    // `NUMERIC_CAMERA_FIELDS` rather than a spread: the store's copy can come from
    // a loaded scene file, and the translator owns which of its fields hold a
    // number. `Object.hasOwn` on the map because `entityId` is LLM-chosen.
    if (Object.hasOwn(ctx.store.allGameCameras, d.entityId)) {
      const existing = ctx.store.allGameCameras[d.entityId];
      if (existing) {
        // The follow target is the field that decides whether the camera moves
        // AT ALL — `cameraModeNeedsTarget` lists five of the six modes as inert
        // without one, and the engine skips the whole update arm when
        // `target_entity` is `None`. So it is the most consequential field to
        // carry forward, not the least: without this, "raise the camera" detaches
        // it from the player and the game shows a motionless camera. The
        // inspector already does this deliberately (`handleModeChange` in
        // GameCameraInspector.tsx keeps `primaryGameCamera?.targetEntity`).
        if (d.targetEntity === undefined && existing.targetEntity) {
          cameraData.targetEntity = existing.targetEntity;
        }
        for (const key of NUMERIC_CAMERA_FIELDS) {
          const value = existing[key];
          if (typeof value === 'number' && Number.isFinite(value)) cameraData[key] = value;
        }
        // Engine-owned params the schema above cannot name (the schema covers 7 of
        // the engine's 19 wire params): an MCP client sets `fov: 100`, the user
        // then says "raise the camera to eye level 1.8", and without this the fov
        // is silently back to 75 — persisted, because `GameCameraData` is written
        // into `EntitySnapshot` and scene export.
        if (existing.engineParams) cameraData.engineParams = existing.engineParams;
      }
    }

    if (d.followDistance !== undefined) cameraData.followDistance = d.followDistance;
    if (d.followHeight !== undefined) cameraData.followHeight = d.followHeight;
    if (d.followSmoothing !== undefined) cameraData.followSmoothing = d.followSmoothing;
    if (d.firstPersonHeight !== undefined) cameraData.firstPersonHeight = d.firstPersonHeight;
    if (d.firstPersonMouseSensitivity !== undefined) cameraData.firstPersonMouseSensitivity = d.firstPersonMouseSensitivity;
    if (d.sideScrollerDistance !== undefined) cameraData.sideScrollerDistance = d.sideScrollerDistance;
    if (d.topDownHeight !== undefined) cameraData.topDownHeight = d.topDownHeight;
    if (d.orbitalDistance !== undefined) cameraData.orbitalDistance = d.orbitalDistance;
    if (d.orbitalAutoRotateSpeed !== undefined) cameraData.orbitalAutoRotateSpeed = d.orbitalAutoRotateSpeed;

    ctx.store.setGameCamera(d.entityId, cameraData);
    return { success: true, result: { message: `Game camera set to ${d.mode} on entity ${d.entityId}` } };
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
    // `Object.hasOwn` guard: `entityId` is LLM-chosen, and a bare read of
    // `toString`/`constructor` walks the prototype chain and would report an
    // inherited function as this entity's camera.
    const camera = Object.hasOwn(ctx.store.allGameCameras, p.data.entityId)
      ? ctx.store.allGameCameras[p.data.entityId]
      : undefined;
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

    const entityId = ctx.store.spawnEntity(prefab.snapshot.entityType as EntityType, p.data.name || prefab.snapshot.name);
    if (!entityId) {
      // spawnEntity returns undefined for a non-spawnable entityType (imported prefabs
      // carry an unvalidated `entityType: string`) or when the engine isn't loaded yet.
      // Report a real failure rather than a phantom success that claims the prefab was
      // instantiated while no entity was created and no material/transform applied (#8748).
      return {
        success: false,
        error: `Cannot instantiate prefab "${prefab.name}": '${prefab.snapshot.entityType}' is not a spawnable type or the engine is not ready`,
      };
    }

    if (prefab.snapshot.material) {
      ctx.store.updateMaterial(entityId, prefab.snapshot.material);
    }

    if (p.data.position) {
      ctx.store.updateTransform(entityId, 'position', p.data.position);
    }

    return { success: true, result: { message: `Instantiated prefab "${prefab.name}"`, entityId } };
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
