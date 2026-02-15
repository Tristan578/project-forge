/**
 * 2D Fighting Game Template
 *
 * Two-player fighting game with health bars, attacks, and arena.
 */

import type { GameTemplate } from './index';

export const FIGHTER_2D_TEMPLATE: GameTemplate = {
  id: '2d-fighter',
  name: '2D Fighter',
  description: 'Two-player fighting game. Attack, defend, knockout opponent.',
  category: '2d_fighter',
  difficulty: 'intermediate',
  thumbnail: {
    gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    icon: 'Swords',
    accentColor: '#f59e0b',
  },
  tags: ['2d', 'fighting', 'pvp', 'action'],

  inputPreset: 'platformer',

  sceneData: {
    formatVersion: 3,
    metadata: {
      name: '2D Fighter',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    environment: {
      skyboxBrightness: 0.6,
      iblIntensity: 0.4,
      iblRotationDegrees: 0,
      clearColor: [0.2, 0.15, 0.1],
      fogEnabled: false,
      fogColor: [0.5, 0.5, 0.5],
      fogStart: 10,
      fogEnd: 50,
      skyboxPreset: null,
      skyboxAssetId: null,
    },
    ambientLight: {
      color: [1, 1, 1],
      brightness: 750,
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
      // Player 1
      {
        entityId: 'player1',
        entityName: 'Player1',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [-4, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1.2, 1.5, 1],
        },
        material: {
          baseColor: [0.3, 0.6, 1.0, 1.0],
          metallic: 0.3,
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
            bodyType: 'kinematic_position',
            mass: 1.0,
            friction: 0.8,
            restitution: 0.0,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'health',
            health: { maxHp: 100, currentHp: 100, respawnOnDeath: false },
          },
        ],
      },
      // Player 2
      {
        entityId: 'player2',
        entityName: 'Player2',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [4, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1.2, 1.5, 1],
        },
        material: {
          baseColor: [1.0, 0.3, 0.3, 1.0],
          metallic: 0.3,
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
            bodyType: 'kinematic_position',
            mass: 1.0,
            friction: 0.8,
            restitution: 0.0,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'health',
            health: { maxHp: 100, currentHp: 100, respawnOnDeath: false },
          },
        ],
      },
      // Arena floor
      {
        entityId: 'floor',
        entityName: 'Floor',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, -2, -0.5],
          rotation: [0, 0, 0, 1],
          scale: [12, 1, 1],
        },
        material: {
          baseColor: [0.4, 0.3, 0.2, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.9,
          reflectance: 0.3,
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
      // Arena boundaries
      {
        entityId: 'wall_left',
        entityName: 'WallLeft',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [-8, 2, -0.5],
          rotation: [0, 0, 0, 1],
          scale: [0.5, 8, 1],
        },
        material: {
          baseColor: [0.3, 0.3, 0.3, 0.5],
          metallic: 0,
          perceptualRoughness: 0.8,
          reflectance: 0.3,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'blend',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            mass: 1.0,
            friction: 0.5,
            restitution: 0.0,
          },
          enabled: true,
        },
      },
      {
        entityId: 'wall_right',
        entityName: 'WallRight',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [8, 2, -0.5],
          rotation: [0, 0, 0, 1],
          scale: [0.5, 8, 1],
        },
        material: {
          baseColor: [0.3, 0.3, 0.3, 0.5],
          metallic: 0,
          perceptualRoughness: 0.8,
          reflectance: 0.3,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'blend',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
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
          translation: [0, 0, 10],
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
    player1: {
      source: `// Player 1 Controller (WASD)
const SPEED = 4;
const ATTACK_RANGE = 2;
const ATTACK_DAMAGE = 10;
let attackCooldown = 0;

forge.onUpdate((dt) => {
  attackCooldown = Math.max(0, attackCooldown - dt);

  let dx = 0;
  if (forge.input.isKeyDown('a')) dx = -SPEED * dt;
  if (forge.input.isKeyDown('d')) dx = SPEED * dt;

  const pos = forge.transform.getPosition();
  if (!pos) return;

  const newX = Math.max(-7, Math.min(7, pos.x + dx));
  forge.transform.setPosition(newX, pos.y, pos.z);

  if (forge.input.isKeyPressed('Space') && attackCooldown <= 0) {
    attackCooldown = 0.5;

    const p2List = forge.scene.findByName('Player2');
    if (p2List.length === 0) return;

    const p2Pos = forge.transform.getPosition(p2List[0]);
    if (!p2Pos) return;

    const dist = Math.abs(newX - p2Pos.x);
    if (dist < ATTACK_RANGE) {
      forge.state.set('p1_hit_p2', ATTACK_DAMAGE);
    }
  }
});`,
      enabled: true,
    },
    player2: {
      source: `// Player 2 Controller (Arrow Keys)
const SPEED = 4;
const ATTACK_RANGE = 2;
const ATTACK_DAMAGE = 10;
let attackCooldown = 0;

forge.onUpdate((dt) => {
  attackCooldown = Math.max(0, attackCooldown - dt);

  let dx = 0;
  if (forge.input.isKeyDown('ArrowLeft')) dx = -SPEED * dt;
  if (forge.input.isKeyDown('ArrowRight')) dx = SPEED * dt;

  const pos = forge.transform.getPosition();
  if (!pos) return;

  const newX = Math.max(-7, Math.min(7, pos.x + dx));
  forge.transform.setPosition(newX, pos.y, pos.z);

  if (forge.input.isKeyPressed('Enter') && attackCooldown <= 0) {
    attackCooldown = 0.5;

    const p1List = forge.scene.findByName('Player1');
    if (p1List.length === 0) return;

    const p1Pos = forge.transform.getPosition(p1List[0]);
    if (!p1Pos) return;

    const dist = Math.abs(newX - p1Pos.x);
    if (dist < ATTACK_RANGE) {
      forge.state.set('p2_hit_p1', ATTACK_DAMAGE);
    }
  }
});`,
      enabled: true,
    },
    game_manager: {
      source: `// Fighting Game Manager
let p1Hp = 100;
let p2Hp = 100;
let gameOver = false;

forge.onStart(() => {
  forge.ui.showText('p1_hp', 'P1 HP: 100', 5, 5, { fontSize: 20, color: '#3b82f6' });
  forge.ui.showText('p2_hp', 'P2 HP: 100', 70, 5, { fontSize: 20, color: '#ef4444' });
  forge.ui.showText('p1_hint', 'P1: A/D move, Space attack', 5, 92, {
    fontSize: 14, color: '#aaa'
  });
  forge.ui.showText('p2_hint', 'P2: Arrows move, Enter attack', 55, 92, {
    fontSize: 14, color: '#aaa'
  });
});

forge.onUpdate(() => {
  if (gameOver) return;

  const p1Hit = forge.state.get('p1_hit_p2');
  if (p1Hit) {
    forge.state.set('p1_hit_p2', null);
    p2Hp = Math.max(0, p2Hp - p1Hit);
    forge.ui.updateText('p2_hp', 'P2 HP: ' + p2Hp);

    if (p2Hp <= 0) {
      gameOver = true;
      forge.ui.showText('winner', 'PLAYER 1 WINS!', 25, 45, {
        fontSize: 36, color: '#3b82f6'
      });
      setTimeout(() => forge.scene.restart(), 3000);
    }
  }

  const p2Hit = forge.state.get('p2_hit_p1');
  if (p2Hit) {
    forge.state.set('p2_hit_p1', null);
    p1Hp = Math.max(0, p1Hp - p2Hit);
    forge.ui.updateText('p1_hp', 'P1 HP: ' + p1Hp);

    if (p1Hp <= 0) {
      gameOver = true;
      forge.ui.showText('winner', 'PLAYER 2 WINS!', 25, 45, {
        fontSize: 36, color: '#ef4444'
      });
      setTimeout(() => forge.scene.restart(), 3000);
    }
  }
});`,
      enabled: true,
    },
  },
};
