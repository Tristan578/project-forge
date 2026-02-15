/**
 * 3D Platformer Game Template
 *
 * A complete platformer with floating platforms, collectible coins, moving platforms,
 * checkpoints, hazards, and win condition. Player has double jump.
 */

import type { GameTemplate } from './index';

export const PLATFORMER_TEMPLATE: GameTemplate = {
  id: 'platformer',
  name: '3D Platformer',
  description: 'Jump between floating platforms, collect coins, reach the goal flag.',
  category: 'platformer',
  difficulty: 'beginner',
  thumbnail: {
    gradient: 'linear-gradient(135deg, #22c55e, #059669)',
    icon: 'Gamepad2',
    accentColor: '#22c55e',
  },
  tags: ['3d', 'platformer', 'physics', 'collectibles'],

  inputPreset: 'platformer',

  sceneData: {
    formatVersion: 3,
    metadata: {
      name: '3D Platformer',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    environment: {
      skyboxBrightness: 1.0,
      iblIntensity: 1.0,
      iblRotationDegrees: 0,
      clearColor: [0.529, 0.808, 0.922],
      fogEnabled: false,
      fogColor: [0.5, 0.5, 0.5],
      fogStart: 10,
      fogEnd: 50,
      skyboxPreset: 'bright_day',
      skyboxAssetId: null,
    },
    ambientLight: {
      color: [1, 1, 1],
      brightness: 400,
    },
    inputBindings: {},
    postProcessing: {
      bloomEnabled: true,
      bloomIntensity: 0.1,
      bloomThreshold: 1.0,
      chromaticAberrationEnabled: false,
      chromaticAberrationIntensity: 0.0,
      colorGradingEnabled: false,
      colorGradingExposure: 0.0,
      colorGradingContrast: 1.0,
      colorGradingSaturation: 1.0,
      sharpeningEnabled: false,
      sharpeningIntensity: 0.0,
    },
    entities: [
      // Player
      {
        entityId: 'player',
        entityName: 'Player',
        entityType: 'Capsule',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 1.5, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.8, 1, 0.8],
        },
        material: {
          baseColor: [0.2, 0.4, 1.0, 1.0],
          metallic: 0.7,
          perceptualRoughness: 0.3,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'dynamic',
            colliderShape: 'capsule',
            restitution: 0.0,
            friction: 0.5,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'characterController',
            speed: 6,
            jumpHeight: 9,
            canDoubleJump: true,
            gravityScale: 1.0,
          },
          {
            type: 'health',
            maxHp: 3,
            currentHp: 3,
            respawnOnDeath: true,
          },
        ],
      },
      // Ground
      {
        entityId: 'ground',
        entityName: 'Ground',
        entityType: 'Plane',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [20, 1, 20],
        },
        material: {
          baseColor: [0.2, 0.5, 0.2, 1.0],
          metallic: 0.0,
          perceptualRoughness: 0.9,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      },
      // Platform 1
      {
        entityId: 'platform_1',
        entityName: 'Platform_1',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [4, 2, -5],
          rotation: [0, 0, 0, 1],
          scale: [3, 0.3, 3],
        },
        material: {
          baseColor: [0.5, 0.5, 0.5, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.7,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      },
      // Platform 2
      {
        entityId: 'platform_2',
        entityName: 'Platform_2',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [8, 4, -8],
          rotation: [0, 0, 0, 1],
          scale: [2.5, 0.3, 2.5],
        },
        material: {
          baseColor: [0.5, 0.5, 0.5, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.7,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      },
      // Platform 3
      {
        entityId: 'platform_3',
        entityName: 'Platform_3',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [3, 6, -12],
          rotation: [0, 0, 0, 1],
          scale: [2, 0.3, 2],
        },
        material: {
          baseColor: [0.5, 0.5, 0.5, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.7,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      },
      // Platform 4
      {
        entityId: 'platform_4',
        entityName: 'Platform_4',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [-4, 3, -6],
          rotation: [0, 0, 0, 1],
          scale: [2.5, 0.3, 2.5],
        },
        material: {
          baseColor: [0.5, 0.5, 0.5, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.7,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      },
      // Platform 5
      {
        entityId: 'platform_5',
        entityName: 'Platform_5',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [-2, 5, -10],
          rotation: [0, 0, 0, 1],
          scale: [2, 0.3, 4],
        },
        material: {
          baseColor: [0.5, 0.5, 0.5, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.7,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      },
      // Moving Platform 1
      {
        entityId: 'moving_plat_1',
        entityName: 'MovingPlat_1',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 3, -4],
          rotation: [0, 0, 0, 1],
          scale: [2.5, 0.3, 2.5],
        },
        material: {
          baseColor: [1.0, 0.6, 0.2, 1.0],
          metallic: 0.6,
          perceptualRoughness: 0.4,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'kinematic_position',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'movingPlatform',
            speed: 2,
            waypoints: [[0, 3, -4], [0, 6, -4]],
            loopMode: 'pingPong',
          },
        ],
      },
      // Moving Platform 2
      {
        entityId: 'moving_plat_2',
        entityName: 'MovingPlat_2',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [6, 5, -10],
          rotation: [0, 0, 0, 1],
          scale: [2, 0.3, 2],
        },
        material: {
          baseColor: [1.0, 0.6, 0.2, 1.0],
          metallic: 0.6,
          perceptualRoughness: 0.4,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'kinematic_position',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'movingPlatform',
            speed: 1.5,
            waypoints: [[6, 5, -10], [10, 5, -10]],
            loopMode: 'pingPong',
          },
        ],
      },
      // Moving Platform 3
      {
        entityId: 'moving_plat_3',
        entityName: 'MovingPlat_3',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [-5, 7, -14],
          rotation: [0, 0, 0, 1],
          scale: [3, 0.3, 2],
        },
        material: {
          baseColor: [1.0, 0.6, 0.2, 1.0],
          metallic: 0.6,
          perceptualRoughness: 0.4,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'kinematic_position',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'movingPlatform',
            speed: 2,
            waypoints: [[-5, 7, -14], [-5, 7, -20]],
            loopMode: 'pingPong',
          },
        ],
      },
      // Coins 1-10
      ...Array.from({ length: 10 }, (_, i) => ({
        entityId: `coin_${String(i + 1).padStart(2, '0')}`,
        entityName: `Coin_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Sphere',
        parentId: null,
        visible: true,
        transform: {
          translation: [
            [2, 3, -5], [6, 5, -8], [4, 7, -12], [-3, 4, -6], [0, 6, -10],
            [8, 5, -9], [-4, 6, -11], [1, 8, -14], [7, 6, -13], [-2, 7, -15]
          ][i] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.4, 0.4, 0.4] as [number, number, number],
        },
        material: {
          baseColor: [1.0, 0.84, 0.0, 1.0],
          metallic: 0.9,
          perceptualRoughness: 0.1,
          reflectance: 0.9,
          emissive: [0.5, 0.42, 0.0, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'dynamic',
            colliderShape: 'ball',
            restitution: 0.0,
            friction: 0.0,
            density: 1.0,
            gravityScale: 0.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: true,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'collectible',
            value: 1,
            rotateSpeed: 120,
          },
        ],
      })),
      // Checkpoint 1
      {
        entityId: 'checkpoint_1',
        entityName: 'Checkpoint_1',
        entityType: 'Cylinder',
        parentId: null,
        visible: true,
        transform: {
          translation: [4, 2.5, -5],
          rotation: [0, 0, 0, 1],
          scale: [0.3, 1.5, 0.3],
        },
        material: {
          baseColor: [0.0, 1.0, 1.0, 0.7],
          metallic: 0.2,
          perceptualRoughness: 0.3,
          reflectance: 0.5,
          emissive: [0.0, 0.5, 0.5, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'blend',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cylinder',
            restitution: 0.0,
            friction: 0.0,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: true,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'checkpoint',
            autoSave: true,
          },
        ],
      },
      // Checkpoint 2
      {
        entityId: 'checkpoint_2',
        entityName: 'Checkpoint_2',
        entityType: 'Cylinder',
        parentId: null,
        visible: true,
        transform: {
          translation: [-2, 5.5, -10],
          rotation: [0, 0, 0, 1],
          scale: [0.3, 1.5, 0.3],
        },
        material: {
          baseColor: [0.0, 1.0, 1.0, 0.7],
          metallic: 0.2,
          perceptualRoughness: 0.3,
          reflectance: 0.5,
          emissive: [0.0, 0.5, 0.5, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'blend',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cylinder',
            restitution: 0.0,
            friction: 0.0,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: true,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'checkpoint',
            autoSave: true,
          },
        ],
      },
      // Goal Flag
      {
        entityId: 'goal_flag',
        entityName: 'GoalFlag',
        entityType: 'Cone',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 9, -18],
          rotation: [0, 0, 0, 1],
          scale: [0.5, 2, 0.5],
        },
        material: {
          baseColor: [1.0, 0.1, 0.1, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.3,
          reflectance: 0.5,
          emissive: [0.8, 0.0, 0.0, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.0,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: true,
          },
          enabled: true,
        },
      },
      // Goal Platform
      {
        entityId: 'goal_platform',
        entityName: 'GoalPlatform',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 8, -18],
          rotation: [0, 0, 0, 1],
          scale: [3, 0.3, 3],
        },
        material: {
          baseColor: [1.0, 0.84, 0.0, 1.0],
          metallic: 0.9,
          perceptualRoughness: 0.2,
          reflectance: 0.9,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      },
      // Win Manager
      {
        entityId: 'win_manager',
        entityName: 'WinManager',
        entityType: 'Cube',
        parentId: null,
        visible: false,
        transform: {
          translation: [0, -10, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.1, 0.1, 0.1],
        },
        material: {
          baseColor: [1, 1, 1, 1],
          metallic: 0,
          perceptualRoughness: 0.5,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        gameComponents: [
          {
            type: 'winCondition',
            conditionType: 'collectAll',
          },
        ],
      },
      // Score Manager
      {
        entityId: 'score_manager',
        entityName: 'ScoreManager',
        entityType: 'Cube',
        parentId: null,
        visible: false,
        transform: {
          translation: [0, -10, 1],
          rotation: [0, 0, 0, 1],
          scale: [0.1, 0.1, 0.1],
        },
        material: {
          baseColor: [1, 1, 1, 1],
          metallic: 0,
          perceptualRoughness: 0.5,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
      },
      // Sun
      {
        entityId: 'sun',
        entityName: 'Sun',
        entityType: 'DirectionalLight',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 20, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        light: {
          lightType: 'directional',
          color: [1.0, 0.95, 0.9],
          intensity: 5000,
          shadowsEnabled: true,
          shadowDepthBias: 0.02,
          shadowNormalBias: 1.8,
          range: 0,
          radius: 0,
          innerAngle: 0,
          outerAngle: 0,
        },
      },
      // Fill Light
      {
        entityId: 'fill_light',
        entityName: 'FillLight',
        entityType: 'PointLight',
        parentId: null,
        visible: true,
        transform: {
          translation: [10, 15, 5],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        light: {
          lightType: 'point',
          color: [0.8, 0.85, 1.0],
          intensity: 2000,
          shadowsEnabled: false,
          shadowDepthBias: 0.02,
          shadowNormalBias: 1.8,
          range: 30,
          radius: 0,
          innerAngle: 0,
          outerAngle: 0,
        },
      },
      // Hazard 1
      {
        entityId: 'hazard_1',
        entityName: 'Hazard_1',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [6, 3, -7],
          rotation: [0, 0, 0, 1],
          scale: [1, 0.3, 1],
        },
        material: {
          baseColor: [1.0, 0.1, 0.1, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.3,
          reflectance: 0.5,
          emissive: [0.8, 0.0, 0.0, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.0,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: true,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'damageZone',
            damagePerSecond: 100,
            oneShot: true,
          },
        ],
      },
      // Hazard 2
      {
        entityId: 'hazard_2',
        entityName: 'Hazard_2',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [-3, 4, -8],
          rotation: [0, 0, 0, 1],
          scale: [0.8, 0.3, 4],
        },
        material: {
          baseColor: [1.0, 0.1, 0.1, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.3,
          reflectance: 0.5,
          emissive: [0.8, 0.0, 0.0, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.0,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: true,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'damageZone',
            damagePerSecond: 100,
            oneShot: true,
          },
        ],
      },
      // Wall L
      {
        entityId: 'wall_l',
        entityName: 'Wall_L',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [-12, 5, -10],
          rotation: [0, 0, 0, 1],
          scale: [0.5, 10, 25],
        },
        material: {
          baseColor: [0.3, 0.3, 0.3, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.8,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.5,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      },
      // Wall R
      {
        entityId: 'wall_r',
        entityName: 'Wall_R',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [14, 5, -10],
          rotation: [0, 0, 0, 1],
          scale: [0.5, 10, 25],
        },
        material: {
          baseColor: [0.3, 0.3, 0.3, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.8,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.5,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      },
    ],
  },

  scripts: {
    player: {
      source: `// Platformer Player Controller
// WASD/Arrow movement, Space to jump, double jump enabled
const SPEED = 6;
const JUMP_FORCE = 9;
let canDoubleJump = true;
let isGrounded = false;

function onUpdate(dt) {
  // Horizontal movement
  let dx = 0, dz = 0;
  if (forge.input.isPressed("move_forward")) dz -= SPEED * dt;
  if (forge.input.isPressed("move_backward")) dz += SPEED * dt;
  if (forge.input.isPressed("move_left")) dx -= SPEED * dt;
  if (forge.input.isPressed("move_right")) dx += SPEED * dt;
  forge.translate(entityId, dx, 0, dz);

  // Jump
  if (forge.input.justPressed("jump")) {
    if (isGrounded) {
      forge.physics.applyImpulse(entityId, 0, JUMP_FORCE, 0);
      isGrounded = false;
      canDoubleJump = true;
    } else if (canDoubleJump) {
      forge.physics.applyImpulse(entityId, 0, JUMP_FORCE * 0.8, 0);
      canDoubleJump = false;
    }
  }

  // Ground detection (simple Y check)
  const pos = forge.getTransform(entityId)?.position;
  if (pos && pos[1] < 0.5) {
    isGrounded = true;
  }

  // Fall reset -- respawn if player falls below world
  if (pos && pos[1] < -10) {
    forge.setPosition(entityId, 0, 2, 0);
    isGrounded = true;
  }
}`,
      enabled: true,
    },
    score_manager: {
      source: `// Score Display -- tracks collected coins and shows HUD
let score = 0;
let totalCoins = 10;

function onStart() {
  forge.ui.showText("score", "Coins: 0 / " + totalCoins, 5, 5, {
    fontSize: 22, color: "#ffdd00"
  });
  forge.ui.showText("hint", "Collect all coins and reach the flag!", 25, 92, {
    fontSize: 14, color: "#aaaaaa"
  });

  // Listen for collectible pickups on the player
  const players = forge.scene.findByName("Player");
  if (players.length > 0) {
    forge.physics.onCollisionEnter(players[0], (otherId) => {
      const name = forge.scene.getEntityName(otherId) || "";
      if (name.startsWith("Coin_")) {
        score++;
        forge.setVisibility(otherId, false);
        forge.ui.updateText("score", "Coins: " + score + " / " + totalCoins);
        if (score >= totalCoins) {
          forge.state.set("allCoinsCollected", true);
          forge.ui.showText("complete", "All coins collected! Reach the flag!", 25, 50, {
            fontSize: 24, color: "#22c55e"
          });
        }
      }
    });
  }
}

function onUpdate(_dt) {
  // Collision callbacks handle everything
}`,
      enabled: true,
    },
    win_manager: {
      source: `// Win Condition Manager -- detects when player reaches the goal
let hasWon = false;

function onStart() {
  const goals = forge.scene.findByName("GoalFlag");
  const players = forge.scene.findByName("Player");
  if (goals.length > 0 && players.length > 0) {
    forge.physics.onCollisionEnter(players[0], (otherId) => {
      if (otherId === goals[0] && !hasWon) {
        const allCollected = forge.state.get("allCoinsCollected");
        if (allCollected) {
          hasWon = true;
          forge.ui.showText("win", "YOU WIN!", 35, 40, {
            fontSize: 48, color: "#ffd700"
          });
          forge.ui.showText("winSub", "All coins collected. Congratulations!", 25, 55, {
            fontSize: 18, color: "#ffffff"
          });
        } else {
          forge.ui.showText("needCoins", "Collect all coins first!", 30, 50, {
            fontSize: 20, color: "#ff6600"
          });
          setTimeout(() => forge.ui.removeText("needCoins"), 2000);
        }
      }
    });
  }
}

function onUpdate(_dt) {}`,
      enabled: true,
    },
    goal_flag: {
      source: `// Flag rotation -- slowly spins and bobs up/down
let time = 0;

function onUpdate(dt) {
  time += dt;
  forge.rotate(entityId, 0, 60 * dt, 0);
  const baseY = 9;
  forge.setPosition(entityId,
    forge.getTransform(entityId)?.position[0] ?? 0,
    baseY + Math.sin(time * 2) * 0.3,
    forge.getTransform(entityId)?.position[2] ?? -18
  );
}`,
      enabled: true,
    },
  },
};
