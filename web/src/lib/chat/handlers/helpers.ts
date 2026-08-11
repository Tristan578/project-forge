/**
 * Helper functions shared across tool call handlers.
 */

import { z } from 'zod';
import type { MaterialData, LightData, PhysicsData, SceneNode } from './types';
import { F32_SAFE_MAX, zVec2, zVec3, zVec4 } from './types';
import { parseGameComponentWire } from '@/lib/engine/gameComponentWire';
import type { GameComponentData } from '@/stores/slices/types';

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

// `F32_SAFE_MAX` is the ceiling for a scalar with no tighter reading of its
// own: every number here is cast to `f32` on the Rust side, so a finite value
// past `f32::MAX` arrives as `inf` and propagates NaN through the physics and
// render graphs rather than merely looking wrong. Zod rejects `Infinity` and
// `NaN` outright; this covers the finite-but-unusable band beneath them. It
// lives in `./types` because the vector schemas need the same bound.

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
 * The same, for a field the engine holds as an integer.
 *
 * Two different mechanisms sit behind these, and both want rounding. The
 * material fields are real serde — `parallax_relief_max_steps` is an
 * `Option<u32>`, and serde performs no float-to-int coercion, so `5.5` fails
 * the *whole* `update_material` payload; `dispatchCommand` returns void, so
 * nothing anywhere reports it. The game-component fields are read by the
 * engine's own `prop_u32`, which rounds and clamps rather than rejecting — so
 * there the risk is not a dropped command but a store that records `1.5` for
 * an entity the engine gave `2`.
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
 *
 * A thin alias for `buildStoreComponent`, which is the single place every
 * game-component field is coerced the way the engine coerces it. This function
 * used to carry its own switch, and the two copies had already diverged: the
 * `win_condition` case cast `conditionType` straight through, so an LLM answering
 * `'collect_all'` (or `'survive'`, or anything at all) was stored verbatim while
 * the engine's `match` fell through to `WinConditionType::Score`. Nothing reported
 * the disagreement — `dispatchCommand` returns `void` — so the inspector showed one
 * win condition and the running game used another. The same divergence was open on
 * every numeric field, which the old copy passed through unranged.
 */
export function buildGameComponentFromInput(
  type: string,
  props: Record<string, unknown>
): GameComponentData | null {
  // `parseGameComponentWire`, not `buildStoreComponent`: every caller here speaks
  // the ENGINE's vocabulary — `dialogue_trigger` with `interactionRadius` and
  // `autoStart` — and `dialogueTrigger` is the one component whose store field
  // names diverge from the Rust struct's. `buildStoreComponent` reads store names,
  // so it would answer a fully-defaulted dialogue trigger for a bag that specified
  // every field, and nothing downstream reports the difference.
  return parseGameComponentWire({ componentType: type, properties: props });
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
