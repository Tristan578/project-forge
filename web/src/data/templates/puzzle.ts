/**
 * Block Puzzle Game Template
 *
 * Push blocks onto pressure plates to open a door and escape.
 */

import type { GameTemplate } from './index';

export const PUZZLE_TEMPLATE: GameTemplate = {
  id: 'puzzle',
  name: 'Block Puzzle',
  description: 'Push blocks onto pressure plates to open doors and escape.',
  category: 'puzzle',
  difficulty: 'intermediate',
  thumbnail: {
    gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    icon: 'Puzzle',
    accentColor: '#8b5cf6',
  },
  tags: ['3d', 'puzzle', 'logic', 'physics'],

  inputPreset: 'topdown',

  sceneData: {
    formatVersion: 3,
    metadata: {
      name: 'Block Puzzle',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    environment: {
      skyboxBrightness: 1.0,
      iblIntensity: 1.0,
      iblRotationDegrees: 0,
      clearColor: [0.8, 0.8, 0.9],
      fogEnabled: false,
      fogColor: [0.5, 0.5, 0.5],
      fogStart: 10,
      fogEnd: 50,
      skyboxPreset: 'studio',
      skyboxAssetId: null,
    },
    ambientLight: {
      color: [1, 1, 1],
      brightness: 500,
    },
    inputBindings: {},
    postProcessing: {
      bloomEnabled: false,
      bloomIntensity: 0.0,
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
          translation: [0, 1, 5],
          rotation: [0, 0, 0, 1],
          scale: [0.5, 0.8, 0.5],
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
            speed: 4,
            jumpHeight: 0,
            canDoubleJump: false,
            gravityScale: 1.0,
          },
        ],
      },
      // Floor
      {
        entityId: 'floor',
        entityName: 'Floor',
        entityType: 'Plane',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [12, 1, 12],
        },
        material: {
          baseColor: [0.9, 0.85, 0.7, 1.0],
          metallic: 0.0,
          perceptualRoughness: 0.85,
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
      // Blocks 1-3
      ...([[2, 0.5, 0], [-2, 0.5, -3], [0, 0.5, -5]] as [number, number, number][]).map((pos, i) => ({
        entityId: `block_${String(i + 1).padStart(2, '0')}`,
        entityName: `Block_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: pos,
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.9, 0.9, 0.9] as [number, number, number],
        },
        material: {
          baseColor: [0.6, 0.4, 0.2, 1.0],
          metallic: 0.0,
          perceptualRoughness: 0.6,
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
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: true,
            lockTranslationZ: false,
            lockRotationX: true,
            lockRotationY: true,
            lockRotationZ: true,
            isSensor: false,
          },
          enabled: true,
        },
      })),
      // Pressure Plates 1-3
      ...([[4, 0.05, 0], [-4, 0.05, -3], [0, 0.05, -7]] as [number, number, number][]).map((pos, i) => ({
        entityId: `plate_${String(i + 1).padStart(2, '0')}`,
        entityName: `Plate_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: pos,
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [1.1, 0.1, 1.1] as [number, number, number],
        },
        material: {
          baseColor: [0.2, 0.8, 0.2, 0.8],
          metallic: 0.3,
          perceptualRoughness: 0.5,
          reflectance: 0.5,
          emissive: [0.0, 0.2, 0.0, 1.0],
          emissiveExposureWeight: 0.5,
          alphaMode: 'blend',
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
            type: 'triggerZone',
            eventName: 'plate_activated',
          },
        ],
      })),
      // Door
      {
        entityId: 'door',
        entityName: 'Door',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 1.5, -10] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [3, 3, 0.3] as [number, number, number],
        },
        material: {
          baseColor: [0.8, 0.2, 0.2, 1.0],
          metallic: 0.6,
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
      // Exit Zone
      {
        entityId: 'exit_zone',
        entityName: 'ExitZone',
        entityType: 'Cube',
        parentId: null,
        visible: false,
        transform: {
          translation: [0, 0.5, -12] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [2, 1, 2] as [number, number, number],
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
      // Walls (perimeter - simplified)
      ...([[0, 1, -6, 14, 2, 0.3], [0, 1, 6, 14, 2, 0.3], [-6, 1, 0, 0.3, 2, 12], [6, 1, 0, 0.3, 2, 12]] as number[][]).map((params, i) => ({
        entityId: `wall_${i + 1}`,
        entityName: `Wall_${i + 1}`,
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [params[0], params[1], params[2]] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [params[3], params[4], params[5]] as [number, number, number],
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
          translation: [5, 15, 5],
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
    ],
  },

  scripts: {
    player: {
      source: `// Top-Down Puzzle Controller
// WASD movement, no jump. Push blocks by walking into them.
const SPEED = 4;

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
    door: {
      source: `// Door Controller -- opens when all 3 plates are activated
let isOpen = false;

function onUpdate(dt) {
  const p1 = forge.state.get("plate_Plate_01");
  const p2 = forge.state.get("plate_Plate_02");
  const p3 = forge.state.get("plate_Plate_03");
  const allActive = p1 && p2 && p3;

  if (allActive && !isOpen) {
    isOpen = true;
    // Slide door up
    forge.setPosition(entityId, 0, 4.5, -10);
    forge.setColor(entityId, 0.2, 0.8, 0.2);
  } else if (!allActive && isOpen) {
    isOpen = false;
    forge.setPosition(entityId, 0, 1.5, -10);
    forge.setColor(entityId, 0.8, 0.2, 0.2);
  }
}`,
      enabled: true,
    },
    exit_zone: {
      source: `// Exit Zone -- win when player reaches here (door must be open)
let hasWon = false;

function onStart() {
  const players = forge.scene.findByName("Player");
  if (players.length > 0) {
    forge.physics.onCollisionEnter(entityId, (otherId) => {
      if (otherId === players[0] && !hasWon) {
        hasWon = true;
        forge.ui.showText("win", "PUZZLE SOLVED!", 30, 40, {
          fontSize: 42, color: "#8b5cf6"
        });
        forge.ui.showText("winSub", "You opened the door and escaped!", 25, 55, {
          fontSize: 18, color: "#ffffff"
        });
      }
    });
  }
}

function onUpdate(_dt) {}`,
      enabled: true,
    },
    game_manager: {
      source: `// Puzzle Manager -- hints
function onStart() {
  forge.ui.showText("hint", "Push blocks onto the green plates to open the door", 15, 92, {
    fontSize: 14, color: "#aaaaaa"
  });
}

function onUpdate(_dt) {}`,
      enabled: true,
    },
  },
};
