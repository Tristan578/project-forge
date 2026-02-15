/**
 * 2D Platformer Game Template
 *
 * Mario-style side-scrolling platformer with sprite-based player, enemies, coins, and platforms.
 */

import type { GameTemplate } from './index';

export const PLATFORMER_2D_TEMPLATE: GameTemplate = {
  id: '2d-platformer',
  name: '2D Platformer',
  description: 'Side-scrolling platformer with jumps, enemies, and collectibles.',
  category: '2d_platformer',
  difficulty: 'beginner',
  thumbnail: {
    gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
    icon: 'Gamepad2',
    accentColor: '#3b82f6',
  },
  tags: ['2d', 'platformer', 'side-scroller', 'retro'],

  inputPreset: 'platformer',

  sceneData: {
    formatVersion: 3,
    metadata: {
      name: '2D Platformer',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    environment: {
      skyboxBrightness: 0.5,
      iblIntensity: 0.3,
      iblRotationDegrees: 0,
      clearColor: [0.4, 0.6, 0.9],
      fogEnabled: false,
      fogColor: [0.5, 0.5, 0.5],
      fogStart: 10,
      fogEnd: 50,
      skyboxPreset: null,
      skyboxAssetId: null,
    },
    ambientLight: {
      color: [1, 1, 1],
      brightness: 800,
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
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 1, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        material: {
          baseColor: [0.2, 0.6, 1.0, 1.0],
          metallic: 0,
          perceptualRoughness: 1,
          reflectance: 0,
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
            mass: 1.0,
            friction: 0.5,
            restitution: 0.0,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'characterController',
            characterController: { speed: 5.0, jumpHeight: 2.0, gravityScale: 1.0, canDoubleJump: false },
          },
          {
            type: 'health',
            health: { maxHp: 3, currentHp: 3, respawnOnDeath: true },
          },
        ],
      },
      // Ground tiles
      ...Array.from({ length: 15 }, (_, i) => ({
        entityId: `ground_${String(i + 1).padStart(2, '0')}`,
        entityName: `Ground_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [i * 2 - 14, -1, 0] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [2, 1, 1] as [number, number, number],
        },
        material: {
          baseColor: [0.5, 0.3, 0.2, 1.0],
          metallic: 0,
          perceptualRoughness: 1,
          reflectance: 0,
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
            mass: 1.0,
            friction: 0.8,
            restitution: 0.0,
          },
          enabled: true,
        },
      })),
      // Floating platforms
      {
        entityId: 'platform_1',
        entityName: 'Platform_1',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [4, 2, 0],
          rotation: [0, 0, 0, 1],
          scale: [3, 0.5, 1],
        },
        material: {
          baseColor: [0.6, 0.6, 0.6, 1.0],
          metallic: 0,
          perceptualRoughness: 1,
          reflectance: 0,
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
            mass: 1.0,
            friction: 0.8,
            restitution: 0.0,
          },
          enabled: true,
        },
      },
      {
        entityId: 'platform_2',
        entityName: 'Platform_2',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [8, 4, 0],
          rotation: [0, 0, 0, 1],
          scale: [2.5, 0.5, 1],
        },
        material: {
          baseColor: [0.6, 0.6, 0.6, 1.0],
          metallic: 0,
          perceptualRoughness: 1,
          reflectance: 0,
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
            mass: 1.0,
            friction: 0.8,
            restitution: 0.0,
          },
          enabled: true,
        },
      },
      {
        entityId: 'platform_3',
        entityName: 'Platform_3',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [-6, 3, 0],
          rotation: [0, 0, 0, 1],
          scale: [2, 0.5, 1],
        },
        material: {
          baseColor: [0.6, 0.6, 0.6, 1.0],
          metallic: 0,
          perceptualRoughness: 1,
          reflectance: 0,
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
            mass: 1.0,
            friction: 0.8,
            restitution: 0.0,
          },
          enabled: true,
        },
      },
      // Coins
      ...Array.from({ length: 6 }, (_, i) => ({
        entityId: `coin_${String(i + 1).padStart(2, '0')}`,
        entityName: `Coin_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [[2, 3, 0], [5, 4, 0], [8, 5, 0], [-4, 4, 0], [-8, 2, 0], [12, 3, 0]][i] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.6, 0.6, 1] as [number, number, number],
        },
        material: {
          baseColor: [1.0, 0.84, 0.0, 1.0],
          metallic: 0.8,
          perceptualRoughness: 0.2,
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
            mass: 0.1,
            friction: 0.0,
            restitution: 0.0,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'collectible',
            collectible: { value: 1, rotateSpeed: 90 },
          },
        ],
      })),
      // Enemies
      {
        entityId: 'enemy_1',
        entityName: 'Enemy_1',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [6, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.8, 0.8, 1],
        },
        material: {
          baseColor: [1.0, 0.2, 0.2, 1.0],
          metallic: 0,
          perceptualRoughness: 1,
          reflectance: 0,
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
            mass: 1.0,
            friction: 0.5,
            restitution: 0.0,
          },
          enabled: true,
        },
      },
      {
        entityId: 'enemy_2',
        entityName: 'Enemy_2',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [-8, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.8, 0.8, 1],
        },
        material: {
          baseColor: [1.0, 0.2, 0.2, 1.0],
          metallic: 0,
          perceptualRoughness: 1,
          reflectance: 0,
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
            mass: 1.0,
            friction: 0.5,
            restitution: 0.0,
          },
          enabled: true,
        },
      },
      // Goal
      {
        entityId: 'goal',
        entityName: 'Goal',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [16, 1, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 2, 1],
        },
        material: {
          baseColor: [0.0, 1.0, 0.0, 1.0],
          metallic: 0,
          perceptualRoughness: 1,
          reflectance: 0,
          emissive: [0.0, 0.5, 0.0, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            mass: 1.0,
            friction: 0.0,
            restitution: 0.0,
          },
          enabled: true,
        },
      },
      // Camera
      {
        entityId: 'camera',
        entityName: 'Camera',
        entityType: 'Camera2d',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 2, 10],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      },
      // Game Manager
      {
        entityId: 'game_manager',
        entityName: 'GameManager',
        entityType: 'Sprite',
        parentId: null,
        visible: false,
        transform: {
          translation: [0, -20, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.1, 0.1, 1],
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
    ],
  },

  scripts: {
    player: {
      source: `// 2D Platformer Controller
const SPEED = 5;
const JUMP_FORCE = 12;
let grounded = false;
let groundCheckTimer = 0;

forge.physics2d.onCollisionEnter((other) => {
  const otherPos = forge.transform.getPosition(other);
  const myPos = forge.transform.getPosition();
  if (otherPos && myPos && otherPos.y < myPos.y - 0.3) {
    grounded = true;
  }
});

forge.physics2d.onCollisionExit(() => {
  groundCheckTimer = 0.1;
});

forge.onUpdate((dt) => {
  if (groundCheckTimer > 0) {
    groundCheckTimer -= dt;
    if (groundCheckTimer <= 0) grounded = false;
  }

  let vx = 0;
  if (forge.input.isKeyDown('ArrowLeft') || forge.input.isKeyDown('a')) vx = -SPEED;
  if (forge.input.isKeyDown('ArrowRight') || forge.input.isKeyDown('d')) vx = SPEED;

  forge.physics2d.setVelocityX(vx);

  if (grounded && (forge.input.isKeyPressed('Space') || forge.input.isKeyPressed('w'))) {
    forge.physics2d.applyImpulse(0, JUMP_FORCE);
    grounded = false;
  }

  // Fall reset
  const pos = forge.transform.getPosition();
  if (pos && pos.y < -5) {
    forge.transform.setPosition(0, 1, 0);
    forge.physics2d.setVelocity(0, 0);
    grounded = false;
  }
});`,
      enabled: true,
    },
    camera: {
      source: `// 2D Camera Follow
const SMOOTH = 0.1;

forge.onUpdate((dt) => {
  const players = forge.scene.findByName('Player');
  if (players.length === 0) return;

  const playerPos = forge.transform.getPosition(players[0]);
  const camPos = forge.transform.getPosition();
  if (!playerPos || !camPos) return;

  const targetX = playerPos.x;
  const targetY = Math.max(2, playerPos.y + 1);

  const newX = camPos.x + (targetX - camPos.x) * SMOOTH;
  const newY = camPos.y + (targetY - camPos.y) * SMOOTH;

  forge.transform.setPosition(newX, newY, 10);
});`,
      enabled: true,
    },
    enemy_1: {
      source: `// Enemy Patrol
const SPEED = 1.5;
const START_X = 6;
const RANGE = 4;
let dir = -1;

forge.onUpdate((dt) => {
  const pos = forge.transform.getPosition();
  if (!pos) return;

  const newX = pos.x + SPEED * dir * dt;
  if (newX < START_X - RANGE) dir = 1;
  if (newX > START_X + RANGE) dir = -1;

  forge.transform.setPosition(newX, pos.y, pos.z);
});

forge.physics2d.onCollisionEnter((other) => {
  const name = forge.scene.getEntityName(other);
  if (name === 'Player') {
    forge.state.set('playerHit', true);
  }
});`,
      enabled: true,
    },
    enemy_2: {
      source: `// Enemy Patrol
const SPEED = 1.2;
const START_X = -8;
const RANGE = 3;
let dir = 1;

forge.onUpdate((dt) => {
  const pos = forge.transform.getPosition();
  if (!pos) return;

  const newX = pos.x + SPEED * dir * dt;
  if (newX < START_X - RANGE) dir = 1;
  if (newX > START_X + RANGE) dir = -1;

  forge.transform.setPosition(newX, pos.y, pos.z);
});

forge.physics2d.onCollisionEnter((other) => {
  const name = forge.scene.getEntityName(other);
  if (name === 'Player') {
    forge.state.set('playerHit', true);
  }
});`,
      enabled: true,
    },
    game_manager: {
      source: `// Game Manager
let score = 0;
let totalCoins = 6;
let won = false;

forge.onStart(() => {
  forge.ui.showText('score', 'Coins: 0 / ' + totalCoins, 5, 5, {
    fontSize: 20, color: '#ffd700'
  });
  forge.ui.showText('hint', 'Collect coins and reach the goal!', 5, 90, {
    fontSize: 14, color: '#aaa'
  });

  const players = forge.scene.findByName('Player');
  if (players.length === 0) return;

  forge.physics2d.onCollisionEnter(players[0], (other) => {
    const name = forge.scene.getEntityName(other);
    if (name && name.startsWith('Coin_')) {
      score++;
      forge.setVisibility(other, false);
      forge.ui.updateText('score', 'Coins: ' + score + ' / ' + totalCoins);
    }
    if (name === 'Goal' && !won) {
      won = true;
      forge.ui.showText('win', 'YOU WIN!', 35, 45, {
        fontSize: 36, color: '#00ff00'
      });
    }
  });
});

forge.onUpdate(() => {
  if (forge.state.get('playerHit')) {
    forge.state.set('playerHit', false);
    forge.ui.showText('hit', 'Hit! Restarting...', 30, 50, {
      fontSize: 24, color: '#ff0000'
    });
    setTimeout(() => {
      forge.scene.restart();
    }, 1500);
  }
});`,
      enabled: true,
    },
  },
};
