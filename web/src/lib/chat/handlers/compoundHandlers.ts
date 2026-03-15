/**
 * Compound action handlers — 8 multi-step AI compound tools that orchestrate
 * multiple store mutations.
 *
 *   1. describe_scene
 *   2. analyze_gameplay
 *   3. arrange_entities
 *   4. create_scene_from_description
 *   5. create_level_layout
 *   6. setup_character
 *   7. configure_game_mechanics
 *   8. apply_style
 */

import type { ToolHandler, ExecutionResult } from './types';
import type {
  MaterialData,
  LightData,
  PhysicsData,
  EntityType,
  InputBinding,
  SceneNode,
} from './types';
import type { GameComponentData, PlatformLoopMode, WinConditionType } from '@/stores/editorStore';
import { getPresetById } from '@/lib/materialPresets';

// ===== Compound Action Types =====

interface CompoundResult {
  success: boolean;
  partialSuccess: boolean;
  entityIds: Record<string, string>;
  operations: Array<{ action: string; success: boolean; entityId?: string; error?: string }>;
  summary: string;
}

interface GameplayAnalysis {
  entityCount: number;
  mechanics: string[];
  entityRoles: Array<{ name: string; id: string; role: string }>;
  issues: string[];
  suggestions: string[];
}

// ===== Helper Functions =====

function buildCompoundResult(
  operations: Array<{ action: string; success: boolean; entityId?: string; error?: string }>,
  nameToId: Record<string, string>
): CompoundResult {
  const successCount = operations.filter((op) => op.success).length;
  const success = successCount === operations.length;
  const partialSuccess = successCount > 0 && successCount < operations.length;

  const summary = success
    ? `Created ${successCount} entities. Entity IDs: ${Object.entries(nameToId).map(([name, id]) => `${name}=${id}`).join(', ')}`
    : partialSuccess
    ? `Partial success: ${successCount}/${operations.length} entities created. Entity IDs: ${Object.entries(nameToId).map(([name, id]) => `${name}=${id}`).join(', ')}`
    : `Failed to create entities. ${operations.filter((op) => !op.success).length} errors.`;

  return {
    success,
    partialSuccess,
    entityIds: nameToId,
    operations,
    summary,
  };
}

function buildMaterialFromPartial(partialMat: Record<string, unknown>): MaterialData {
  return {
    baseColor: (partialMat.baseColor as [number, number, number, number]) ?? [1, 1, 1, 1],
    metallic: (partialMat.metallic as number) ?? 0,
    perceptualRoughness: (partialMat.perceptualRoughness as number) ?? 0.5,
    reflectance: (partialMat.reflectance as number) ?? 0.5,
    emissive: (partialMat.emissive as [number, number, number, number]) ?? [0, 0, 0, 1],
    emissiveExposureWeight: (partialMat.emissiveExposureWeight as number) ?? 1,
    alphaMode: (partialMat.alphaMode as 'opaque' | 'blend' | 'mask') ?? 'opaque',
    alphaCutoff: (partialMat.alphaCutoff as number) ?? 0.5,
    doubleSided: (partialMat.doubleSided as boolean) ?? false,
    unlit: (partialMat.unlit as boolean) ?? false,
    uvOffset: (partialMat.uvOffset as [number, number]) ?? [0, 0],
    uvScale: (partialMat.uvScale as [number, number]) ?? [1, 1],
    uvRotation: (partialMat.uvRotation as number) ?? 0,
    parallaxDepthScale: (partialMat.parallaxDepthScale as number) ?? 0.1,
    parallaxMappingMethod: (partialMat.parallaxMappingMethod as 'occlusion' | 'relief') ?? 'occlusion',
    maxParallaxLayerCount: (partialMat.maxParallaxLayerCount as number) ?? 16,
    parallaxReliefMaxSteps: (partialMat.parallaxReliefMaxSteps as number) ?? 5,
    clearcoat: (partialMat.clearcoat as number) ?? 0,
    clearcoatPerceptualRoughness: (partialMat.clearcoatPerceptualRoughness as number) ?? 0.5,
    specularTransmission: (partialMat.specularTransmission as number) ?? 0,
    diffuseTransmission: (partialMat.diffuseTransmission as number) ?? 0,
    ior: (partialMat.ior as number) ?? 1.5,
    thickness: (partialMat.thickness as number) ?? 0,
    attenuationDistance: (partialMat.attenuationDistance as number | null) ?? null,
    attenuationColor: (partialMat.attenuationColor as [number, number, number]) ?? [1, 1, 1],
  };
}

function buildLightFromPartial(partialLight: Record<string, unknown>): LightData {
  return {
    lightType: (partialLight.lightType as 'point' | 'directional' | 'spot') ?? 'point',
    color: (partialLight.color as [number, number, number]) ?? [1, 1, 1],
    intensity: (partialLight.intensity as number) ?? 800,
    shadowsEnabled: (partialLight.shadowsEnabled as boolean) ?? false,
    shadowDepthBias: (partialLight.shadowDepthBias as number) ?? 0.02,
    shadowNormalBias: (partialLight.shadowNormalBias as number) ?? 1.8,
    range: (partialLight.range as number) ?? 20,
    radius: (partialLight.radius as number) ?? 0,
    innerAngle: (partialLight.innerAngle as number) ?? 0.4,
    outerAngle: (partialLight.outerAngle as number) ?? 0.8,
  };
}

function buildPhysicsFromPartial(partialPhysics: Record<string, unknown>): PhysicsData {
  return {
    bodyType: (partialPhysics.bodyType as 'dynamic' | 'fixed' | 'kinematic_position' | 'kinematic_velocity') ?? 'dynamic',
    colliderShape: (partialPhysics.colliderShape as 'cuboid' | 'ball' | 'cylinder' | 'capsule' | 'auto') ?? 'auto',
    restitution: (partialPhysics.restitution as number) ?? 0.3,
    friction: (partialPhysics.friction as number) ?? 0.5,
    density: (partialPhysics.density as number) ?? 1.0,
    gravityScale: (partialPhysics.gravityScale as number) ?? 1.0,
    lockTranslationX: (partialPhysics.lockTranslationX as boolean) ?? false,
    lockTranslationY: (partialPhysics.lockTranslationY as boolean) ?? false,
    lockTranslationZ: (partialPhysics.lockTranslationZ as boolean) ?? false,
    lockRotationX: (partialPhysics.lockRotationX as boolean) ?? false,
    lockRotationY: (partialPhysics.lockRotationY as boolean) ?? false,
    lockRotationZ: (partialPhysics.lockRotationZ as boolean) ?? false,
    isSensor: (partialPhysics.isSensor as boolean) ?? false,
  };
}

function inferEntityType(node: SceneNode): string {
  const components = node.components || [];
  if (components.includes('PointLight')) return 'point_light';
  if (components.includes('DirectionalLight')) return 'directional_light';
  if (components.includes('SpotLight')) return 'spot_light';
  if (components.includes('Mesh3d')) return 'mesh';
  return 'unknown';
}

function identifyRole(
  node: SceneNode,
  components: GameComponentData[],
  hasPhysics: boolean,
  hasScript: boolean
): string {
  for (const comp of components) {
    if (comp.type === 'characterController') return 'player';
    if (comp.type === 'collectible') return 'collectible';
    if (comp.type === 'damageZone') return 'obstacle';
    if (comp.type === 'checkpoint') return 'checkpoint';
    if (comp.type === 'teleporter') return 'teleporter';
    if (comp.type === 'triggerZone') return 'trigger';
    if (comp.type === 'winCondition') return 'goal';
    if (comp.type === 'spawner') return 'spawner';
    if (comp.type === 'follower') return 'enemy';
    if (comp.type === 'projectile') return 'projectile';
    if (comp.type === 'movingPlatform') return 'platform';
  }

  const nodeComponents = node.components || [];
  if (
    nodeComponents.includes('PointLight') ||
    nodeComponents.includes('DirectionalLight') ||
    nodeComponents.includes('SpotLight')
  ) {
    return 'light';
  }

  if (hasPhysics) {
    const lowerName = node.name.toLowerCase();
    if (lowerName.includes('ground') || lowerName.includes('floor')) return 'ground';
    if (lowerName.includes('wall') || lowerName.includes('barrier')) return 'obstacle';
    if (lowerName.includes('platform')) return 'platform';
    return 'physics_object';
  }

  if (hasScript) return 'scripted';

  return 'decoration';
}

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wallFromStartEnd(
  start: [number, number, number],
  end: [number, number, number],
  height: number,
  thickness: number
): {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
} {
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const length = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dx, dz);
  const midX = (start[0] + end[0]) / 2;
  const midY = height / 2 + (start[1] + end[1]) / 2;
  const midZ = (start[2] + end[2]) / 2;
  return {
    position: [midX, midY, midZ],
    rotation: [0, angle, 0],
    scale: [thickness, height, length],
  };
}

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
          maxHp: (props.maxHp as number) ?? 100,
          currentHp: (props.currentHp as number) ?? ((props.maxHp as number) ?? 100),
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
          waypoints: (props.waypoints as [number, number, number][]) ?? [
            [0, 0, 0],
            [0, 3, 0],
          ],
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

// ===== Handler Registry =====

export const compoundHandlers: Record<string, ToolHandler> = {
  describe_scene: async (args, ctx): Promise<ExecutionResult> => {
    const detail = (args.detail as string) ?? 'standard';
    const filterIds = args.filterEntityIds as string[] | undefined;
    const { sceneGraph } = ctx.store;

    const nodes = filterIds
      ? filterIds.map((id) => sceneGraph.nodes[id]).filter(Boolean)
      : Object.values(sceneGraph.nodes);

    if (detail === 'summary') {
      const typeCounts: Record<string, number> = {};
      for (const node of nodes) {
        const entityType = inferEntityType(node);
        typeCounts[entityType] = (typeCounts[entityType] || 0) + 1;
      }
      return {
        success: true,
        result: {
          entityCount: nodes.length,
          typeCounts,
          sceneName: ctx.store.sceneName,
          engineMode: ctx.store.engineMode,
          hasPhysics: ctx.store.physicsEnabled,
          hasScripts: Object.keys(ctx.store.allScripts).length > 0,
          summary: `Scene contains ${nodes.length} entities. Physics: ${ctx.store.physicsEnabled ? 'enabled' : 'disabled'}. Scripts: ${Object.keys(ctx.store.allScripts).length} active.`,
        },
      };
    }

    if (detail === 'standard') {
      const entities = nodes.map((node) => ({
        id: node.entityId,
        name: node.name,
        type: inferEntityType(node),
        visible: node.visible,
        parentId: node.parentId,
        childCount: node.children.length,
        hasPhysics: node.components.some((c) => c.includes('Physics')),
        hasScript: !!ctx.store.allScripts[node.entityId],
        hasAudio: node.components.some((c) => c.includes('Audio')),
        gameComponents: (ctx.store.allGameComponents?.[node.entityId] ?? []).map((c) => c.type),
      }));
      return {
        success: true,
        result: {
          entities,
          environment: {
            ambient: ctx.store.ambientLight,
            clearColor: ctx.store.environment.clearColor,
            fogEnabled: ctx.store.environment.fogEnabled,
            skyboxPreset: ctx.store.environment.skyboxPreset,
          },
          inputPreset: ctx.store.inputPreset,
          engineMode: ctx.store.engineMode,
        },
      };
    }

    // detail === 'full'
    const entities = nodes.map((node) => ({
      id: node.entityId,
      name: node.name,
      type: inferEntityType(node),
      components: node.components,
      visible: node.visible,
      parentId: node.parentId,
      children: node.children,
      hasPhysics: node.components.some((c) => c.includes('Physics')),
      hasScript: !!ctx.store.allScripts[node.entityId],
      hasAudio: node.components.some((c) => c.includes('Audio')),
      hasParticles: node.components.some((c) => c.includes('Particle')),
      gameComponents: ctx.store.allGameComponents?.[node.entityId] ?? [],
      terrain: ctx.store.terrainData?.[node.entityId] ?? null,
    }));

    return {
      success: true,
      result: {
        entities,
        environment: {
          ambient: ctx.store.ambientLight,
          environment: ctx.store.environment,
          postProcessing: ctx.store.postProcessing,
        },
        inputBindings: ctx.store.inputBindings,
        inputPreset: ctx.store.inputPreset,
        audioBuses: ctx.store.audioBuses,
        scenes: ctx.store.scenes,
        engineMode: ctx.store.engineMode,
      },
    };
  },

  analyze_gameplay: async (args, ctx): Promise<ExecutionResult> => {
    const _focus = (args.focus as string) ?? 'overview';
    const { sceneGraph } = ctx.store;
    const allNodes = Object.values(sceneGraph.nodes);

    const analysis: GameplayAnalysis = {
      entityCount: allNodes.length,
      mechanics: [],
      entityRoles: [],
      issues: [],
      suggestions: [],
    };

    for (const node of allNodes) {
      const components = ctx.store.allGameComponents?.[node.entityId] ?? [];
      const hasPhysics = node.components.some((c) => c.includes('Physics'));
      const hasScript = !!ctx.store.allScripts[node.entityId];

      const role = identifyRole(node, components, hasPhysics, hasScript);
      analysis.entityRoles.push({ name: node.name, id: node.entityId, role });
    }

    if (analysis.entityRoles.some((e) => e.role === 'player')) analysis.mechanics.push('player_character');
    if (ctx.store.inputBindings.length > 0) analysis.mechanics.push('input_system');
    if (ctx.store.physicsEnabled) analysis.mechanics.push('physics');
    if (Object.keys(ctx.store.allScripts).length > 0) analysis.mechanics.push('scripting');
    if (analysis.entityRoles.some((e) => e.role === 'collectible')) analysis.mechanics.push('collectibles');
    if (analysis.entityRoles.some((e) => e.role === 'checkpoint')) analysis.mechanics.push('checkpoints');
    if (analysis.entityRoles.some((e) => e.role === 'goal')) analysis.mechanics.push('win_condition');

    const players = analysis.entityRoles.filter((e) => e.role === 'player');
    if (players.length === 0 && allNodes.length > 0) {
      analysis.issues.push('No player character found. Consider adding a character_controller component.');
    }
    if (players.length > 1) {
      analysis.issues.push(
        `Multiple potential player characters: ${players.map((p) => p.name).join(', ')}. Only one should have character_controller.`
      );
    }
    if (ctx.store.inputBindings.length === 0 && players.length > 0) {
      analysis.issues.push('Player character exists but no input bindings are configured.');
    }

    const collectibles = analysis.entityRoles.filter((e) => e.role === 'collectible');
    const winConditions = allNodes.filter((n) =>
      (ctx.store.allGameComponents?.[n.entityId] ?? []).some((c) => c.type === 'winCondition')
    );
    if (collectibles.length > 0 && winConditions.length === 0) {
      analysis.suggestions.push(
        'Scene has collectibles but no win condition. Consider adding a win_condition component.'
      );
    }

    const dynamicEntities = allNodes.filter((n) =>
      n.components.some((c) => c.includes('Physics'))
    );
    if (dynamicEntities.length > 0 && ctx.store.environment.fogEnabled === false) {
      analysis.suggestions.push(
        'Scene has dynamic physics objects. Consider adding fog or skybox for depth perception.'
      );
    }

    const lights = analysis.entityRoles.filter((e) => e.role === 'light');
    if (lights.length === 0 && allNodes.length > 5) {
      analysis.suggestions.push(
        'No dedicated lights found. Consider adding point or directional lights for better visuals.'
      );
    }

    return { success: true, result: analysis };
  },

  arrange_entities: async (args, ctx): Promise<ExecutionResult> => {
    const entityIds = args.entityIds as string[];
    const pattern = args.pattern as string;
    const center = (args.center as [number, number, number]) ?? [0, 0, 0];
    const yOffset = (args.yOffset as number) ?? 0;
    const spacing = (args.spacing as number) ?? 2.0;
    const radius = (args.radius as number) ?? 5.0;
    const scatterRadius = (args.scatterRadius as number) ?? 10.0;
    const scatterSeed = (args.scatterSeed as number) ?? Date.now();
    const faceCenter = (args.faceCenter as boolean) ?? false;
    const direction = (args.direction as [number, number, number]) ?? [1, 0, 0];
    const pathPoints = (args.pathPoints as [number, number, number][]) ?? [];
    const gridColumns = (args.gridColumns as number) ?? Math.ceil(Math.sqrt(entityIds.length));

    const operations: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];

    for (let i = 0; i < entityIds.length; i++) {
      const entityId = entityIds[i];
      const node = ctx.store.sceneGraph.nodes[entityId];
      if (!node) {
        operations.push({ action: `arrange "${entityId}"`, success: false, error: 'Entity not found' });
        continue;
      }

      let newPosition: [number, number, number] = [0, 0, 0];

      try {
        if (pattern === 'grid') {
          const cols = gridColumns;
          const rows = Math.ceil(entityIds.length / cols);
          const row = Math.floor(i / cols);
          const col = i % cols;
          newPosition = [
            center[0] + col * spacing - ((cols - 1) * spacing) / 2,
            center[1] + yOffset,
            center[2] + row * spacing - ((rows - 1) * spacing) / 2,
          ];
        } else if (pattern === 'circle') {
          const theta = (i * (2 * Math.PI)) / entityIds.length;
          newPosition = [
            center[0] + radius * Math.cos(theta),
            center[1] + yOffset,
            center[2] + radius * Math.sin(theta),
          ];
          if (faceCenter) {
            const rotY = Math.atan2(-Math.sin(theta), -Math.cos(theta));
            ctx.store.updateTransform(entityId, 'rotation', [0, rotY, 0]);
          }
        } else if (pattern === 'line') {
          const t = i * spacing;
          const dirLength = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2);
          const normDir = [
            direction[0] / dirLength,
            direction[1] / dirLength,
            direction[2] / dirLength,
          ];
          newPosition = [
            center[0] + normDir[0] * t,
            center[1] + normDir[1] * t + yOffset,
            center[2] + normDir[2] * t,
          ];
        } else if (pattern === 'scatter') {
          const rng = mulberry32(scatterSeed + i);
          const randX = (rng() * 2 - 1) * scatterRadius;
          const randZ = (rng() * 2 - 1) * scatterRadius;
          newPosition = [center[0] + randX, center[1] + yOffset, center[2] + randZ];
        } else if (pattern === 'path') {
          if (pathPoints.length < 2) {
            throw new Error('Path pattern requires at least 2 waypoints');
          }
          let totalLength = 0;
          const segmentLengths: number[] = [];
          for (let j = 0; j < pathPoints.length - 1; j++) {
            const dx = pathPoints[j + 1][0] - pathPoints[j][0];
            const dy = pathPoints[j + 1][1] - pathPoints[j][1];
            const dz = pathPoints[j + 1][2] - pathPoints[j][2];
            const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
            segmentLengths.push(len);
            totalLength += len;
          }

          const targetDist = entityIds.length <= 1 ? 0 : (i / (entityIds.length - 1)) * totalLength;
          let accumulatedDist = 0;
          let segmentIndex = 0;
          for (let j = 0; j < segmentLengths.length; j++) {
            if (accumulatedDist + segmentLengths[j] >= targetDist) {
              segmentIndex = j;
              break;
            }
            accumulatedDist += segmentLengths[j];
          }

          const segLen = segmentLengths[segmentIndex] || 1;
          const localT = (targetDist - accumulatedDist) / segLen;
          const p1 = pathPoints[segmentIndex];
          const p2 = pathPoints[segmentIndex + 1];
          newPosition = [
            p1[0] + localT * (p2[0] - p1[0]),
            p1[1] + localT * (p2[1] - p1[1]) + yOffset,
            p1[2] + localT * (p2[2] - p1[2]),
          ];
        } else {
          throw new Error(`Unknown pattern: ${pattern}`);
        }

        ctx.store.updateTransform(entityId, 'position', newPosition);
        operations.push({ action: `arrange "${node.name}"`, success: true, entityId });
      } catch (err) {
        operations.push({
          action: `arrange "${node.name}"`,
          success: false,
          entityId,
          error: err instanceof Error ? err.message : 'Failed to arrange',
        });
      }
    }

    const successCount = operations.filter((op) => op.success).length;
    return {
      success: successCount === operations.length,
      result: { arranged: successCount, pattern, operations },
    };
  },

  create_scene_from_description: async (args, ctx): Promise<ExecutionResult> => {
    const entities = args.entities as Array<Record<string, unknown>>;
    const clearExisting = (args.clearExisting as boolean) ?? false;
    const envSettings = args.environment as Record<string, unknown> | undefined;
    const results: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];
    const nameToId: Record<string, string> = {};

    if (clearExisting) ctx.store.newScene();

    if (envSettings) {
      if (envSettings.ambientColor || envSettings.ambientBrightness) {
        const ambientUpdate: Record<string, unknown> = {};
        if (envSettings.ambientColor) ambientUpdate.color = envSettings.ambientColor;
        if (envSettings.ambientBrightness) ambientUpdate.brightness = envSettings.ambientBrightness;
        ctx.store.updateAmbientLight(ambientUpdate);
      }
      if (envSettings.skyboxPreset) ctx.store.setSkybox(envSettings.skyboxPreset as string);
      if (envSettings.fogEnabled !== undefined) {
        const fogUpdate: Record<string, unknown> = { fogEnabled: envSettings.fogEnabled };
        if (envSettings.fogColor) fogUpdate.fogColor = envSettings.fogColor;
        if (envSettings.fogStart !== undefined) fogUpdate.fogStart = envSettings.fogStart;
        if (envSettings.fogEnd !== undefined) fogUpdate.fogEnd = envSettings.fogEnd;
        ctx.store.updateEnvironment(fogUpdate);
      }
    }

    for (const ent of entities) {
      try {
        const entType = ent.type as string;
        const entName = ent.name as string;

        ctx.store.spawnEntity(entType as EntityType, entName);
        const entityId = ctx.store.primaryId;
        if (!entityId) throw new Error('spawn failed');
        nameToId[entName] = entityId;

        if (ent.position) ctx.store.updateTransform(entityId, 'position', ent.position as [number, number, number]);
        if (ent.rotation) ctx.store.updateTransform(entityId, 'rotation', ent.rotation as [number, number, number]);
        if (ent.scale) ctx.store.updateTransform(entityId, 'scale', ent.scale as [number, number, number]);

        if (ent.material) {
          const matInput = ent.material as Record<string, unknown>;
          if (matInput.presetId) {
            const preset = getPresetById(matInput.presetId as string);
            if (preset) ctx.store.updateMaterial(entityId, preset.data);
          } else {
            ctx.store.updateMaterial(entityId, buildMaterialFromPartial(matInput));
          }
        }

        if (ent.light) {
          ctx.store.updateLight(entityId, buildLightFromPartial(ent.light as Record<string, unknown>));
        }

        if (ent.physics) {
          ctx.store.togglePhysics(entityId, true);
          ctx.store.updatePhysics(entityId, buildPhysicsFromPartial(ent.physics as Record<string, unknown>));
        }

        if (ent.gameComponent) {
          const componentType = ent.gameComponent as string;
          const componentProps = (ent.gameComponentProps as Record<string, unknown>) ?? {};
          const component = buildGameComponentFromInput(componentType, componentProps);
          if (component) ctx.store.addGameComponent(entityId, component);
        }

        results.push({ action: `spawn "${entName}"`, success: true, entityId });
      } catch (err) {
        results.push({
          action: `spawn "${ent.name as string}"`,
          success: false,
          error: err instanceof Error ? err.message : 'Spawn failed',
        });
      }
    }

    for (const ent of entities) {
      if (ent.parentName && nameToId[ent.name as string] && nameToId[ent.parentName as string]) {
        ctx.store.reparentEntity(nameToId[ent.name as string], nameToId[ent.parentName as string]);
      }
    }

    return { success: true, result: buildCompoundResult(results, nameToId) };
  },

  create_level_layout: async (args, ctx): Promise<ExecutionResult> => {
    const levelName = (args.levelName as string) ?? 'Level';
    const ground = args.ground as Record<string, unknown> | undefined;
    const walls = (args.walls as Array<Record<string, unknown>>) ?? [];
    const obstacles = (args.obstacles as Array<Record<string, unknown>>) ?? [];
    const spawnPoints = (args.spawnPoints as Array<Record<string, unknown>>) ?? [];
    const goals = (args.goals as Array<Record<string, unknown>>) ?? [];
    const inputPreset = args.inputPreset as string | undefined;

    const results: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];
    const nameToId: Record<string, string> = {};

    ctx.store.spawnEntity('cube', levelName);
    const rootId = ctx.store.primaryId;
    if (!rootId) return { success: false, error: 'Failed to create level root' };
    nameToId[levelName] = rootId;
    ctx.store.updateTransform(rootId, 'scale', [1, 1, 1]);
    results.push({ action: `create root "${levelName}"`, success: true, entityId: rootId });

    if (ground) {
      try {
        const width = (ground.width as number) ?? 20;
        const depth = (ground.depth as number) ?? 20;
        const useTerrain = (ground.useTerrain as boolean) ?? false;

        if (useTerrain) {
          const terrainConfig = (ground.terrainConfig as Record<string, unknown>) ?? {};
          ctx.store.spawnTerrain(terrainConfig);
          const groundId = ctx.store.primaryId;
          if (groundId) {
            nameToId['Ground'] = groundId;
            ctx.store.reparentEntity(groundId, rootId);
            results.push({ action: 'create terrain ground', success: true, entityId: groundId });
          }
        } else {
          ctx.store.spawnEntity('plane', 'Ground');
          const groundId = ctx.store.primaryId;
          if (groundId) {
            nameToId['Ground'] = groundId;
            ctx.store.updateTransform(groundId, 'scale', [width / 2, 1, depth / 2]);
            if (ground.material) {
              ctx.store.updateMaterial(groundId, buildMaterialFromPartial(ground.material as Record<string, unknown>));
            }
            ctx.store.reparentEntity(groundId, rootId);
            results.push({ action: 'create ground plane', success: true, entityId: groundId });
          }
        }
      } catch (err) {
        results.push({
          action: 'create ground',
          success: false,
          error: err instanceof Error ? err.message : 'Failed',
        });
      }
    }

    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      try {
        const name = (wall.name as string) ?? `Wall_${i}`;
        const start = wall.start as [number, number, number];
        const end = wall.end as [number, number, number];
        const height = (wall.height as number) ?? 3;
        const thickness = (wall.thickness as number) ?? 0.3;

        const geom = wallFromStartEnd(start, end, height, thickness);

        ctx.store.spawnEntity('cube', name);
        const wallId = ctx.store.primaryId;
        if (wallId) {
          nameToId[name] = wallId;
          ctx.store.updateTransform(wallId, 'position', geom.position);
          ctx.store.updateTransform(wallId, 'rotation', geom.rotation);
          ctx.store.updateTransform(wallId, 'scale', geom.scale);
          ctx.store.togglePhysics(wallId, true);
          ctx.store.updatePhysics(wallId, buildPhysicsFromPartial({ bodyType: 'fixed' }));
          if (wall.material) {
            ctx.store.updateMaterial(wallId, buildMaterialFromPartial(wall.material as Record<string, unknown>));
          }
          ctx.store.reparentEntity(wallId, rootId);
          results.push({ action: `create wall "${name}"`, success: true, entityId: wallId });
        }
      } catch (err) {
        results.push({
          action: `create wall ${i}`,
          success: false,
          error: err instanceof Error ? err.message : 'Failed',
        });
      }
    }

    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i];
      try {
        const obstType = obstacle.type as string;
        const obstName = (obstacle.name as string) ?? `Obstacle_${i}`;
        const position = obstacle.position as [number, number, number];
        const scale = obstacle.scale as [number, number, number] | undefined;

        ctx.store.spawnEntity(obstType as EntityType, obstName);
        const obstId = ctx.store.primaryId;
        if (obstId) {
          nameToId[obstName] = obstId;
          ctx.store.updateTransform(obstId, 'position', position);
          if (scale) ctx.store.updateTransform(obstId, 'scale', scale);
          if (obstacle.material) {
            ctx.store.updateMaterial(obstId, buildMaterialFromPartial(obstacle.material as Record<string, unknown>));
          }
          if (obstacle.physics) {
            ctx.store.togglePhysics(obstId, true);
            ctx.store.updatePhysics(obstId, buildPhysicsFromPartial(obstacle.physics as Record<string, unknown>));
          }
          if (obstacle.gameComponent) {
            const comp = buildGameComponentFromInput(
              obstacle.gameComponent as string,
              (obstacle.gameComponentProps as Record<string, unknown>) ?? {}
            );
            if (comp) ctx.store.addGameComponent(obstId, comp);
          }
          ctx.store.reparentEntity(obstId, rootId);
          results.push({ action: `create obstacle "${obstName}"`, success: true, entityId: obstId });
        }
      } catch (err) {
        results.push({
          action: `create obstacle ${i}`,
          success: false,
          error: err instanceof Error ? err.message : 'Failed',
        });
      }
    }

    for (let i = 0; i < spawnPoints.length; i++) {
      const sp = spawnPoints[i];
      try {
        const isPlayerSpawn = (sp.isPlayerSpawn as boolean) ?? false;
        const spName = (sp.name as string) ?? (isPlayerSpawn ? 'PlayerSpawn' : `SpawnPoint_${i}`);
        const position = sp.position as [number, number, number];

        ctx.store.spawnEntity('sphere', spName);
        const spId = ctx.store.primaryId;
        if (spId) {
          nameToId[spName] = spId;
          ctx.store.updateTransform(spId, 'position', position);
          ctx.store.updateTransform(spId, 'scale', [0.3, 0.3, 0.3]);
          ctx.store.updateMaterial(spId, buildMaterialFromPartial({ baseColor: [0, 1, 0, 0.5], unlit: true }));
          ctx.store.reparentEntity(spId, rootId);
          results.push({ action: `create spawn point "${spName}"`, success: true, entityId: spId });
        }
      } catch (err) {
        results.push({
          action: `create spawn point ${i}`,
          success: false,
          error: err instanceof Error ? err.message : 'Failed',
        });
      }
    }

    for (let i = 0; i < goals.length; i++) {
      const goal = goals[i];
      try {
        const goalName = (goal.name as string) ?? `Goal_${i}`;
        const position = goal.position as [number, number, number];
        const goalType = (goal.type as string) ?? 'reach';

        ctx.store.spawnEntity('sphere', goalName);
        const goalId = ctx.store.primaryId;
        if (goalId) {
          nameToId[goalName] = goalId;
          ctx.store.updateTransform(goalId, 'position', position);
          ctx.store.updateTransform(goalId, 'scale', [0.5, 0.5, 0.5]);
          ctx.store.updateMaterial(goalId, buildMaterialFromPartial({ baseColor: [1, 1, 0, 1], unlit: true }));

          if (goal.gameComponent) {
            const comp = buildGameComponentFromInput(
              goal.gameComponent as string,
              (goal.gameComponentProps as Record<string, unknown>) ?? {}
            );
            if (comp) ctx.store.addGameComponent(goalId, comp);
          } else if (goalType === 'reach') {
            const triggerComp = buildGameComponentFromInput('trigger_zone', {
              eventName: 'goal_reached',
              oneShot: true,
            });
            if (triggerComp) ctx.store.addGameComponent(goalId, triggerComp);
          }

          ctx.store.reparentEntity(goalId, rootId);
          results.push({ action: `create goal "${goalName}"`, success: true, entityId: goalId });
        }
      } catch (err) {
        results.push({
          action: `create goal ${i}`,
          success: false,
          error: err instanceof Error ? err.message : 'Failed',
        });
      }
    }

    if (inputPreset) {
      ctx.store.setInputPreset(inputPreset as 'fps' | 'platformer' | 'topdown' | 'racing');
    }

    return { success: true, result: buildCompoundResult(results, nameToId) };
  },

  setup_character: async (args, ctx): Promise<ExecutionResult> => {
    const charName = (args.name as string) ?? 'Player';
    const position = (args.position as [number, number, number]) ?? [0, 1, 0];
    const entityType = (args.entityType as string) ?? 'capsule';
    const material = args.material as Record<string, unknown> | undefined;
    const controller = (args.controller as Record<string, unknown>) ?? {};
    const health = args.health as Record<string, unknown> | undefined | null;
    const inputPreset = (args.inputPreset as string) ?? 'platformer';
    const cameraFollow = (args.cameraFollow as boolean) ?? true;
    const _cameraOffset = (args.cameraOffset as [number, number, number]) ?? [0, 5, -10];

    const results: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];
    const nameToId: Record<string, string> = {};

    try {
      ctx.store.spawnEntity(entityType as EntityType, charName);
      const charId = ctx.store.primaryId;
      if (!charId) throw new Error('Character spawn failed');
      nameToId[charName] = charId;

      ctx.store.updateTransform(charId, 'position', position);

      if (material) ctx.store.updateMaterial(charId, buildMaterialFromPartial(material));

      ctx.store.togglePhysics(charId, true);
      const physData = buildPhysicsFromPartial({
        bodyType: 'dynamic',
        colliderShape: 'capsule',
        lockRotationX: true,
        lockRotationZ: true,
      });
      ctx.store.updatePhysics(charId, physData);

      const controllerComp = buildGameComponentFromInput('character_controller', controller);
      if (controllerComp) ctx.store.addGameComponent(charId, controllerComp);

      if (health !== null) {
        const healthComp = buildGameComponentFromInput('health', health ?? {});
        if (healthComp) ctx.store.addGameComponent(charId, healthComp);
      }

      ctx.store.setInputPreset(inputPreset as 'fps' | 'platformer' | 'topdown' | 'racing');

      if (cameraFollow) {
        // Use forge.camera.setTarget with entity ID (not coordinates)
        // The game camera system handles follow offset natively
        const scriptSource = `forge.camera.setTarget("${charId}");`;
        ctx.store.setScript(charId, scriptSource, true);
      }

      results.push({ action: `setup character "${charName}"`, success: true, entityId: charId });
    } catch (err) {
      results.push({
        action: `setup character "${charName}"`,
        success: false,
        error: err instanceof Error ? err.message : 'Setup failed',
      });
    }

    return { success: true, result: buildCompoundResult(results, nameToId) };
  },

  configure_game_mechanics: async (args, ctx): Promise<ExecutionResult> => {
    const inputPreset = args.inputPreset as string | undefined;
    const customBindings = (args.customBindings as Array<Record<string, unknown>>) ?? [];
    const entityConfigs = (args.entityConfigs as Array<Record<string, unknown>>) ?? [];
    const qualityPreset = args.qualityPreset as string | undefined;

    const results: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];

    if (inputPreset) {
      ctx.store.setInputPreset(inputPreset as 'fps' | 'platformer' | 'topdown' | 'racing');
      results.push({ action: `set input preset "${inputPreset}"`, success: true });
    }

    for (const binding of customBindings) {
      try {
        const inputBinding: InputBinding = {
          actionName: binding.actionName as string,
          actionType: (binding.actionType as 'digital' | 'axis') ?? 'digital',
          sources: (binding.sources as string[]) ?? [],
          positiveKeys: binding.positiveKeys as string[] | undefined,
          negativeKeys: binding.negativeKeys as string[] | undefined,
          deadZone: binding.deadZone as number | undefined,
        };
        ctx.store.setInputBinding(inputBinding);
        results.push({ action: `add binding "${inputBinding.actionName}"`, success: true });
      } catch (err) {
        results.push({
          action: 'add binding',
          success: false,
          error: err instanceof Error ? err.message : 'Binding failed',
        });
      }
    }

    for (const config of entityConfigs) {
      try {
        const entityName = config.entityName as string;
        const node = Object.values(ctx.store.sceneGraph.nodes).find((n) => n.name === entityName);
        if (!node) {
          results.push({ action: `configure "${entityName}"`, success: false, error: 'Entity not found' });
          continue;
        }

        const entityId = node.entityId;

        if (config.physics) {
          ctx.store.togglePhysics(entityId, true);
          ctx.store.updatePhysics(entityId, buildPhysicsFromPartial(config.physics as Record<string, unknown>));
        }

        if (config.gameComponents) {
          const components = config.gameComponents as Array<Record<string, unknown>>;
          for (const comp of components) {
            const builtComp = buildGameComponentFromInput(
              comp.type as string,
              (comp.props as Record<string, unknown>) ?? {}
            );
            if (builtComp) ctx.store.addGameComponent(entityId, builtComp);
          }
        }

        if (config.script) {
          const script = config.script as Record<string, unknown>;
          if (script.source) {
            ctx.store.setScript(entityId, script.source as string, true, script.template as string | undefined);
          }
        }

        results.push({ action: `configure "${entityName}"`, success: true, entityId });
      } catch (err) {
        results.push({
          action: 'configure entity',
          success: false,
          error: err instanceof Error ? err.message : 'Configuration failed',
        });
      }
    }

    if (qualityPreset) {
      ctx.store.setQualityPreset(qualityPreset as 'low' | 'medium' | 'high' | 'ultra');
      results.push({ action: `set quality preset "${qualityPreset}"`, success: true });
    }

    const successCount = results.filter((r) => r.success).length;
    return {
      success: successCount === results.length,
      result: {
        configured: successCount,
        operations: results,
        summary: `Configured ${successCount} settings/entities.`,
      },
    };
  },

  apply_style: async (args, ctx): Promise<ExecutionResult> => {
    const targetEntityIds = args.targetEntityIds as string[] | undefined;
    const palette = args.palette as Record<string, [number, number, number, number]> | undefined;
    const materialOverrides = args.materialOverrides as Record<string, unknown> | undefined;
    const lighting = args.lighting as Record<string, unknown> | undefined;
    const postProcessing = args.postProcessing as Record<string, unknown> | undefined;

    const results: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];

    let targets: string[] = [];
    if (targetEntityIds) {
      targets = targetEntityIds;
    } else {
      targets = Object.values(ctx.store.sceneGraph.nodes)
        .filter((n) => {
          const comps = n.components || [];
          return comps.includes('Mesh3d');
        })
        .map((n) => n.entityId);
    }

    if (palette && targets.length > 0) {
      const entitiesWithVolume = targets
        .map((id, idx) => ({ id, volume: targets.length - idx }))
        .sort((a, b) => b.volume - a.volume);

      const thirdSize = Math.ceil(entitiesWithVolume.length / 3);
      for (let i = 0; i < entitiesWithVolume.length; i++) {
        const entityId = entitiesWithVolume[i].id;
        const mat = buildMaterialFromPartial({});
        let color: [number, number, number, number] = mat.baseColor;

        if (i < thirdSize && palette.primary) {
          color = palette.primary;
        } else if (i < thirdSize * 2 && palette.secondary) {
          color = palette.secondary;
        } else if (palette.accent) {
          color = palette.accent;
        }

        ctx.store.updateMaterial(entityId, { ...mat, baseColor: color });
        results.push({
          action: `apply palette to ${ctx.store.sceneGraph.nodes[entityId]?.name || entityId}`,
          success: true,
          entityId,
        });
      }
    }

    if (materialOverrides && targets.length > 0) {
      for (const entityId of targets) {
        try {
          const mat = buildMaterialFromPartial({});
          const updated = { ...mat };

          if (materialOverrides.metallic !== undefined) updated.metallic = materialOverrides.metallic as number;
          if (materialOverrides.roughness !== undefined)
            updated.perceptualRoughness = materialOverrides.roughness as number;
          if (materialOverrides.emissiveMultiplier !== undefined) {
            const mult = materialOverrides.emissiveMultiplier as number;
            updated.emissive = [
              mat.emissive[0] * mult,
              mat.emissive[1] * mult,
              mat.emissive[2] * mult,
              mat.emissive[3],
            ];
          }

          ctx.store.updateMaterial(entityId, updated);
          results.push({
            action: `apply material override to ${ctx.store.sceneGraph.nodes[entityId]?.name || entityId}`,
            success: true,
            entityId,
          });
        } catch (err) {
          results.push({
            action: `apply material override to ${entityId}`,
            success: false,
            entityId,
            error: err instanceof Error ? err.message : 'Failed',
          });
        }
      }
    }

    if (lighting) {
      if (lighting.ambientColor || lighting.ambientBrightness) {
        const ambientUpdate: Record<string, unknown> = {};
        if (lighting.ambientColor) ambientUpdate.color = lighting.ambientColor;
        if (lighting.ambientBrightness) ambientUpdate.brightness = lighting.ambientBrightness;
        ctx.store.updateAmbientLight(ambientUpdate);
        results.push({ action: 'update ambient light', success: true });
      }

      if (lighting.skyboxPreset) {
        ctx.store.setSkybox(lighting.skyboxPreset as string);
        results.push({ action: `set skybox "${lighting.skyboxPreset}"`, success: true });
      }

      if (lighting.fogEnabled !== undefined) {
        const fogUpdate: Record<string, unknown> = { fogEnabled: lighting.fogEnabled };
        if (lighting.fogColor) fogUpdate.fogColor = lighting.fogColor;
        if (lighting.fogStart !== undefined) fogUpdate.fogStart = lighting.fogStart;
        if (lighting.fogEnd !== undefined) fogUpdate.fogEnd = lighting.fogEnd;
        ctx.store.updateEnvironment(fogUpdate);
        results.push({ action: 'update fog settings', success: true });
      }
    }

    if (postProcessing) {
      ctx.store.updatePostProcessing(postProcessing);
      results.push({ action: 'update post-processing', success: true });
    }

    const successCount = results.filter((r) => r.success).length;
    return {
      success: successCount === results.length,
      result: {
        appliedTo: targets.length,
        operations: results,
        summary: `Applied style to ${targets.length} entities with ${successCount} operations.`,
      },
    };
  },
};
