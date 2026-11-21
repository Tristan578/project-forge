import type { Prefab, PrefabSnapshot } from './prefabStore';

function makeBuiltIn(id: string, name: string, category: string, description: string, snapshot: PrefabSnapshot): Prefab {
  return { id, name, category, description, snapshot, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' };
}

export const BUILT_IN_PREFABS: Prefab[] = [
  makeBuiltIn('builtin_player', 'Basic Player', 'Characters', 'Capsule with character controller script and physics', {
    entityType: 'capsule',
    name: 'Player',
    transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    material: {
      baseColor: [0.2, 0.5, 0.9, 1], metallic: 0, perceptualRoughness: 0.5, reflectance: 0.5,
      emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5,
      doubleSided: false, unlit: false, uvOffset: [0, 0], uvScale: [1, 1], uvRotation: 0,
      parallaxDepthScale: 0.1, parallaxMappingMethod: 'occlusion', maxParallaxLayerCount: 16,
      parallaxReliefMaxSteps: 5, clearcoat: 0, clearcoatPerceptualRoughness: 0.5,
      specularTransmission: 0, diffuseTransmission: 0, ior: 1.5, thickness: 0,
      attenuationDistance: null, attenuationColor: [1, 1, 1],
    },
    physics: {
      bodyType: 'dynamic', colliderShape: 'capsule', restitution: 0.1, friction: 0.7,
      density: 1.0, gravityScale: 1.0, lockTranslationX: false, lockTranslationY: false,
      lockTranslationZ: false, lockRotationX: true, lockRotationY: true, lockRotationZ: true,
      isSensor: false,
    },
    script: {
      source: `const speed = 5;\nconst jumpForce = 8;\n\nfunction onUpdate(dt) {\n  let dx = 0, dz = 0;\n  if (forge.input.isPressed("move_forward")) dz -= speed * dt;\n  if (forge.input.isPressed("move_backward")) dz += speed * dt;\n  if (forge.input.isPressed("move_left")) dx -= speed * dt;\n  if (forge.input.isPressed("move_right")) dx += speed * dt;\n  forge.translate(entityId, dx, 0, dz);\n  if (forge.input.justPressed("jump")) {\n    forge.physics.applyImpulse(entityId, 0, jumpForce, 0);\n  }\n}`,
      enabled: true, template: 'character_controller',
    },
  }),

  makeBuiltIn('builtin_collectible', 'Spinning Collectible', 'Items', 'Rotating torus with gold emissive material', {
    entityType: 'torus',
    name: 'Collectible',
    transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
    material: {
      baseColor: [1.0, 0.766, 0.336, 1], metallic: 1.0, perceptualRoughness: 0.2, reflectance: 0.5,
      emissive: [0.5, 0.38, 0.17, 2.0], emissiveExposureWeight: 0.5, alphaMode: 'opaque', alphaCutoff: 0.5,
      doubleSided: false, unlit: false, uvOffset: [0, 0], uvScale: [1, 1], uvRotation: 0,
      parallaxDepthScale: 0.1, parallaxMappingMethod: 'occlusion', maxParallaxLayerCount: 16,
      parallaxReliefMaxSteps: 5, clearcoat: 0, clearcoatPerceptualRoughness: 0.5,
      specularTransmission: 0, diffuseTransmission: 0, ior: 1.5, thickness: 0,
      attenuationDistance: null, attenuationColor: [1, 1, 1],
    },
    script: {
      source: `function onUpdate(dt) {\n  forge.rotate(entityId, 0, 90 * dt, 0);\n}`,
      enabled: true, template: 'rotating_object',
    },
  }),

  makeBuiltIn('builtin_physics_crate', 'Physics Crate', 'Props', 'Wooden cube with dynamic physics', {
    entityType: 'cube',
    name: 'Crate',
    transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    material: {
      baseColor: [0.52, 0.33, 0.15, 1], metallic: 0, perceptualRoughness: 0.7, reflectance: 0.5,
      emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5,
      doubleSided: false, unlit: false, uvOffset: [0, 0], uvScale: [1, 1], uvRotation: 0,
      parallaxDepthScale: 0.1, parallaxMappingMethod: 'occlusion', maxParallaxLayerCount: 16,
      parallaxReliefMaxSteps: 5, clearcoat: 0, clearcoatPerceptualRoughness: 0.5,
      specularTransmission: 0, diffuseTransmission: 0, ior: 1.5, thickness: 0,
      attenuationDistance: null, attenuationColor: [1, 1, 1],
    },
    physics: {
      bodyType: 'dynamic', colliderShape: 'cuboid', restitution: 0.3, friction: 0.5,
      density: 1.0, gravityScale: 1.0, lockTranslationX: false, lockTranslationY: false,
      lockTranslationZ: false, lockRotationX: false, lockRotationY: false, lockRotationZ: false,
      isSensor: false,
    },
  }),

  makeBuiltIn('builtin_light_rig', 'Warm Light', 'Lights', 'Point light with warm color', {
    entityType: 'point_light',
    name: 'Warm Light',
    transform: { position: [0, 3, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    light: {
      lightType: 'point', color: [1.0, 0.9, 0.7], intensity: 1500,
      range: 15, radius: 0, innerAngle: 0, outerAngle: 0,
      shadowsEnabled: true, shadowDepthBias: 0.02, shadowNormalBias: 0.6,
    },
  }),

  makeBuiltIn('builtin_patrol_enemy', 'Patrol Enemy', 'Characters', 'Sphere with patrol script and red material', {
    entityType: 'sphere',
    name: 'Patrol Enemy',
    transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    material: {
      baseColor: [0.8, 0.15, 0.1, 1], metallic: 0, perceptualRoughness: 0.5, reflectance: 0.5,
      emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5,
      doubleSided: false, unlit: false, uvOffset: [0, 0], uvScale: [1, 1], uvRotation: 0,
      parallaxDepthScale: 0.1, parallaxMappingMethod: 'occlusion', maxParallaxLayerCount: 16,
      parallaxReliefMaxSteps: 5, clearcoat: 0, clearcoatPerceptualRoughness: 0.5,
      specularTransmission: 0, diffuseTransmission: 0, ior: 1.5, thickness: 0,
      attenuationDistance: null, attenuationColor: [1, 1, 1],
    },
    physics: {
      bodyType: 'dynamic', colliderShape: 'ball', restitution: 0.2, friction: 0.5,
      density: 1.0, gravityScale: 1.0, lockTranslationX: false, lockTranslationY: false,
      lockTranslationZ: false, lockRotationX: false, lockRotationY: false, lockRotationZ: false,
      isSensor: false,
    },
    script: {
      source: `const waypointA = [0, 0.5, -5];\nconst waypointB = [0, 0.5, 5];\nconst speed = 2;\nlet target = waypointB;\n\nfunction onUpdate(dt) {\n  const pos = forge.getTransform(entityId);\n  if (!pos) return;\n  const dx = target[0] - pos.position[0];\n  const dz = target[2] - pos.position[2];\n  const dist = Math.sqrt(dx*dx + dz*dz);\n  if (dist < 0.5) {\n    target = target === waypointA ? waypointB : waypointA;\n  }\n  const nx = (dx/dist) * speed * dt;\n  const nz = (dz/dist) * speed * dt;\n  forge.translate(entityId, nx, 0, nz);\n}`,
      enabled: true, template: 'enemy_patrol',
    },
  }),

  makeBuiltIn('builtin_bouncy_ball', 'Bouncy Ball', 'Props', 'Sphere with high restitution', {
    entityType: 'sphere',
    name: 'Bouncy Ball',
    transform: { position: [0, 3, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
    material: {
      baseColor: [0.9, 0.2, 0.15, 1], metallic: 0, perceptualRoughness: 0.3, reflectance: 0.5,
      emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5,
      doubleSided: false, unlit: false, uvOffset: [0, 0], uvScale: [1, 1], uvRotation: 0,
      parallaxDepthScale: 0.1, parallaxMappingMethod: 'occlusion', maxParallaxLayerCount: 16,
      parallaxReliefMaxSteps: 5, clearcoat: 0, clearcoatPerceptualRoughness: 0.5,
      specularTransmission: 0, diffuseTransmission: 0, ior: 1.5, thickness: 0,
      attenuationDistance: null, attenuationColor: [1, 1, 1],
    },
    physics: {
      bodyType: 'dynamic', colliderShape: 'ball', restitution: 0.95, friction: 0.3,
      density: 0.5, gravityScale: 1.0, lockTranslationX: false, lockTranslationY: false,
      lockTranslationZ: false, lockRotationX: false, lockRotationY: false, lockRotationZ: false,
      isSensor: false,
    },
  }),

  makeBuiltIn('builtin_glass_panel', 'Glass Panel', 'Props', 'Transparent glass plane', {
    entityType: 'plane',
    name: 'Glass Panel',
    transform: { position: [0, 1, 0], rotation: [90, 0, 0], scale: [2, 2, 1] },
    material: {
      baseColor: [1.0, 1.0, 1.0, 0.1], metallic: 0, perceptualRoughness: 0.05, reflectance: 0.5,
      emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'blend', alphaCutoff: 0.5,
      doubleSided: true, unlit: false, uvOffset: [0, 0], uvScale: [1, 1], uvRotation: 0,
      parallaxDepthScale: 0.1, parallaxMappingMethod: 'occlusion', maxParallaxLayerCount: 16,
      parallaxReliefMaxSteps: 5, clearcoat: 0, clearcoatPerceptualRoughness: 0.5,
      specularTransmission: 0.9, diffuseTransmission: 0, ior: 1.5, thickness: 0,
      attenuationDistance: null, attenuationColor: [1, 1, 1],
    },
  }),

  makeBuiltIn('builtin_fire', 'Fire Effect', 'Effects', 'Empty entity with fire particle preset', {
    entityType: 'cube',
    name: 'Fire',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.1, 0.1, 0.1] },
    particle: {
      preset: 'fire',
      spawnerMode: { type: 'continuous', rate: 50.0 },
      maxParticles: 500,
      lifetimeMin: 1.2,
      lifetimeMax: 1.8,
      emissionShape: { type: 'point' },
      velocityMin: [0, 1.5, 0],
      velocityMax: [0, 2.5, 0],
      acceleration: [0, 0.5, 0],
      linearDrag: 0.1,
      sizeStart: 0.3,
      sizeEnd: 0.1,
      sizeKeyframes: [
        { position: 0, size: 0.3 },
        { position: 0.5, size: 0.5 },
        { position: 1, size: 0.1 },
      ],
      colorGradient: [
        { position: 0, color: [1.0, 0.5, 0.0, 1.0] },
        { position: 0.5, color: [1.0, 0.2, 0.0, 0.7] },
        { position: 1, color: [0.2, 0.0, 0.0, 0.0] },
      ],
      blendMode: 'additive',
      orientation: 'billboard',
      worldSpace: false,
    },
  }),
];
