/**
 * Walking Simulator / Explorer Game Template
 *
 * Explore a serene environment, find glowing orbs, discover story fragments.
 */

import type { GameTemplate } from './index';

export const EXPLORER_TEMPLATE: GameTemplate = {
  id: 'explorer',
  name: 'Walking Simulator',
  description: 'Explore a serene environment. Find glowing orbs, discover story fragments.',
  category: 'explorer',
  difficulty: 'beginner',
  thumbnail: {
    gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)',
    icon: 'Compass',
    accentColor: '#06b6d4',
  },
  tags: ['3d', 'exploration', 'narrative', 'ambient'],

  inputPreset: 'fps',

  sceneData: {
    formatVersion: 3,
    metadata: {
      name: 'Walking Simulator',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    environment: {
      skyboxBrightness: 1.0,
      iblIntensity: 1.0,
      iblRotationDegrees: 0,
      clearColor: [0.4, 0.35, 0.3],
      fogEnabled: true,
      fogColor: [0.4, 0.35, 0.3],
      fogStart: 15,
      fogEnd: 50,
      skyboxPreset: 'sunset',
      skyboxAssetId: null,
    },
    ambientLight: {
      color: [1.0, 0.95, 0.85],
      brightness: 300,
    },
    inputBindings: {},
    postProcessing: {
      bloomEnabled: true,
      bloomIntensity: 0.15,
      bloomThreshold: 1.0,
      chromaticAberrationEnabled: false,
      chromaticAberrationIntensity: 0.0,
      colorGradingEnabled: true,
      colorGradingExposure: 0.05,
      colorGradingContrast: 1.05,
      colorGradingSaturation: 1.1,
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
          translation: [0, 1, 8],
          rotation: [0, 0, 0, 1],
          scale: [0.5, 0.9, 0.5],
        },
        material: {
          baseColor: [0.2, 0.3, 0.5, 1.0],
          metallic: 0.5,
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
            bodyType: 'dynamic',
            colliderShape: 'capsule',
            restitution: 0.0,
            friction: 0.5,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: true,
            lockRotationY: true,
            lockRotationZ: true,
            isSensor: false,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'characterController',
            speed: 3,
            jumpHeight: 4,
            canDoubleJump: false,
            gravityScale: 1.0,
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
          scale: [30, 1, 30],
        },
        material: {
          baseColor: [0.3, 0.6, 0.3, 1.0],
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
      // Trees 1-5 (simplified as cylinders)
      ...([[5, 1.5, -3], [-4, 1.5, -5], [8, 1.5, -8], [-7, 1.5, -2], [3, 1.5, -10]] as [number, number, number][]).map((pos, i) => ({
        entityId: `tree_${String(i + 1).padStart(2, '0')}`,
        entityName: `Tree_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Cylinder',
        parentId: null,
        visible: true,
        transform: {
          translation: pos,
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.4, 3, 0.4] as [number, number, number],
        },
        material: {
          baseColor: [0.4, 0.3, 0.2, 1.0],
          metallic: 0.0,
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
            colliderShape: 'cylinder',
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
      })),
      // Story Orbs 1-5
      ...Array.from({ length: 5 }, (_, i) => ({
        entityId: `orb_${String(i + 1).padStart(2, '0')}`,
        entityName: `Orb_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Sphere',
        parentId: null,
        visible: true,
        transform: {
          translation: [
            [2, -6, 4, -3, 0][i],
            [1.5, 2, 1.8, 2.5, 3][i],
            [-4, -7, -9, -6, -12][i]
          ] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.3, 0.3, 0.3] as [number, number, number],
        },
        material: {
          baseColor: [
            [0.5, 0.3, 1.0, 0.9],
            [0.3, 0.8, 1.0, 0.9],
            [1.0, 0.5, 0.8, 0.9],
            [0.8, 1.0, 0.3, 0.9],
            [1.0, 0.8, 0.3, 0.9],
          ][i],
          metallic: 0.3,
          perceptualRoughness: 0.2,
          reflectance: 0.8,
          emissive: [
            [0.5, 0.3, 1.0, 1.0],
            [0.3, 0.8, 1.0, 1.0],
            [1.0, 0.5, 0.8, 1.0],
            [0.8, 1.0, 0.3, 1.0],
            [1.0, 0.8, 0.3, 1.0],
          ][i],
          emissiveExposureWeight: 1,
          alphaMode: 'blend',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
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
            rotateSpeed: 0,
          },
        ],
      })),
      // Rocks 1-4
      ...Array.from({ length: 4 }, (_, i) => ({
        entityId: `rock_${String(i + 1).padStart(2, '0')}`,
        entityName: `Rock_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Sphere',
        parentId: null,
        visible: true,
        transform: {
          translation: [
            [6, -8, 4, -5][i],
            0.5,
            [2, -1, -8, -4][i]
          ] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [1 + i * 0.3, 0.5 + i * 0.2, 1 + i * 0.3] as [number, number, number],
        },
        material: {
          baseColor: [0.5, 0.5, 0.5, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.95,
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
            colliderShape: 'ball',
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
      })),
      // Bushes 1-3
      ...Array.from({ length: 3 }, (_, i) => ({
        entityId: `bush_${String(i + 1).padStart(2, '0')}`,
        entityName: `Bush_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Sphere',
        parentId: null,
        visible: true,
        transform: {
          translation: [
            [3, -5, 7][i],
            0.6,
            [-2, -6, -3][i]
          ] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [1, 0.6, 1] as [number, number, number],
        },
        material: {
          baseColor: [0.2, 0.5, 0.2, 1.0],
          metallic: 0.0,
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
            colliderShape: 'ball',
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
      })),
      // Game Manager
      {
        entityId: 'game_manager',
        entityName: 'GameManager',
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
      },
      // Sun
      {
        entityId: 'sun',
        entityName: 'Sun',
        entityType: 'DirectionalLight',
        parentId: null,
        visible: true,
        transform: {
          translation: [10, 25, 10],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        light: {
          lightType: 'directional',
          color: [1.0, 0.9, 0.7],
          intensity: 4500,
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
          translation: [-5, 8, -5],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        light: {
          lightType: 'point',
          color: [0.6, 0.7, 1.0],
          intensity: 1000,
          shadowsEnabled: false,
          shadowDepthBias: 0.02,
          shadowNormalBias: 1.8,
          range: 25,
          radius: 0,
          innerAngle: 0,
          outerAngle: 0,
        },
      },
    ],
  },

  scripts: {
    player: {
      source: `// Explorer Controller -- gentle walking, no combat
const SPEED = 3;

function onUpdate(dt) {
  let dx = 0, dz = 0;
  if (forge.input.isPressed("move_forward")) dz -= SPEED * dt;
  if (forge.input.isPressed("move_backward")) dz += SPEED * dt;
  if (forge.input.isPressed("move_left")) dx -= SPEED * dt;
  if (forge.input.isPressed("move_right")) dx += SPEED * dt;
  forge.translate(entityId, dx, 0, dz);
}`,
      enabled: true,
    },
    game_manager: {
      source: `// Explorer Manager -- tracks orbs, shows journal
let totalOrbs = 5;

function onStart() {
  forge.ui.showText("journal", "Orbs: 0 / " + totalOrbs, 5, 5, {
    fontSize: 16, color: "#b8a9d4"
  });
  forge.ui.showText("hint", "Find the glowing orbs hidden in the world...", 25, 92, {
    fontSize: 13, color: "#777777"
  });

  // Listen for orb collection
  const players = forge.scene.findByName("Player");
  if (players.length > 0) {
    forge.physics.onCollisionEnter(players[0], (otherId) => {
      const name = forge.scene.getEntityName(otherId) || "";
      if (name.startsWith("Orb_")) {
        const count = (forge.state.get("orbsCollected") || 0) + 1;
        forge.state.set("orbsCollected", count);

        forge.setVisibility(otherId, false);

        forge.ui.updateText("journal", "Orbs: " + count + " / " + totalOrbs);

        if (count >= totalOrbs) {
          forge.ui.showText("complete", "All memories gathered. The world remembers.", 15, 45, {
            fontSize: 22, color: "#d4a0ff"
          });
          forge.ui.removeText("hint");
        }
      }
    });
  }
}

function onUpdate(_dt) {}`,
      enabled: true,
    },
  },
};
