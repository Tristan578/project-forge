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

forge.physics2d.onCollisionEnter((event) => {
  const otherState = forge.getTransform(event.otherEntityId);
  const myState = forge.getTransform(entityId);
  // position is [x, y, z]. Anything centred below us is something we landed on.
  if (otherState && myState && otherState.position[1] < myState.position[1] - 0.3) {
    grounded = true;
  }
});

forge.physics2d.onCollisionExit(() => {
  grounded = false;
});

function onUpdate(dt) {
  let vx = 0;
  if (forge.input.isPressed('move_left')) vx = -SPEED;
  if (forge.input.isPressed('move_right')) vx = SPEED;

  // setVelocityX, not setVelocity: writing the vertical component every frame
  // would cancel gravity and erase the jump impulse from the frame before.
  forge.physics2d.setVelocityX(entityId, vx);

  if (forge.input.justPressed('jump')) {
    if (grounded) {
      forge.physics2d.applyImpulse(entityId, 0, JUMP_FORCE);
      grounded = false;
      if (hasDoubleJump) canDoubleJump = true;
    } else if (canDoubleJump) {
      forge.physics2d.applyImpulse(entityId, 0, JUMP_FORCE * 0.9);
      canDoubleJump = false;
    }
  }

  if (forge.state.get('hasDoubleJump')) {
    hasDoubleJump = true;
  }

  const state = forge.getTransform(entityId);
  if (state && state.position[1] < -5) {
    const savePos = forge.state.get('savePosition') || { x: 0, y: 1 };
    forge.setPosition(entityId, savePos.x, savePos.y, 0);
    forge.physics2d.setVelocity(entityId, 0, 0);
  }
}`,
      enabled: true,
    },
    camera: {
      source: `// 2D Camera Follow
const SMOOTH = 0.1;

function onUpdate(dt) {
  const players = forge.scene.findByName('Player');
  if (players.length === 0) return;

  const playerState = forge.getTransform(players[0]);
  const camState = forge.getTransform(entityId);
  if (!playerState || !camState) return;

  const targetX = playerState.position[0];
  const targetY = Math.max(2, playerState.position[1] + 1);

  const newX = camState.position[0] + (targetX - camState.position[0]) * SMOOTH;
  const newY = camState.position[1] + (targetY - camState.position[1]) * SMOOTH;

  forge.setPosition(entityId, newX, newY, 10);
}`,
      enabled: true,
    },
    ability_gate: {
      source: `// Ability Gate Check
let opened = false;

function onUpdate(dt) {
  if (opened || !forge.state.get('hasDoubleJump')) return;
  opened = true;

  forge.setVisibility(entityId, false);
  // Unconditional. There is no way to read an entity's components from a
  // script, and none is needed: toggling physics off on an entity that has
  // none is a no-op in the engine rather than an error. The opened latch is
  // what keeps this from re-dispatching on every frame after the unlock.
  forge.physics2d.setEnabled(entityId, false);
}`,
      enabled: true,
    },
    enemy_1: {
      source: `// Enemy Patrol
const SPEED = 1.5;
const START_X = 7;
const RANGE = 3;
let dir = -1;

function onUpdate(dt) {
  const state = forge.getTransform(entityId);
  if (!state) return;

  const newX = state.position[0] + SPEED * dir * dt;
  if (newX < START_X - RANGE) dir = 1;
  if (newX > START_X + RANGE) dir = -1;

  forge.setPosition(entityId, newX, state.position[1], state.position[2]);
}

forge.physics2d.onCollisionEnter((event) => {
  if (forge.scene.getEntityName(event.otherEntityId) === 'Player') {
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

function onUpdate(dt) {
  const state = forge.getTransform(entityId);
  if (!state) return;

  const newX = state.position[0] + SPEED * dir * dt;
  if (newX < START_X - RANGE) dir = 1;
  if (newX > START_X + RANGE) dir = -1;

  forge.setPosition(entityId, newX, state.position[1], state.position[2]);
}

forge.physics2d.onCollisionEnter((event) => {
  if (forge.scene.getEntityName(event.otherEntityId) === 'Player') {
    forge.state.set('playerHit', true);
  }
});`,
      enabled: true,
    },
    game_manager: {
      source: `// Metroidvania Game Manager
let mapProgress = 0;

// Countdowns rather than setTimeout: the sandbox shadows the timer globals,
// so a scheduled hide would never fire and the banner would stay on screen.
let unlockTimer = -1;
let savedTimer = -1;

function onStart() {
  forge.ui.showText('map', 'Map: 0%', 5, 5, { fontSize: 18, color: '#00ffcc' });
  forge.ui.showText('abilities', 'Abilities: None', 5, 10, { fontSize: 16, color: '#ffaa00' });
  forge.ui.showText('hint', 'Explore to unlock double jump!', 5, 92, {
    fontSize: 14, color: '#aaa'
  });

  forge.physics2d.onCollisionEnter((event) => {
    if (forge.scene.getEntityName(event.entityId) !== 'Player') return;
    const name = event.otherEntityName;
    if (!name) return;

    if (name === 'AbilityPickup') {
      forge.state.set('hasDoubleJump', true);
      forge.setVisibility(event.otherEntityId, false);
      forge.ui.updateText('abilities', 'Abilities: Double Jump');
      forge.ui.showText('unlock', 'Double Jump Unlocked!', 30, 50, {
        fontSize: 24, color: '#ff9900'
      });
      unlockTimer = 2;
    }

    if (name.indexOf('SavePoint_') === 0) {
      const state = forge.getTransform(event.entityId);
      if (state) {
        forge.state.set('savePosition', { x: state.position[0], y: state.position[1] });
        forge.ui.showText('saved', 'Progress Saved', 40, 50, {
          fontSize: 18, color: '#00ffcc'
        });
        savedTimer = 1.5;
        mapProgress = Math.min(100, mapProgress + 25);
        forge.ui.updateText('map', 'Map: ' + mapProgress + '%');
      }
    }
  });
}

function onUpdate(dt) {
  if (unlockTimer > 0) {
    unlockTimer -= dt;
    if (unlockTimer <= 0) { unlockTimer = -1; forge.ui.removeText('unlock'); }
  }
  if (savedTimer > 0) {
    savedTimer -= dt;
    if (savedTimer <= 0) { savedTimer = -1; forge.ui.removeText('saved'); }
  }

  if (forge.state.get('playerHit')) {
    forge.state.set('playerHit', false);
    const savePos = forge.state.get('savePosition') || { x: 0, y: 1 };
    const players = forge.scene.findByName('Player');
    if (players.length > 0) {
      forge.setPosition(players[0], savePos.x, savePos.y, 0);
      forge.physics2d.setVelocity(players[0], 0, 0);
    }
  }
}`,
      enabled: true,
    },
  },
};
