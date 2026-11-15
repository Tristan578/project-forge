/**
 * 2D Shoot-em-up Game Template
 *
 * Vertical scrolling shooter with player ship, enemy waves, bullets, and powerups.
 */

import type { GameTemplate } from './index';

export const SHMUP_2D_TEMPLATE: GameTemplate = {
  id: '2d-shmup',
  name: '2D Shoot-em-up',
  description: 'Vertical scrolling shooter. Dodge bullets, defeat waves of enemies.',
  category: '2d_shmup',
  difficulty: 'intermediate',
  thumbnail: {
    gradient: 'linear-gradient(135deg, #ef4444, #b91c1c)',
    icon: 'Target',
    accentColor: '#ef4444',
  },
  tags: ['2d', 'shooter', 'shmup', 'arcade'],


  sceneData: {
    formatVersion: 3,
    metadata: {
      name: '2D Shoot-em-up',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    environment: {
      skyboxBrightness: 0.3,
      iblIntensity: 0.2,
      iblRotationDegrees: 0,
      clearColor: [0.05, 0.05, 0.15],
      fogEnabled: false,
      fogColor: [0.5, 0.5, 0.5],
      fogStart: 10,
      fogEnd: 50,
      skyboxPreset: 'night',
      skyboxAssetId: null,
    },
    ambientLight: {
      color: [1, 1, 1],
      brightness: 600,
    },
    inputBindings: {},
    postProcessing: {
      bloomEnabled: true,
      bloomIntensity: 0.15,
      bloomThreshold: 0.8,
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
      // Player ship
      {
        entityId: 'player',
        entityName: 'Player',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, -6, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        material: {
          baseColor: [0.2, 0.8, 1.0, 1.0],
          metallic: 0.7,
          perceptualRoughness: 0.3,
          reflectance: 0.8,
          emissive: [0.1, 0.4, 0.5, 1.0],
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
            friction: 0.0,
            restitution: 0.0,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'health',
            health: { maxHp: 3, currentHp: 3, respawnOnDeath: false },
          },
        ],
      },
      // Enemy formation
      ...Array.from({ length: 8 }, (_, i) => ({
        entityId: `enemy_${String(i + 1).padStart(2, '0')}`,
        entityName: `Enemy_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [(i % 4 - 1.5) * 2, 5 + Math.floor(i / 4) * 2, 0] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.8, 0.8, 1] as [number, number, number],
        },
        material: {
          baseColor: [1.0, 0.2, 0.2, 1.0],
          metallic: 0.5,
          perceptualRoughness: 0.4,
          reflectance: 0.6,
          emissive: [0.5, 0.1, 0.1, 1.0],
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
            friction: 0.0,
            restitution: 0.0,
          },
          enabled: true,
        },
      })),
      // Powerups
      {
        entityId: 'powerup_1',
        entityName: 'Powerup_1',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [-3, 8, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.6, 0.6, 1],
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
        gameComponents: [
          {
            type: 'collectible',
            collectible: { value: 50, rotateSpeed: 120 },
          },
        ],
      },
      {
        entityId: 'powerup_2',
        entityName: 'Powerup_2',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [3, 10, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.6, 0.6, 1],
        },
        material: {
          baseColor: [0.0, 1.0, 0.5, 1.0],
          metallic: 0.8,
          perceptualRoughness: 0.2,
          reflectance: 0.9,
          emissive: [0.0, 0.5, 0.25, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        gameComponents: [
          {
            type: 'collectible',
            collectible: { value: 100, rotateSpeed: 120 },
          },
        ],
      },
      // Background elements
      ...Array.from({ length: 6 }, (_, i) => ({
        entityId: `bg_star_${String(i + 1).padStart(2, '0')}`,
        entityName: `BgStar_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [(i % 3 - 1) * 4, (i < 3 ? 0 : 6), -1] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.2, 0.2, 1] as [number, number, number],
        },
        material: {
          baseColor: [1.0, 1.0, 1.0, 0.8],
          metallic: 0,
          perceptualRoughness: 0.5,
          reflectance: 0.5,
          emissive: [0.8, 0.8, 0.8, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'blend',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: true,
        },
      })),
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
      // Bullet spawner
      {
        entityId: 'bullet_spawner',
        entityName: 'BulletSpawner',
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
      source: `// Ship Controller
const SPEED = 5;
const FIRE_RATE = 0.15;
let fireTimer = 0;

function onUpdate(dt) {
  let dx = 0, dy = 0;
  if (forge.input.isPressed('move_left')) dx = -SPEED * dt;
  if (forge.input.isPressed('move_right')) dx = SPEED * dt;
  if (forge.input.isPressed('move_up')) dy = SPEED * dt;
  if (forge.input.isPressed('move_down')) dy = -SPEED * dt;

  const state = forge.getTransform(entityId);
  if (!state) return;

  const newX = Math.max(-6, Math.min(6, state.position[0] + dx));
  const newY = Math.max(-7, Math.min(7, state.position[1] + dy));
  forge.setPosition(entityId, newX, newY, state.position[2]);

  fireTimer -= dt;
  // Held, not tapped: action_primary is mouse-left or J.
  if (forge.input.isPressed('action_primary') && fireTimer <= 0) {
    fireTimer = FIRE_RATE;
    forge.state.set('fireBullet', { x: newX, y: newY + 0.8 });
  }
}`,
      enabled: true,
    },
    bullet_spawner: {
      source: `// Bullet Spawner
//
// EVERY BULLET ADVANCES ON THE FRAME TICK. This used to call setInterval and
// read Date.now(), and the script sandbox shadows both -- so no bullet ever
// moved, and the interval that was meant to clear itself never ran at all.
// onUpdate already gives a delta; a list of live bullets is all this needs.
let bulletId = 0;
let bullets = [];

function onUpdate(dt) {
  const fireData = forge.state.get('fireBullet');
  if (fireData) {
    forge.state.set('fireBullet', null);
    bulletId++;
    const id = 'bullet_' + bulletId;
    bullets.push({ id: id, x: fireData.x, y: fireData.y });
    forge.ui.showText(id, '|', fireData.x * 10 + 50, 95 - (fireData.y + 7) * 5, {
      fontSize: 12, color: '#00ffff'
    });
  }

  const enemies = forge.scene.findByType('Sprite').filter(function (id) {
    const name = forge.scene.getEntityName(id);
    return name !== null && name.indexOf('Enemy_') === 0;
  });

  const surviving = [];
  for (const bullet of bullets) {
    bullet.y += 15 * dt;

    if (bullet.y > 12) {
      forge.ui.removeText(bullet.id);
      continue;
    }

    let hit = false;
    for (const enemy of enemies) {
      const enemyState = forge.getTransform(enemy);
      if (!enemyState) continue;
      const dx = bullet.x - enemyState.position[0];
      const dy = bullet.y - enemyState.position[1];
      if (Math.sqrt(dx * dx + dy * dy) < 0.8) {
        forge.setVisibility(enemy, false);
        forge.state.set('enemyKilled', true);
        hit = true;
        break;
      }
    }

    if (hit) {
      forge.ui.removeText(bullet.id);
      continue;
    }

    forge.ui.updateText(bullet.id, '|', bullet.x * 10 + 50, 95 - (bullet.y + 7) * 5);
    surviving.push(bullet);
  }
  bullets = surviving;
}`,
      enabled: true,
    },
    enemy_01: {
      source: `// Enemy Movement
const START_Y = 5;
const SPEED = 1.0;
let dir = 1;

function onUpdate(dt) {
  const state = forge.getTransform(entityId);
  if (!state) return;

  const newX = state.position[0] + SPEED * dir * dt;
  if (newX < -5 || newX > 5) dir *= -1;

  if (state.position[1] < -8) {
    forge.setPosition(entityId, newX, START_Y, state.position[2]);
  } else {
    forge.setPosition(entityId, newX, state.position[1] - 0.3 * dt, state.position[2]);
  }
}`,
      enabled: true,
    },
    enemy_02: {
      source: `// Enemy Movement
const START_Y = 5;
const SPEED = 1.2;
let dir = -1;

function onUpdate(dt) {
  const state = forge.getTransform(entityId);
  if (!state) return;

  const newX = state.position[0] + SPEED * dir * dt;
  if (newX < -5 || newX > 5) dir *= -1;

  if (state.position[1] < -8) {
    forge.setPosition(entityId, newX, START_Y, state.position[2]);
  } else {
    forge.setPosition(entityId, newX, state.position[1] - 0.35 * dt, state.position[2]);
  }
}`,
      enabled: true,
    },
    bg_star_01: {
      source: `// Scrolling Background
const SPEED = 0.5;

function onUpdate(dt) {
  const state = forge.getTransform(entityId);
  if (!state) return;

  const newY = state.position[1] - SPEED * dt;
  if (newY < -8) {
    forge.setPosition(entityId, state.position[0], 8, state.position[2]);
  } else {
    forge.setPosition(entityId, state.position[0], newY, state.position[2]);
  }
}`,
      enabled: true,
    },
    game_manager: {
      source: `// Game Manager
let score = 0;
let hp = 3;

let restartTimer = -1;

function onStart() {
  forge.ui.showText('score', 'Score: 0', 5, 5, { fontSize: 20, color: '#00ffff' });
  forge.ui.showText('hp', 'HP: 3', 5, 10, { fontSize: 18, color: '#ff0000' });
  forge.ui.showText('hint', 'WASD to move, J or mouse to shoot', 5, 92, {
    fontSize: 14, color: '#aaa'
  });

  // ONE argument, and it reports every 2D collision -- so the player is
  // identified from the event rather than subscribed to by id.
  forge.physics2d.onCollisionEnter((event) => {
    if (forge.scene.getEntityName(event.entityId) !== 'Player') return;
    const name = event.otherEntityName;
    if (!name) return;

    if (name.indexOf('Enemy_') === 0) {
      hp--;
      forge.ui.updateText('hp', 'HP: ' + hp);
      forge.setVisibility(event.otherEntityId, false);

      if (hp <= 0) {
        forge.ui.showText('gameover', 'GAME OVER', 35, 45, {
          fontSize: 36, color: '#ff0000'
        });
        restartTimer = 3;
      }
    }

    // The NAME is the contract: a script cannot read an entity's game
    // components, so the scene names its pickups Powerup_NN and this matches
    // on that rather than on a component it cannot see.
    if (name.indexOf('Powerup_') === 0) {
      score += 1;
      forge.ui.updateText('score', 'Score: ' + score);
      forge.setVisibility(event.otherEntityId, false);
    }
  });
}

function onUpdate(dt) {
  // A countdown, not setTimeout: the sandbox shadows the timer globals.
  if (restartTimer > 0) {
    restartTimer -= dt;
    if (restartTimer <= 0) {
      restartTimer = -1;
      forge.scene.restart();
    }
  }

  if (forge.state.get('enemyKilled')) {
    forge.state.set('enemyKilled', false);
    score += 10;
    forge.ui.updateText('score', 'Score: ' + score);
  }
}`,
      enabled: true,
    },
  },
};
