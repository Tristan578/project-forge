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

  inputPreset: 'platformer',

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

forge.onUpdate((dt) => {
  let dx = 0, dy = 0;
  if (forge.input.isKeyDown('a') || forge.input.isKeyDown('ArrowLeft')) dx = -SPEED * dt;
  if (forge.input.isKeyDown('d') || forge.input.isKeyDown('ArrowRight')) dx = SPEED * dt;
  if (forge.input.isKeyDown('w') || forge.input.isKeyDown('ArrowUp')) dy = SPEED * dt;
  if (forge.input.isKeyDown('s') || forge.input.isKeyDown('ArrowDown')) dy = -SPEED * dt;

  const pos = forge.transform.getPosition();
  if (!pos) return;

  const newX = Math.max(-6, Math.min(6, pos.x + dx));
  const newY = Math.max(-7, Math.min(7, pos.y + dy));
  forge.transform.setPosition(newX, newY, pos.z);

  fireTimer -= dt;
  if (forge.input.isKeyDown('Space') && fireTimer <= 0) {
    fireTimer = FIRE_RATE;
    forge.state.set('fireBullet', { x: newX, y: newY + 0.8 });
  }
});`,
      enabled: true,
    },
    bullet_spawner: {
      source: `// Bullet Spawner
let bulletId = 0;

forge.onUpdate(() => {
  const fireData = forge.state.get('fireBullet');
  if (!fireData) return;
  forge.state.set('fireBullet', null);

  bulletId++;
  forge.ui.showText('bullet_' + bulletId, '|', fireData.x * 10 + 50, 95 - (fireData.y + 7) * 5, {
    fontSize: 12, color: '#00ffff'
  });

  const startTime = Date.now();
  const interval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const newY = fireData.y + elapsed * 15;

    if (newY > 12) {
      clearInterval(interval);
      forge.ui.removeText('bullet_' + bulletId);
      return;
    }

    forge.ui.updateText('bullet_' + bulletId, '|', fireData.x * 10 + 50, 95 - (newY + 7) * 5);

    const enemies = forge.scene.findByType('Sprite').filter(id =>
      forge.scene.getEntityName(id)?.startsWith('Enemy_')
    );

    for (const enemy of enemies) {
      const enemyPos = forge.transform.getPosition(enemy);
      if (!enemyPos) continue;
      const dx = fireData.x - enemyPos.x;
      const dy = newY - enemyPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.8) {
        forge.setVisibility(enemy, false);
        forge.state.set('enemyKilled', true);
        clearInterval(interval);
        forge.ui.removeText('bullet_' + bulletId);
        break;
      }
    }
  }, 16);
});`,
      enabled: true,
    },
    enemy_01: {
      source: `// Enemy Movement
const START_Y = 5;
const SPEED = 1.0;
let dir = 1;

forge.onUpdate((dt) => {
  const pos = forge.transform.getPosition();
  if (!pos) return;

  const newX = pos.x + SPEED * dir * dt;
  if (newX < -5 || newX > 5) dir *= -1;

  forge.transform.setPosition(newX, pos.y - 0.3 * dt, pos.z);

  if (pos.y < -8) {
    forge.transform.setPosition(newX, START_Y, pos.z);
  }
});`,
      enabled: true,
    },
    enemy_02: {
      source: `// Enemy Movement
const START_Y = 5;
const SPEED = 1.2;
let dir = -1;

forge.onUpdate((dt) => {
  const pos = forge.transform.getPosition();
  if (!pos) return;

  const newX = pos.x + SPEED * dir * dt;
  if (newX < -5 || newX > 5) dir *= -1;

  forge.transform.setPosition(newX, pos.y - 0.35 * dt, pos.z);

  if (pos.y < -8) {
    forge.transform.setPosition(newX, START_Y, pos.z);
  }
});`,
      enabled: true,
    },
    bg_star_01: {
      source: `// Scrolling Background
const SPEED = 0.5;

forge.onUpdate((dt) => {
  const pos = forge.transform.getPosition();
  if (!pos) return;

  const newY = pos.y - SPEED * dt;
  if (newY < -8) {
    forge.transform.setPosition(pos.x, 8, pos.z);
  } else {
    forge.transform.setPosition(pos.x, newY, pos.z);
  }
});`,
      enabled: true,
    },
    game_manager: {
      source: `// Game Manager
let score = 0;
let hp = 3;

forge.onStart(() => {
  forge.ui.showText('score', 'Score: 0', 5, 5, { fontSize: 20, color: '#00ffff' });
  forge.ui.showText('hp', 'HP: 3', 5, 10, { fontSize: 18, color: '#ff0000' });
  forge.ui.showText('hint', 'WASD to move, Space to shoot', 5, 92, {
    fontSize: 14, color: '#aaa'
  });

  const players = forge.scene.findByName('Player');
  if (players.length === 0) return;

  forge.physics2d.onCollisionEnter(players[0], (other) => {
    const name = forge.scene.getEntityName(other);
    if (name && name.startsWith('Enemy_')) {
      hp--;
      forge.ui.updateText('hp', 'HP: ' + hp);
      forge.setVisibility(other, false);

      if (hp <= 0) {
        forge.ui.showText('gameover', 'GAME OVER', 35, 45, {
          fontSize: 36, color: '#ff0000'
        });
        setTimeout(() => forge.scene.restart(), 3000);
      }
    }
    if (name && name.startsWith('Powerup_')) {
      const collectible = forge.scene.getComponent(other, 'collectible');
      if (collectible) {
        score += collectible.value || 1;
        forge.ui.updateText('score', 'Score: ' + score);
        forge.setVisibility(other, false);
      }
    }
  });
});

forge.onUpdate(() => {
  if (forge.state.get('enemyKilled')) {
    forge.state.set('enemyKilled', false);
    score += 10;
    forge.ui.updateText('score', 'Score: ' + score);
  }
});`,
      enabled: true,
    },
  },
};
