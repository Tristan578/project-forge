/**
 * Endless Runner Game Template
 *
 * Auto-running game where player dodges obstacles in three lanes.
 */

import type { GameTemplate } from './index';

export const RUNNER_TEMPLATE: GameTemplate = {
  id: 'runner',
  name: 'Endless Runner',
  description: 'Auto-run forward, dodge obstacles, chase a high score.',
  category: 'runner',
  difficulty: 'beginner',
  thumbnail: {
    gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    icon: 'Zap',
    accentColor: '#f59e0b',
  },
  tags: ['3d', 'runner', 'procedural', 'score'],

  inputPreset: 'platformer',

  sceneData: {
    formatVersion: 3,
    metadata: {
      name: 'Endless Runner',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    environment: {
      skyboxBrightness: 1.0,
      iblIntensity: 1.0,
      iblRotationDegrees: 0,
      clearColor: [0.5, 0.5, 0.6],
      fogEnabled: true,
      fogColor: [0.5, 0.5, 0.6],
      fogStart: 40,
      fogEnd: 100,
      skyboxPreset: 'overcast',
      skyboxAssetId: null,
    },
    ambientLight: {
      color: [1, 1, 1],
      brightness: 300,
    },
    inputBindings: {},
    postProcessing: {
      bloomEnabled: true,
      bloomIntensity: 0.15,
      bloomThreshold: 1.0,
      chromaticAberrationEnabled: true,
      chromaticAberrationIntensity: 0.02,
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
          translation: [0, 1, 0],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.6, 0.8, 0.6],
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
            gravityScale: 1.5,
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
            speed: 0,
            jumpHeight: 8,
            canDoubleJump: false,
            gravityScale: 1.5,
          },
        ],
      },
      // Track
      {
        entityId: 'track',
        entityName: 'Track',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, -0.5, -50],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [6, 1, 120],
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
      // Wall L
      {
        entityId: 'wall_l',
        entityName: 'WallL',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [-3.5, 1, -50],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.3, 3, 120],
        },
        material: {
          baseColor: [0.4, 0.4, 0.4, 1.0],
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
      },
      // Wall R
      {
        entityId: 'wall_r',
        entityName: 'WallR',
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [3.5, 1, -50],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.3, 3, 120],
        },
        material: {
          baseColor: [0.4, 0.4, 0.4, 1.0],
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
      },
      // Obstacles 1-8 (spread across track)
      ...Array.from({ length: 8 }, (_, i) => ({ 
        entityId: `obstacle_${String(i + 1).padStart(2, '0')}`,
        entityName: `Obstacle_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [
            [-2, 0, 2][i % 3],
            0.5,
            -20 - i * 10
          ] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: (i % 2 === 0 ? [1, 1, 1] : [0.5, 2, 6]) as [number, number, number],
        },
        material: {
          baseColor: [1.0, 0.1, 0.1, 1.0],
          metallic: 0.3,
          perceptualRoughness: 0.5,
          reflectance: 0.5,
          emissive: [0.5, 0, 0, 1.0],
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
      })),
      // Coins 1-6
      ...Array.from({ length: 6 }, (_, i) => ({ 
        entityId: `coin_${String(i + 1).padStart(2, '0')}`,
        entityName: `Coin_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Sphere',
        parentId: null,
        visible: true,
        transform: {
          translation: [
            [-2, 0, 2][i % 3],
            1.5,
            -25 - i * 12
          ] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.3, 0.3, 0.3] as [number, number, number],
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
            value: 10,
            rotateSpeed: 120,
          },
        ],
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
          rotation: [0, 0, 0, 1] as [number, number, number, number],
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
          translation: [0, 20, -20],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [1, 1, 1] as [number, number, number],
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
          translation: [0, 10, 0],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        },
        light: {
          lightType: 'point',
          color: [0.7, 0.8, 1.0],
          intensity: 1500,
          shadowsEnabled: false,
          shadowDepthBias: 0.02,
          shadowNormalBias: 1.8,
          range: 40,
          radius: 0,
          innerAngle: 0,
          outerAngle: 0,
        },
      },
      // Decoration cubes 1-4
      ...Array.from({ length: 4 }, (_, i) => ({
        entityId: `deco_${String(i + 1).padStart(2, '0')}`,
        entityName: `Deco_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [
            [-5, -4.5, -6, 5][i],
            0.5,
            -15 - i * 20
          ] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [1 + i * 0.3, 1 + i * 0.2, 1 + i * 0.3] as [number, number, number],
        },
        material: {
          baseColor: [
            [0.8, 0.2, 0.2, 1.0],
            [0.2, 0.8, 0.2, 1.0],
            [0.2, 0.2, 0.8, 1.0],
            [0.8, 0.8, 0.2, 1.0],
          ][i],
          metallic: 0.5,
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
    ],
  },

  scripts: {
    player: {
      source: `// Endless Runner Controller
// Player auto-moves forward. Left/Right to dodge. Space to jump.
const FORWARD_SPEED = 8;
const LANE_SPEED = 10;
const LANES = [-2, 0, 2]; // X positions for 3 lanes
let currentLane = 1; // Start in middle
let targetX = 0;

function onUpdate(dt) {
  // Auto-forward movement
  forge.translate(entityId, 0, 0, -FORWARD_SPEED * dt);

  // Lane switching
  if (forge.input.justPressed("move_left") && currentLane > 0) {
    currentLane--;
    targetX = LANES[currentLane];
  }
  if (forge.input.justPressed("move_right") && currentLane < 2) {
    currentLane++;
    targetX = LANES[currentLane];
  }

  // Smooth lane transition
  const pos = forge.getTransform(entityId)?.position;
  if (pos) {
    const dx = targetX - pos[0];
    if (Math.abs(dx) > 0.05) {
      forge.translate(entityId, dx * LANE_SPEED * dt, 0, 0);
    }
  }

  // Jump
  if (forge.input.justPressed("jump")) {
    forge.physics.applyImpulse(entityId, 0, 8, 0);
  }

  // Fall reset
  if (pos && pos[1] < -5) {
    forge.state.set("gameOver", true);
  }
}`,
      enabled: true,
    },
    game_manager: {
      source: `// Runner Game Manager -- distance tracking, score, game over
let distance = 0;
let score = 0;
let gameOver = false;

function onStart() {
  forge.ui.showText("distance", "Distance: 0m", 5, 5, {
    fontSize: 20, color: "#ffffff"
  });
  forge.ui.showText("score", "Score: 0", 75, 5, {
    fontSize: 20, color: "#ffdd00"
  });
}

function onUpdate(dt) {
  if (gameOver) return;

  // Check game over state (set by player controller or damage)
  if (forge.state.get("gameOver")) {
    gameOver = true;
    forge.ui.showText("gameover", "GAME OVER", 30, 40, {
      fontSize: 48, color: "#ff4444"
    });
    forge.ui.showText("finalScore", "Final Score: " + score, 32, 55, {
      fontSize: 24, color: "#ffffff"
    });
    return;
  }

  // Track distance from player position
  const players = forge.scene.findByName("Player");
  if (players.length > 0) {
    const pos = forge.getTransform(players[0])?.position;
    if (pos) {
      distance = Math.abs(Math.floor(pos[2]));
      forge.ui.updateText("distance", "Distance: " + distance + "m");

      // Distance-based score
      score = distance * 2;

      // Check for collected coins
      const coinScore = forge.state.get("coinScore") || 0;
      score += coinScore;
      forge.ui.updateText("score", "Score: " + score);
    }
  }
}`,
      enabled: true,
    },
  },
};
