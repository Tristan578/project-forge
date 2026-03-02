/**
 * Helper functions shared across tool call handlers.
 */

import { z } from 'zod';
import type { MaterialData, LightData, PhysicsData, SceneNode } from './types';
import { zVec2, zVec3, zVec4 } from './types';

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

// ===== Zod Schemas for Builder Functions =====

const zPartialMaterial = z.object({
  baseColor: zVec4.optional(),
  metallic: z.number().optional(),
  perceptualRoughness: z.number().optional(),
  reflectance: z.number().optional(),
  emissive: zVec4.optional(),
  emissiveExposureWeight: z.number().optional(),
  alphaMode: z.enum(['opaque', 'blend', 'mask']).optional(),
  alphaCutoff: z.number().optional(),
  doubleSided: z.boolean().optional(),
  unlit: z.boolean().optional(),
  uvOffset: zVec2.optional(),
  uvScale: zVec2.optional(),
  uvRotation: z.number().optional(),
  parallaxDepthScale: z.number().optional(),
  parallaxMappingMethod: z.enum(['occlusion', 'relief']).optional(),
  maxParallaxLayerCount: z.number().optional(),
  parallaxReliefMaxSteps: z.number().optional(),
  clearcoat: z.number().optional(),
  clearcoatPerceptualRoughness: z.number().optional(),
  specularTransmission: z.number().optional(),
  diffuseTransmission: z.number().optional(),
  ior: z.number().optional(),
  thickness: z.number().optional(),
  attenuationDistance: z.number().nullable().optional(),
  attenuationColor: zVec3.optional(),
}).passthrough();

const zPartialLight = z.object({
  lightType: z.enum(['point', 'directional', 'spot']).optional(),
  color: zVec3.optional(),
  intensity: z.number().optional(),
  shadowsEnabled: z.boolean().optional(),
  shadowDepthBias: z.number().optional(),
  shadowNormalBias: z.number().optional(),
  range: z.number().optional(),
  radius: z.number().optional(),
  innerAngle: z.number().optional(),
  outerAngle: z.number().optional(),
}).passthrough();

const zPartialPhysics = z.object({
  bodyType: z.enum(['dynamic', 'fixed', 'kinematic_position', 'kinematic_velocity']).optional(),
  colliderShape: z.enum(['cuboid', 'ball', 'cylinder', 'capsule', 'auto']).optional(),
  restitution: z.number().optional(),
  friction: z.number().optional(),
  density: z.number().optional(),
  gravityScale: z.number().optional(),
  lockTranslationX: z.boolean().optional(),
  lockTranslationY: z.boolean().optional(),
  lockTranslationZ: z.boolean().optional(),
  lockRotationX: z.boolean().optional(),
  lockRotationY: z.boolean().optional(),
  lockRotationZ: z.boolean().optional(),
  isSensor: z.boolean().optional(),
}).passthrough();

// Per-case game component prop schemas
const zCharacterControllerProps = z.object({
  speed: z.number().optional(),
  jumpHeight: z.number().optional(),
  gravityScale: z.number().optional(),
  canDoubleJump: z.boolean().optional(),
}).passthrough();

const zHealthProps = z.object({
  maxHp: z.number().optional(),
  currentHp: z.number().optional(),
  invincibilitySecs: z.number().optional(),
  respawnOnDeath: z.boolean().optional(),
  respawnPoint: zVec3.optional(),
}).passthrough();

const zCollectibleProps = z.object({
  value: z.number().optional(),
  destroyOnCollect: z.boolean().optional(),
  pickupSoundAsset: z.string().nullable().optional(),
  rotateSpeed: z.number().optional(),
}).passthrough();

const zDamageZoneProps = z.object({
  damagePerSecond: z.number().optional(),
  oneShot: z.boolean().optional(),
}).passthrough();

const zCheckpointProps = z.object({
  autoSave: z.boolean().optional(),
}).passthrough();

const zTeleporterProps = z.object({
  targetPosition: zVec3.optional(),
  cooldownSecs: z.number().optional(),
}).passthrough();

const zMovingPlatformProps = z.object({
  speed: z.number().optional(),
  waypoints: z.array(zVec3).optional(),
  pauseDuration: z.number().optional(),
  loopMode: z.enum(['pingPong', 'loop', 'once']).optional(),
}).passthrough();

const zTriggerZoneProps = z.object({
  eventName: z.string().optional(),
  oneShot: z.boolean().optional(),
}).passthrough();

const zSpawnerProps = z.object({
  entityType: z.string().optional(),
  intervalSecs: z.number().optional(),
  maxCount: z.number().optional(),
  spawnOffset: zVec3.optional(),
  onTrigger: z.string().nullable().optional(),
}).passthrough();

const zFollowerProps = z.object({
  targetEntityId: z.string().nullable().optional(),
  speed: z.number().optional(),
  stopDistance: z.number().optional(),
  lookAtTarget: z.boolean().optional(),
}).passthrough();

const zProjectileProps = z.object({
  speed: z.number().optional(),
  damage: z.number().optional(),
  lifetimeSecs: z.number().optional(),
  gravity: z.boolean().optional(),
  destroyOnHit: z.boolean().optional(),
}).passthrough();

const zWinConditionProps = z.object({
  conditionType: z.string().optional(),
  targetScore: z.number().nullable().optional(),
  targetEntityId: z.string().nullable().optional(),
}).passthrough();

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
  const mat = zPartialMaterial.parse(partialMat);
  return {
    baseColor: mat.baseColor ?? [1, 1, 1, 1],
    metallic: mat.metallic ?? 0,
    perceptualRoughness: mat.perceptualRoughness ?? 0.5,
    reflectance: mat.reflectance ?? 0.5,
    emissive: mat.emissive ?? [0, 0, 0, 1],
    emissiveExposureWeight: mat.emissiveExposureWeight ?? 1,
    alphaMode: mat.alphaMode ?? 'opaque',
    alphaCutoff: mat.alphaCutoff ?? 0.5,
    doubleSided: mat.doubleSided ?? false,
    unlit: mat.unlit ?? false,
    uvOffset: mat.uvOffset ?? [0, 0],
    uvScale: mat.uvScale ?? [1, 1],
    uvRotation: mat.uvRotation ?? 0,
    parallaxDepthScale: mat.parallaxDepthScale ?? 0.1,
    parallaxMappingMethod: mat.parallaxMappingMethod ?? 'occlusion',
    maxParallaxLayerCount: mat.maxParallaxLayerCount ?? 16,
    parallaxReliefMaxSteps: mat.parallaxReliefMaxSteps ?? 5,
    clearcoat: mat.clearcoat ?? 0,
    clearcoatPerceptualRoughness: mat.clearcoatPerceptualRoughness ?? 0.5,
    specularTransmission: mat.specularTransmission ?? 0,
    diffuseTransmission: mat.diffuseTransmission ?? 0,
    ior: mat.ior ?? 1.5,
    thickness: mat.thickness ?? 0,
    attenuationDistance: mat.attenuationDistance ?? null,
    attenuationColor: mat.attenuationColor ?? [1, 1, 1],
  };
}

/**
 * Build full LightData from partial input with defaults.
 */
export function buildLightFromPartial(partialLight: Record<string, unknown>): LightData {
  const light = zPartialLight.parse(partialLight);
  return {
    lightType: light.lightType ?? 'point',
    color: light.color ?? [1, 1, 1],
    intensity: light.intensity ?? 800,
    shadowsEnabled: light.shadowsEnabled ?? false,
    shadowDepthBias: light.shadowDepthBias ?? 0.02,
    shadowNormalBias: light.shadowNormalBias ?? 1.8,
    range: light.range ?? 20,
    radius: light.radius ?? 0,
    innerAngle: light.innerAngle ?? 0.4,
    outerAngle: light.outerAngle ?? 0.8,
  };
}

/**
 * Build full PhysicsData from partial input with defaults.
 */
export function buildPhysicsFromPartial(partialPhysics: Record<string, unknown>): PhysicsData {
  const phys = zPartialPhysics.parse(partialPhysics);
  return {
    bodyType: phys.bodyType ?? 'dynamic',
    colliderShape: phys.colliderShape ?? 'auto',
    restitution: phys.restitution ?? 0.3,
    friction: phys.friction ?? 0.5,
    density: phys.density ?? 1.0,
    gravityScale: phys.gravityScale ?? 1.0,
    lockTranslationX: phys.lockTranslationX ?? false,
    lockTranslationY: phys.lockTranslationY ?? false,
    lockTranslationZ: phys.lockTranslationZ ?? false,
    lockRotationX: phys.lockRotationX ?? false,
    lockRotationY: phys.lockRotationY ?? false,
    lockRotationZ: phys.lockRotationZ ?? false,
    isSensor: phys.isSensor ?? false,
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
    case 'character_controller': {
      const p = zCharacterControllerProps.parse(props);
      return {
        type: 'characterController',
        characterController: {
          speed: p.speed ?? 5,
          jumpHeight: p.jumpHeight ?? 8,
          gravityScale: p.gravityScale ?? 1,
          canDoubleJump: p.canDoubleJump ?? false,
        },
      };
    }
    case 'health': {
      const p = zHealthProps.parse(props);
      return {
        type: 'health',
        health: {
          maxHp: p.maxHp ?? 100,
          currentHp: p.currentHp ?? p.maxHp ?? 100,
          invincibilitySecs: p.invincibilitySecs ?? 0.5,
          respawnOnDeath: p.respawnOnDeath ?? true,
          respawnPoint: p.respawnPoint ?? [0, 1, 0],
        },
      };
    }
    case 'collectible': {
      const p = zCollectibleProps.parse(props);
      return {
        type: 'collectible',
        collectible: {
          value: p.value ?? 1,
          destroyOnCollect: p.destroyOnCollect ?? true,
          pickupSoundAsset: p.pickupSoundAsset ?? null,
          rotateSpeed: p.rotateSpeed ?? 90,
        },
      };
    }
    case 'damage_zone': {
      const p = zDamageZoneProps.parse(props);
      return {
        type: 'damageZone',
        damageZone: {
          damagePerSecond: p.damagePerSecond ?? 25,
          oneShot: p.oneShot ?? false,
        },
      };
    }
    case 'checkpoint': {
      const p = zCheckpointProps.parse(props);
      return {
        type: 'checkpoint',
        checkpoint: {
          autoSave: p.autoSave ?? true,
        },
      };
    }
    case 'teleporter': {
      const p = zTeleporterProps.parse(props);
      return {
        type: 'teleporter',
        teleporter: {
          targetPosition: p.targetPosition ?? [0, 1, 0],
          cooldownSecs: p.cooldownSecs ?? 1,
        },
      };
    }
    case 'moving_platform': {
      const p = zMovingPlatformProps.parse(props);
      return {
        type: 'movingPlatform',
        movingPlatform: {
          speed: p.speed ?? 2,
          waypoints: p.waypoints ?? [[0, 0, 0], [0, 3, 0]],
          pauseDuration: p.pauseDuration ?? 0.5,
          loopMode: p.loopMode ?? 'pingPong',
        },
      };
    }
    case 'trigger_zone': {
      const p = zTriggerZoneProps.parse(props);
      return {
        type: 'triggerZone',
        triggerZone: {
          eventName: p.eventName ?? 'trigger',
          oneShot: p.oneShot ?? false,
        },
      };
    }
    case 'spawner': {
      const p = zSpawnerProps.parse(props);
      return {
        type: 'spawner',
        spawner: {
          entityType: p.entityType ?? 'cube',
          intervalSecs: p.intervalSecs ?? 3,
          maxCount: p.maxCount ?? 5,
          spawnOffset: p.spawnOffset ?? [0, 1, 0],
          onTrigger: p.onTrigger ?? null,
        },
      };
    }
    case 'follower': {
      const p = zFollowerProps.parse(props);
      return {
        type: 'follower',
        follower: {
          targetEntityId: p.targetEntityId ?? null,
          speed: p.speed ?? 3,
          stopDistance: p.stopDistance ?? 1.5,
          lookAtTarget: p.lookAtTarget ?? true,
        },
      };
    }
    case 'projectile': {
      const p = zProjectileProps.parse(props);
      return {
        type: 'projectile',
        projectile: {
          speed: p.speed ?? 15,
          damage: p.damage ?? 10,
          lifetimeSecs: p.lifetimeSecs ?? 5,
          gravity: p.gravity ?? false,
          destroyOnHit: p.destroyOnHit ?? true,
        },
      };
    }
    case 'win_condition': {
      const p = zWinConditionProps.parse(props);
      return {
        type: 'winCondition',
        winCondition: {
          conditionType: (p.conditionType ?? 'score') as 'score' | 'collectAll' | 'reachGoal',
          targetScore: p.targetScore ?? 10,
          targetEntityId: p.targetEntityId ?? null,
        },
      };
    }

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
