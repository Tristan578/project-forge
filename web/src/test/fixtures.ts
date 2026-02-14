/**
 * Shared test fixtures for Project Forge tests.
 *
 * Provides factory functions for creating test data with sensible defaults
 * that can be partially overridden.
 */

import { vi } from 'vitest';
import type {
  SceneGraph,
  SceneNode,
  TransformData,
  MaterialData,
  LightData,
  PhysicsData,
  AudioData,
  ParticleData,
  SpawnerMode,
  EmissionShape,
  ParticleBlendMode,
  ParticleOrientation,
} from '@/stores/editorStore';

/**
 * Creates a SceneGraph with optional entity definitions.
 *
 * @example
 * ```ts
 * const graph = makeSceneGraph([
 *   { id: 'root1', name: 'Cube', children: ['child1'] },
 *   { id: 'child1', name: 'Light', parentId: 'root1' }
 * ]);
 * ```
 */
export function makeSceneGraph(
  entities: Array<{
    id: string;
    name: string;
    parentId?: string | null;
    children?: string[];
    components?: string[];
    visible?: boolean;
  }> = []
): SceneGraph {
  const nodes: Record<string, SceneNode> = {};
  const rootIds: string[] = [];

  for (const entity of entities) {
    nodes[entity.id] = {
      entityId: entity.id,
      name: entity.name,
      parentId: entity.parentId ?? null,
      children: entity.children ?? [],
      components: entity.components ?? ['Transform'],
      visible: entity.visible ?? true,
    };

    if (!entity.parentId) {
      rootIds.push(entity.id);
    }
  }

  return { nodes, rootIds };
}

/**
 * Creates a single SceneNode with defaults.
 *
 * @example
 * ```ts
 * const node = makeEntity({ name: 'MyCube', visible: false });
 * ```
 */
export function makeEntity(
  overrides: Partial<SceneNode> = {}
): SceneNode {
  return {
    entityId: overrides.entityId ?? 'entity-1',
    name: overrides.name ?? 'Entity',
    parentId: overrides.parentId ?? null,
    children: overrides.children ?? [],
    components: overrides.components ?? ['Transform'],
    visible: overrides.visible ?? true,
  };
}

/**
 * Creates TransformData for an entity.
 *
 * @example
 * ```ts
 * const transform = makeTransform('entity-1', { position: [1, 2, 3] });
 * ```
 */
export function makeTransform(
  entityId: string,
  overrides: Partial<Omit<TransformData, 'entityId'>> = {}
): TransformData {
  return {
    entityId,
    position: overrides.position ?? [0, 0, 0],
    rotation: overrides.rotation ?? [0, 0, 0],
    scale: overrides.scale ?? [1, 1, 1],
  };
}

/**
 * Creates MaterialData with PBR defaults.
 *
 * @example
 * ```ts
 * const material = makeMaterialData({ metallic: 1.0, perceptualRoughness: 0.2 });
 * ```
 */
export function makeMaterialData(
  overrides: Partial<MaterialData> = {}
): MaterialData {
  return {
    baseColor: overrides.baseColor ?? [1, 1, 1, 1],
    metallic: overrides.metallic ?? 0.0,
    perceptualRoughness: overrides.perceptualRoughness ?? 0.5,
    reflectance: overrides.reflectance ?? 0.5,
    emissive: overrides.emissive ?? [0, 0, 0, 0],
    emissiveExposureWeight: overrides.emissiveExposureWeight ?? 0.0,
    alphaMode: overrides.alphaMode ?? 'opaque',
    alphaCutoff: overrides.alphaCutoff ?? 0.5,
    doubleSided: overrides.doubleSided ?? false,
    unlit: overrides.unlit ?? false,
    baseColorTexture: overrides.baseColorTexture ?? null,
    normalMapTexture: overrides.normalMapTexture ?? null,
    metallicRoughnessTexture: overrides.metallicRoughnessTexture ?? null,
    emissiveTexture: overrides.emissiveTexture ?? null,
    occlusionTexture: overrides.occlusionTexture ?? null,
    uvOffset: overrides.uvOffset ?? [0, 0],
    uvScale: overrides.uvScale ?? [1, 1],
    uvRotation: overrides.uvRotation ?? 0,
    depthMapTexture: overrides.depthMapTexture ?? null,
    parallaxDepthScale: overrides.parallaxDepthScale ?? 0.1,
    parallaxMappingMethod: overrides.parallaxMappingMethod ?? 'occlusion',
    maxParallaxLayerCount: overrides.maxParallaxLayerCount ?? 16,
    parallaxReliefMaxSteps: overrides.parallaxReliefMaxSteps ?? 5,
    clearcoat: overrides.clearcoat ?? 0.0,
    clearcoatPerceptualRoughness: overrides.clearcoatPerceptualRoughness ?? 0.0,
    clearcoatTexture: overrides.clearcoatTexture ?? null,
    clearcoatRoughnessTexture: overrides.clearcoatRoughnessTexture ?? null,
    clearcoatNormalTexture: overrides.clearcoatNormalTexture ?? null,
    specularTransmission: overrides.specularTransmission ?? 0.0,
    diffuseTransmission: overrides.diffuseTransmission ?? 0.0,
    ior: overrides.ior ?? 1.5,
    thickness: overrides.thickness ?? 0.0,
    attenuationDistance: overrides.attenuationDistance ?? null,
    attenuationColor: overrides.attenuationColor ?? [1, 1, 1],
  };
}

/**
 * Creates LightData with defaults for a specific light type.
 *
 * @example
 * ```ts
 * const pointLight = makeLightData('point', { intensity: 1000 });
 * const dirLight = makeLightData('directional');
 * ```
 */
export function makeLightData(
  type: 'point' | 'directional' | 'spot' = 'point',
  overrides: Partial<LightData> = {}
): LightData {
  return {
    lightType: type,
    color: overrides.color ?? [1, 1, 1],
    intensity: overrides.intensity ?? 800,
    shadowsEnabled: overrides.shadowsEnabled ?? true,
    shadowDepthBias: overrides.shadowDepthBias ?? 0.02,
    shadowNormalBias: overrides.shadowNormalBias ?? 0.6,
    range: overrides.range ?? 20.0,
    radius: overrides.radius ?? 0.0,
    innerAngle: overrides.innerAngle ?? 0.0,
    outerAngle: overrides.outerAngle ?? Math.PI / 4,
  };
}

/**
 * Creates PhysicsData with defaults.
 *
 * @example
 * ```ts
 * const physics = makePhysicsData({ bodyType: 'dynamic', restitution: 0.8 });
 * ```
 */
export function makePhysicsData(
  overrides: Partial<PhysicsData> = {}
): PhysicsData {
  return {
    bodyType: overrides.bodyType ?? 'dynamic',
    colliderShape: overrides.colliderShape ?? 'cuboid',
    restitution: overrides.restitution ?? 0.3,
    friction: overrides.friction ?? 0.5,
    density: overrides.density ?? 1.0,
    gravityScale: overrides.gravityScale ?? 1.0,
    lockTranslationX: overrides.lockTranslationX ?? false,
    lockTranslationY: overrides.lockTranslationY ?? false,
    lockTranslationZ: overrides.lockTranslationZ ?? false,
    lockRotationX: overrides.lockRotationX ?? false,
    lockRotationY: overrides.lockRotationY ?? false,
    lockRotationZ: overrides.lockRotationZ ?? false,
    isSensor: overrides.isSensor ?? false,
  };
}

/**
 * Creates AudioData with defaults.
 *
 * @example
 * ```ts
 * const audio = makeAudioData({ assetId: 'audio-123', volume: 0.8 });
 * ```
 */
export function makeAudioData(
  overrides: Partial<AudioData> = {}
): AudioData {
  return {
    assetId: overrides.assetId ?? null,
    volume: overrides.volume ?? 1.0,
    pitch: overrides.pitch ?? 1.0,
    loopAudio: overrides.loopAudio ?? false,
    spatial: overrides.spatial ?? false,
    maxDistance: overrides.maxDistance ?? 10.0,
    refDistance: overrides.refDistance ?? 1.0,
    rolloffFactor: overrides.rolloffFactor ?? 1.0,
    autoplay: overrides.autoplay ?? false,
    bus: overrides.bus ?? 'sfx',
  };
}

/**
 * Creates ParticleData with defaults.
 *
 * @example
 * ```ts
 * const particles = makeParticleData({ preset: 'fire', maxParticles: 500 });
 * ```
 */
export function makeParticleData(
  overrides: Partial<ParticleData> = {}
): ParticleData {
  const spawnerMode: SpawnerMode = overrides.spawnerMode ?? { type: 'continuous', rate: 30 };
  const emissionShape: EmissionShape = overrides.emissionShape ?? { type: 'point' };
  const blendMode: ParticleBlendMode = overrides.blendMode ?? 'additive';
  const orientation: ParticleOrientation = overrides.orientation ?? 'billboard';

  return {
    preset: overrides.preset ?? 'custom',
    spawnerMode,
    maxParticles: overrides.maxParticles ?? 200,
    lifetimeMin: overrides.lifetimeMin ?? 1.0,
    lifetimeMax: overrides.lifetimeMax ?? 2.0,
    emissionShape,
    velocityMin: overrides.velocityMin ?? [0, 0, 0],
    velocityMax: overrides.velocityMax ?? [0, 1, 0],
    acceleration: overrides.acceleration ?? [0, -9.8, 0],
    linearDrag: overrides.linearDrag ?? 0.0,
    sizeStart: overrides.sizeStart ?? 0.5,
    sizeEnd: overrides.sizeEnd ?? 0.1,
    sizeKeyframes: overrides.sizeKeyframes ?? [],
    colorGradient: overrides.colorGradient ?? [
      { position: 0.0, color: [1, 1, 1, 1] },
      { position: 1.0, color: [1, 1, 1, 0] },
    ],
    blendMode,
    orientation,
    worldSpace: overrides.worldSpace ?? false,
  };
}

/**
 * Creates a mock command dispatcher that records all calls.
 *
 * @returns A vitest mock function that tracks [commandName, payload] pairs
 *
 * @example
 * ```ts
 * const dispatch = createMockDispatch();
 * setCommandDispatcher(dispatch);
 *
 * useEditorStore.getState().spawnEntity('cube', 'MyCube');
 *
 * expect(dispatch).toHaveBeenCalledWith('spawn_entity', {
 *   entityType: 'cube',
 *   name: 'MyCube'
 * });
 * ```
 */
export function createMockDispatch() {
  return vi.fn() as ReturnType<typeof vi.fn>;
}
