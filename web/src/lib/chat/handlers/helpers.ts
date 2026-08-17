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

/**
 * Largest magnitude a model-supplied scalar may carry into the engine.
 *
 * Every one of these numbers is cast to `f32` on the Rust side while JSON
 * carries f64, so a *finite* value past `f32::MAX` (~3.4e38) arrives as `inf`
 * and poisons whatever it touches — an infinite density or roughness
 * propagates NaN through the physics and render graphs rather than merely
 * looking wrong. Zod rejects `Infinity` and `NaN` outright; this covers the
 * finite-but-unusable band beneath them, for fields with no tighter bound of
 * their own.
 */
const F32_SAFE_MAX = 1e30;

/**
 * A model-supplied number, clamped into the range the field can actually mean.
 *
 * Out of range clamps rather than rejects. `metallic: 5` means "as metallic as
 * it goes", and answering that with the 0 default reads it worse than
 * answering with 1. Input that is not a finite number at all — a string,
 * `null`, `NaN`, `Infinity` — carries no such reading, so `.catch(undefined)`
 * drops it and the caller's own default applies.
 *
 * That `.catch` is load-bearing well beyond the one field: these schemas are
 * parsed inside chat tool handlers, and a ZodError thrown out of one aborts
 * the entire compound action. Without it a single nonsense number would cost
 * the user every entity in the batch.
 */
function zNum(min: number, max: number = F32_SAFE_MAX) {
  return z
    .number()
    .transform((v) => Math.min(max, Math.max(min, v)))
    .optional()
    .catch(undefined);
}

/**
 * The same, for a field the engine deserializes into an integer type.
 *
 * serde performs no float-to-int coercion, so `value: 1.5` against a `u32`
 * fails the whole payload — and `dispatchCommand` returns void, so nothing
 * anywhere reports the rejection. Rounding here is what stops a plausible
 * model answer from silently dropping the command.
 */
function zInt(min: number, max: number = 1e9) {
  return z
    .number()
    .transform((v) => Math.round(Math.min(max, Math.max(min, v))))
    .optional()
    .catch(undefined);
}

/**
 * Any non-numeric field: keep its type check, but fall back to the caller's
 * default instead of throwing, for the same reason `zNum` catches.
 */
function zOpt<S extends z.ZodType>(schema: S) {
  return schema.optional().catch(undefined);
}

/**
 * Parse a partial spec without ever throwing.
 *
 * Each field catches on its own, so a failure at this level means the input
 * was not an object at all — `light: "bright"`, say, which the compound
 * handlers pass through with a bare cast. No field can be read out of that,
 * which is the same state as supplying none, so it takes the same answer: an
 * empty spec, and every default applies.
 */
function parsePartial<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const empty = schema.safeParse({});
  return empty.success ? empty.data : ({} as z.output<S>);
}

const zPartialMaterial = z.object({
  baseColor: zOpt(zVec4),
  metallic: zNum(0, 1),
  perceptualRoughness: zNum(0, 1),
  reflectance: zNum(0, 1),
  emissive: zOpt(zVec4),
  emissiveExposureWeight: zNum(0, 1),
  alphaMode: zOpt(z.enum(['opaque', 'blend', 'mask'])),
  alphaCutoff: zNum(0, 1),
  doubleSided: zOpt(z.boolean()),
  unlit: zOpt(z.boolean()),
  uvOffset: zOpt(zVec2),
  uvScale: zOpt(zVec2),
  // An angle wraps, so any finite rotation is meaningful.
  uvRotation: zNum(-F32_SAFE_MAX),
  parallaxDepthScale: zNum(0, 1),
  parallaxMappingMethod: zOpt(z.enum(['occlusion', 'relief'])),
  maxParallaxLayerCount: zNum(1, 64),
  // `parallax_relief_max_steps` is a u32 in the engine.
  parallaxReliefMaxSteps: zInt(0, 64),
  clearcoat: zNum(0, 1),
  clearcoatPerceptualRoughness: zNum(0, 1),
  specularTransmission: zNum(0, 1),
  diffuseTransmission: zNum(0, 1),
  // Index of refraction: 1 is vacuum, and nothing the engine renders is above
  // diamond's 2.42.
  ior: zNum(1, 3),
  thickness: zNum(0),
  attenuationDistance: zNum(0),
  attenuationColor: zOpt(zVec3),
}).passthrough();

const zPartialLight = z.object({
  lightType: zOpt(z.enum(['point', 'directional', 'spot'])),
  color: zOpt(zVec3),
  intensity: zNum(0),
  shadowsEnabled: zOpt(z.boolean()),
  shadowDepthBias: zNum(0, 100),
  shadowNormalBias: zNum(0, 100),
  range: zNum(0),
  radius: zNum(0),
  // Bevy clamps a spot cone at a half-angle of pi/2; past that the light is
  // no longer a cone at all.
  innerAngle: zNum(0, Math.PI / 2),
  outerAngle: zNum(0, Math.PI / 2),
}).passthrough();

const zPartialPhysics = z.object({
  bodyType: zOpt(z.enum(['dynamic', 'fixed', 'kinematic_position', 'kinematic_velocity'])),
  colliderShape: zOpt(z.enum(['cuboid', 'ball', 'cylinder', 'capsule', 'auto'])),
  // Restitution above 1 returns more energy than the impact carried, so a
  // bouncing body accelerates until the solver gives up.
  restitution: zNum(0, 1),
  friction: zNum(0, 100),
  // Zero density is a zero-mass dynamic body, which Rapier cannot integrate.
  density: zNum(0.0001),
  gravityScale: zNum(-1000, 1000),
  lockTranslationX: zOpt(z.boolean()),
  lockTranslationY: zOpt(z.boolean()),
  lockTranslationZ: zOpt(z.boolean()),
  lockRotationX: zOpt(z.boolean()),
  lockRotationY: zOpt(z.boolean()),
  lockRotationZ: zOpt(z.boolean()),
  isSensor: zOpt(z.boolean()),
}).passthrough();

// Per-case game component prop schemas
/**
 * An identifier or asset key. Dropped rather than truncated when it runs long:
 * half an entity id names the wrong entity, where no id at all falls back to
 * the field's default.
 */
const zName = zOpt(z.string().max(256));
const zNullableName = zOpt(z.string().max(256).nullable());

/** Seconds. One hour is well past any interval a game loop can use. */
const MAX_SECS = 3600;
/** Metres per second, and the ceiling for anything else measured in units/sec. */
const MAX_SPEED = 10000;

const zCharacterControllerProps = z.object({
  speed: zNum(0, MAX_SPEED),
  jumpHeight: zNum(0, MAX_SPEED),
  gravityScale: zNum(-1000, 1000),
  canDoubleJump: zOpt(z.boolean()),
}).passthrough();

const zHealthProps = z.object({
  maxHp: zNum(0),
  currentHp: zNum(0),
  invincibilitySecs: zNum(0, MAX_SECS),
  respawnOnDeath: zOpt(z.boolean()),
  respawnPoint: zOpt(zVec3),
  despawnOnDeath: zOpt(z.boolean()),
}).passthrough();

const zCollectibleProps = z.object({
  // `CollectibleData::value` is a u32, so a negative or fractional score is a
  // hard serde reject that drops the whole command.
  value: zInt(0),
  destroyOnCollect: zOpt(z.boolean()),
  pickupSoundAsset: zNullableName,
  // Degrees per second; the sign picks the direction.
  rotateSpeed: zNum(-36000, 36000),
}).passthrough();

const zDamageZoneProps = z.object({
  damagePerSecond: zNum(0),
  oneShot: zOpt(z.boolean()),
}).passthrough();

const zCheckpointProps = z.object({
  autoSave: zOpt(z.boolean()),
}).passthrough();

const zTeleporterProps = z.object({
  targetPosition: zOpt(zVec3),
  cooldownSecs: zNum(0, MAX_SECS),
}).passthrough();

const zMovingPlatformProps = z.object({
  speed: zNum(0, MAX_SPEED),
  waypoints: zOpt(z.array(zVec3)),
  pauseDuration: zNum(0, MAX_SECS),
  loopMode: zOpt(z.enum(['pingPong', 'loop', 'once'])),
}).passthrough();

const zTriggerZoneProps = z.object({
  eventName: zName,
  oneShot: zOpt(z.boolean()),
}).passthrough();

const zSpawnerProps = z.object({
  entityType: zName,
  // A zero interval spawns every frame until max_count, which reads as a hang.
  intervalSecs: zNum(0.01, MAX_SECS),
  // `SpawnerData::max_count` is a u32.
  maxCount: zInt(0, 10000),
  spawnOffset: zOpt(zVec3),
  onTrigger: zNullableName,
}).passthrough();

const zFollowerProps = z.object({
  targetEntityId: zNullableName,
  speed: zNum(0, MAX_SPEED),
  stopDistance: zNum(0),
  lookAtTarget: zOpt(z.boolean()),
}).passthrough();

const zProjectileProps = z.object({
  speed: zNum(0, MAX_SPEED),
  damage: zNum(0),
  lifetimeSecs: zNum(0, MAX_SECS),
  gravity: zOpt(z.boolean()),
  destroyOnHit: zOpt(z.boolean()),
}).passthrough();

const zWinConditionProps = z.object({
  conditionType: zName,
  // `WinConditionData::target_score` is an Option<u32>.
  targetScore: zInt(0),
  targetEntityId: zNullableName,
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
  const mat = parsePartial(zPartialMaterial, partialMat);
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
  const light = parsePartial(zPartialLight, partialLight);
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
  const phys = parsePartial(zPartialPhysics, partialPhysics);
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
      const p = parsePartial(zCharacterControllerProps, props);
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
      const p = parsePartial(zHealthProps, props);
      return {
        type: 'health',
        health: {
          maxHp: p.maxHp ?? 100,
          currentHp: p.currentHp ?? p.maxHp ?? 100,
          invincibilitySecs: p.invincibilitySecs ?? 0.5,
          respawnOnDeath: p.respawnOnDeath ?? true,
          respawnPoint: p.respawnPoint ?? [0, 1, 0],
          despawnOnDeath: p.despawnOnDeath ?? true,
        },
      };
    }
    case 'collectible': {
      const p = parsePartial(zCollectibleProps, props);
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
      const p = parsePartial(zDamageZoneProps, props);
      return {
        type: 'damageZone',
        damageZone: {
          damagePerSecond: p.damagePerSecond ?? 25,
          oneShot: p.oneShot ?? false,
        },
      };
    }
    case 'checkpoint': {
      const p = parsePartial(zCheckpointProps, props);
      return {
        type: 'checkpoint',
        checkpoint: {
          autoSave: p.autoSave ?? true,
        },
      };
    }
    case 'teleporter': {
      const p = parsePartial(zTeleporterProps, props);
      return {
        type: 'teleporter',
        teleporter: {
          targetPosition: p.targetPosition ?? [0, 1, 0],
          cooldownSecs: p.cooldownSecs ?? 1,
        },
      };
    }
    case 'moving_platform': {
      const p = parsePartial(zMovingPlatformProps, props);
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
      const p = parsePartial(zTriggerZoneProps, props);
      return {
        type: 'triggerZone',
        triggerZone: {
          eventName: p.eventName ?? 'trigger',
          oneShot: p.oneShot ?? false,
        },
      };
    }
    case 'spawner': {
      const p = parsePartial(zSpawnerProps, props);
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
      const p = parsePartial(zFollowerProps, props);
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
      const p = parsePartial(zProjectileProps, props);
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
      const p = parsePartial(zWinConditionProps, props);
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
