/**
 * 2D Metroidvania Game Template
 *
 * Exploration platformer with ability gates, save points, and backtracking.
 */

import type { GameTemplate } from './index';

export const METROIDVANIA_2D_TEMPLATE: GameTemplate = {
  id: '2d-metroidvania',
  name: '2D Metroidvania',
  description: 'Exploration platformer. Unlock abilities, save progress, discover secrets.',
  category: '2d_metroidvania',
  difficulty: 'intermediate',
  thumbnail: {
    gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)',
    icon: 'Layers',
    accentColor: '#06b6d4',
  },
  tags: ['2d', 'metroidvania', 'exploration', 'abilities'],

  inputPreset: 'platformer',

  sceneData: {
    formatVersion: 3,
    metadata: {
      name: '2D Metroidvania',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    environment: {
      skyboxBrightness: 0.4,
      iblIntensity: 0.2,
      iblRotationDegrees: 0,
      clearColor: [0.1, 0.1, 0.15],
      fogEnabled: false,
      fogColor: [0.5, 0.5, 0.5],
      fogStart: 10,
      fogEnd: 50,
      skyboxPreset: null,
      skyboxAssetId: null,
    },
    ambientLight: {
      color: [1, 1, 1],
      brightness: 650,
    },
    inputBindings: {},
    postProcessing: {
      bloomEnabled: true,
      bloomIntensity: 0.08,
      bloomThreshold: 0.85,
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
          scale: [1, 1.2, 1],
        },
        material: {
          baseColor: [0.9, 0.7, 0.3, 1.0],
          metallic: 0.4,
          perceptualRoughness: 0.6,
          reflectance: 0.6,
          emissive: [0.1, 0.05, 0.0, 1.0],
          emissiveExposureWeight: 1,
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
            characterController: { speed: 4.5, jumpHeight: 2.0, gravityScale: 1.0, canDoubleJump: false },
          },
          {
            type: 'health',
            health: { maxHp: 5, currentHp: 5, respawnOnDeath: true },
          },
        ],
      },
      // Ground and platforms
      ...Array.from({ length: 20 }, (_, i) => ({
        entityId: `ground_${String(i + 1).padStart(2, '0')}`,
        entityName: `Ground_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [i * 2 - 19, -1, 0] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [2, 1, 1] as [number, number, number],
        },
        material: {
          baseColor: [0.3, 0.3, 0.35, 1.0],
          metallic: 0.2,
          perceptualRoughness: 0.8,
          reflectance: 0.4,
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
      // Platform ledges
      {
        entityId: 'platform_1',
        entityName: 'Platform_1',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [5, 3, 0],
          rotation: [0, 0, 0, 1],
          scale: [3, 0.5, 1],
        },
        material: {
          baseColor: [0.4, 0.4, 0.45, 1.0],
          metallic: 0.2,
          perceptualRoughness: 0.8,
          reflectance: 0.4,
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
          translation: [10, 5, 0],
          rotation: [0, 0, 0, 1],
          scale: [2.5, 0.5, 1],
        },
        material: {
          baseColor: [0.4, 0.4, 0.45, 1.0],
          metallic: 0.2,
          perceptualRoughness: 0.8,
          reflectance: 0.4,
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
          translation: [-6, 4, 0],
          rotation: [0, 0, 0, 1],
          scale: [2, 0.5, 1],
        },
        material: {
          baseColor: [0.4, 0.4, 0.45, 1.0],
          metallic: 0.2,
          perceptualRoughness: 0.8,
          reflectance: 0.4,
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
      // Ability gate (double jump unlock)
      {
        entityId: 'ability_gate',
        entityName: 'AbilityGate',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [8, 2, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.8, 2.5, 1],
        },
        material: {
          baseColor: [1.0, 0.3, 0.7, 0.7],
          metallic: 0.7,
          perceptualRoughness: 0.3,
          reflectance: 0.8,
          emissive: [0.5, 0.1, 0.3, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'blend',
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
      // Ability pickup
      {
        entityId: 'ability_pickup',
        entityName: 'AbilityPickup',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [15, 6, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.7, 0.7, 1],
        },
        material: {
          baseColor: [1.0, 0.5, 0.0, 1.0],
          metallic: 0.8,
          perceptualRoughness: 0.2,
          reflectance: 0.9,
          emissive: [0.6, 0.3, 0.0, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        gameComponents: [
          {
            type: 'collectible',
            collectible: { value: 1, rotateSpeed: 80 },
          },
        ],
      },
      // Save points
      {
        entityId: 'save_point_1',
        entityName: 'SavePoint_1',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 1, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.5, 1.5, 1],
        },
        material: {
          baseColor: [0.0, 1.0, 0.8, 0.8],
          metallic: 0.5,
          perceptualRoughness: 0.4,
          reflectance: 0.7,
          emissive: [0.0, 0.5, 0.4, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'blend',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        gameComponents: [
          {
            type: 'checkpoint',
            checkpoint: { autoSave: true },
          },
        ],
      },
      {
        entityId: 'save_point_2',
        entityName: 'SavePoint_2',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [12, 6, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.5, 1.5, 1],
        },
        material: {
          baseColor: [0.0, 1.0, 0.8, 0.8],
          metallic: 0.5,
          perceptualRoughness: 0.4,
          reflectance: 0.7,
          emissive: [0.0, 0.5, 0.4, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'blend',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        gameComponents: [
          {
            type: 'checkpoint',
            checkpoint: { autoSave: true },
          },
        ],
      },
      // Enemies
      {
        entityId: 'enemy_1',
        entityName: 'Enemy_1',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [7, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.8, 0.8, 1],
        },
        material: {
          baseColor: [0.8, 0.1, 0.1, 1.0],
          metallic: 0.3,
          perceptualRoughness: 0.7,
          reflectance: 0.5,
          emissive: [0.2, 0.0, 0.0, 1.0],
          emissiveExposureWeight: 1,
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
          baseColor: [0.8, 0.1, 0.1, 1.0],
          metallic: 0.3,
          perceptualRoughness: 0.7,
          reflectance: 0.5,
          emissive: [0.2, 0.0, 0.0, 1.0],
          emissiveExposureWeight: 1,
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
      source: `// Metroidvania Player Controller
const SPEED = 4.5;
const JUMP_FORCE = 12;
let grounded = false;
let canDoubleJump = false;
let hasDoubleJump = false;

forge.physics2d.onCollisionEnter((other) => {
  const otherPos = forge.transform.getPosition(other);
  const myPos = forge.transform.getPosition();
  if (otherPos && myPos && otherPos.y < myPos.y - 0.3) {
    grounded = true;
  }
});

forge.physics2d.onCollisionExit(() => {
  grounded = false;
});

forge.onUpdate((dt) => {
  let vx = 0;
  if (forge.input.isKeyDown('ArrowLeft') || forge.input.isKeyDown('a')) vx = -SPEED;
  if (forge.input.isKeyDown('ArrowRight') || forge.input.isKeyDown('d')) vx = SPEED;

  forge.physics2d.setVelocityX(vx);

  if (forge.input.isKeyPressed('Space') || forge.input.isKeyPressed('w')) {
    if (grounded) {
      forge.physics2d.applyImpulse(0, JUMP_FORCE);
      grounded = false;
      if (hasDoubleJump) canDoubleJump = true;
    } else if (canDoubleJump) {
      forge.physics2d.applyImpulse(0, JUMP_FORCE * 0.9);
      canDoubleJump = false;
    }
  }

  if (forge.state.get('hasDoubleJump')) {
    hasDoubleJump = true;
  }

  const pos = forge.transform.getPosition();
  if (pos && pos.y < -5) {
    const savePos = forge.state.get('savePosition') || { x: 0, y: 1 };
    forge.transform.setPosition(savePos.x, savePos.y, 0);
    forge.physics2d.setVelocity(0, 0);
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
    ability_gate: {
      source: `// Ability Gate Check
forge.onUpdate(() => {
  if (forge.state.get('hasDoubleJump')) {
    forge.setVisibility(entityId, false);
    const phys = forge.scene.getComponent(entityId, 'physics');
    if (phys) {
      forge.physics.setEnabled(entityId, false);
    }
  }
});`,
      enabled: true,
    },
    enemy_1: {
      source: `// Enemy Patrol
const SPEED = 1.5;
const START_X = 7;
const RANGE = 3;
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
const SPEED = 1.3;
const START_X = -8;
const RANGE = 4;
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
      source: `// Metroidvania Game Manager
let mapProgress = 0;

forge.onStart(() => {
  forge.ui.showText('map', 'Map: 0%', 5, 5, { fontSize: 18, color: '#00ffcc' });
  forge.ui.showText('abilities', 'Abilities: None', 5, 10, { fontSize: 16, color: '#ffaa00' });
  forge.ui.showText('hint', 'Explore to unlock double jump!', 5, 92, {
    fontSize: 14, color: '#aaa'
  });

  const players = forge.scene.findByName('Player');
  if (players.length === 0) return;

  forge.physics2d.onCollisionEnter(players[0], (other) => {
    const name = forge.scene.getEntityName(other);
    if (name === 'AbilityPickup') {
      forge.state.set('hasDoubleJump', true);
      forge.setVisibility(other, false);
      forge.ui.updateText('abilities', 'Abilities: Double Jump');
      forge.ui.showText('unlock', 'Double Jump Unlocked!', 30, 50, {
        fontSize: 24, color: '#ff9900'
      });
      setTimeout(() => forge.ui.removeText('unlock'), 2000);
    }
    if (name && name.startsWith('SavePoint_')) {
      const pos = forge.transform.getPosition(players[0]);
      if (pos) {
        forge.state.set('savePosition', { x: pos.x, y: pos.y });
        forge.ui.showText('saved', 'Progress Saved', 40, 50, {
          fontSize: 18, color: '#00ffcc'
        });
        setTimeout(() => forge.ui.removeText('saved'), 1500);
        mapProgress = Math.min(100, mapProgress + 25);
        forge.ui.updateText('map', 'Map: ' + mapProgress + '%');
      }
    }
  });
});

forge.onUpdate(() => {
  if (forge.state.get('playerHit')) {
    forge.state.set('playerHit', false);
    const savePos = forge.state.get('savePosition') || { x: 0, y: 1 };
    const players = forge.scene.findByName('Player');
    if (players.length > 0) {
      forge.transform.setPosition(players[0], savePos.x, savePos.y, 0);
      forge.physics2d.setVelocity(players[0], 0, 0);
    }
  }
});`,
      enabled: true,
    },
  },
};
