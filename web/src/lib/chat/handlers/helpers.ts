/**
 * Helper functions shared across tool call handlers.
 */

import type { MaterialData, LightData, PhysicsData, SceneNode } from './types';

// ===== Compound Action Types =====

export interface CompoundResult {
  success: boolean;
  partialSuccess: boolean;
  entityIds: Record<string, string>;
  operations: Array<{ action: string; success: boolean; entityId?: string; error?: string }>;
  summary: string;
}

export interface GameplayAnalysis {
  entityCount: number;
  mechanics: string[];
  entityRoles: Array<{ name: string; id: string; role: string }>;
  issues: string[];
  suggestions: string[];
}

// ===== Builder Functions =====

/**
 * Build a compound result from operation list.
 */
export function buildCompoundResult(
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

/**
 * Build full MaterialData from partial input with defaults.
 */
export function buildMaterialFromPartial(partialMat: Record<string, unknown>): MaterialData {
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

/**
 * Build full LightData from partial input with defaults.
 */
export function buildLightFromPartial(partialLight: Record<string, unknown>): LightData {
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

/**
 * Build full PhysicsData from partial input with defaults.
 */
export function buildPhysicsFromPartial(partialPhysics: Record<string, unknown>): PhysicsData {
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

/**
 * Build GameComponentData from input type and properties.
 */
export function buildGameComponentFromInput(
  type: string,
  props: Record<string, unknown>
): import('@/stores/editorStore').GameComponentData | null {
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
          currentHp: (props.currentHp as number) ?? (props.maxHp as number) ?? 100,
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
          loopMode: (props.loopMode as import('@/stores/editorStore').PlatformLoopMode) ?? 'pingPong',
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
          conditionType: (props.conditionType as import('@/stores/editorStore').WinConditionType) ?? 'score',
          targetScore: (props.targetScore as number | null) ?? 10,
          targetEntityId: (props.targetEntityId as string | null) ?? null,
        },
      };

    default:
      return null;
  }
}

// ===== Analysis Functions =====

/**
 * Infer entity type from SceneNode components.
 */
export function inferEntityType(node: SceneNode): string {
  const components = node.components || [];
  if (components.includes('PointLight')) return 'point_light';
  if (components.includes('DirectionalLight')) return 'directional_light';
  if (components.includes('SpotLight')) return 'spot_light';
  if (components.includes('Mesh3d')) {
    // Could be any mesh type, default to cube
    return 'mesh';
  }
  return 'unknown';
}

/**
 * Identify entity role for gameplay analysis.
 */
export function identifyRole(
  node: SceneNode,
  components: import('@/stores/editorStore').GameComponentData[],
  hasPhysics: boolean,
  hasScript: boolean
): string {
  // Check for specific game components first
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

  // Check for light entities
  const nodeComponents = node.components || [];
  if (nodeComponents.includes('PointLight') || nodeComponents.includes('DirectionalLight') || nodeComponents.includes('SpotLight')) {
    return 'light';
  }

  // Check for physics-based roles
  if (hasPhysics) {
    if (node.name.toLowerCase().includes('ground') || node.name.toLowerCase().includes('floor')) {
      return 'ground';
    }
    if (node.name.toLowerCase().includes('wall') || node.name.toLowerCase().includes('barrier')) {
      return 'obstacle';
    }
    if (node.name.toLowerCase().includes('platform')) {
      return 'platform';
    }
    return 'physics_object';
  }

  // Fallback: check for scripted entities
  if (hasScript) {
    return 'scripted';
  }

  // Default
  return 'decoration';
}

// ===== Math Utilities =====

/**
 * Deterministic seeded PRNG for scatter pattern (mulberry32).
 */
export function mulberry32(seed: number): () => number {
  return function() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Calculate wall geometry from start/end points.
 */
export function wallFromStartEnd(
  start: [number, number, number],
  end: [number, number, number],
  height: number,
  thickness: number
): { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } {
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
