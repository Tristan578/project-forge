/**
 * 2D Top-Down RPG Game Template
 *
 * Zelda-style top-down adventure with player, NPCs, items, and exploration.
 */

import type { GameTemplate } from './index';

export const TOPDOWN_2D_TEMPLATE: GameTemplate = {
  id: '2d-topdown',
  name: '2D Top-Down RPG',
  description: 'Zelda-style adventure. Explore, talk to NPCs, collect items.',
  category: '2d_topdown',
  difficulty: 'beginner',
  thumbnail: {
    gradient: 'linear-gradient(135deg, #10b981, #059669)',
    icon: 'Map',
    accentColor: '#10b981',
  },
  tags: ['2d', 'rpg', 'exploration', 'dialogue'],

  inputPreset: 'topdown',

  sceneData: {
    formatVersion: 3,
    metadata: {
      name: '2D Top-Down RPG',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    environment: {
      skyboxBrightness: 0.5,
      iblIntensity: 0.3,
      iblRotationDegrees: 0,
      clearColor: [0.2, 0.3, 0.15],
      fogEnabled: false,
      fogColor: [0.5, 0.5, 0.5],
      fogStart: 10,
      fogEnd: 50,
      skyboxPreset: null,
      skyboxAssetId: null,
    },
    ambientLight: {
      color: [1, 1, 1],
      brightness: 700,
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
          translation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        material: {
          baseColor: [0.3, 0.7, 1.0, 1.0],
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
            friction: 0.8,
            restitution: 0.0,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'health',
            health: { maxHp: 5, currentHp: 5, respawnOnDeath: true },
          },
        ],
      },
      // Ground tiles
      ...Array.from({ length: 16 }, (_, i) => {
        const row = Math.floor(i / 4);
        const col = i % 4;
        return {
          entityId: `ground_${String(i + 1).padStart(2, '0')}`,
          entityName: `Ground_${String(i + 1).padStart(2, '0')}`,
          entityType: 'Sprite',
          parentId: null,
          visible: true,
          transform: {
            translation: [col * 4 - 6, row * 4 - 6, -0.5] as [number, number, number],
            rotation: [0, 0, 0, 1] as [number, number, number, number],
            scale: [4, 4, 1] as [number, number, number],
          },
          material: {
            baseColor: [0.3, 0.5, 0.2, 1.0],
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
        };
      }),
      // Walls
      {
        entityId: 'wall_1',
        entityName: 'Wall_1',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [-4, 4, 0],
          rotation: [0, 0, 0, 1],
          scale: [3, 1, 1],
        },
        material: {
          baseColor: [0.5, 0.4, 0.3, 1.0],
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
            friction: 0.5,
            restitution: 0.0,
          },
          enabled: true,
        },
      },
      {
        entityId: 'wall_2',
        entityName: 'Wall_2',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [3, -3, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 3, 1],
        },
        material: {
          baseColor: [0.5, 0.4, 0.3, 1.0],
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
            friction: 0.5,
            restitution: 0.0,
          },
          enabled: true,
        },
      },
      // NPCs
      {
        entityId: 'npc_1',
        entityName: 'NPC_1',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [-3, -2, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.9, 0.9, 1],
        },
        material: {
          baseColor: [1.0, 0.8, 0.4, 1.0],
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
      },
      {
        entityId: 'npc_2',
        entityName: 'NPC_2',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [4, 3, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.9, 0.9, 1],
        },
        material: {
          baseColor: [0.6, 0.3, 0.8, 1.0],
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
      },
      // Items
      {
        entityId: 'item_1',
        entityName: 'Item_1',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [5, -4, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.7, 0.7, 1],
        },
        material: {
          baseColor: [1.0, 0.0, 0.5, 1.0],
          metallic: 0.5,
          perceptualRoughness: 0.3,
          reflectance: 0.8,
          emissive: [0.3, 0.0, 0.15, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        gameComponents: [
          {
            type: 'collectible',
            collectible: { value: 10, rotateSpeed: 60 },
          },
        ],
      },
      {
        entityId: 'item_2',
        entityName: 'Item_2',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [-5, 5, 0],
          rotation: [0, 0, 0, 1],
          scale: [0.7, 0.7, 1],
        },
        material: {
          baseColor: [0.0, 1.0, 1.0, 1.0],
          metallic: 0.5,
          perceptualRoughness: 0.3,
          reflectance: 0.8,
          emissive: [0.0, 0.3, 0.3, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        gameComponents: [
          {
            type: 'collectible',
            collectible: { value: 15, rotateSpeed: 60 },
          },
        ],
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
    player: {
      source: `// Top-Down Controller
const SPEED = 4;

forge.onUpdate((dt) => {
  let dx = 0, dy = 0;
  if (forge.input.isKeyDown('w') || forge.input.isKeyDown('ArrowUp')) dy += SPEED * dt;
  if (forge.input.isKeyDown('s') || forge.input.isKeyDown('ArrowDown')) dy -= SPEED * dt;
  if (forge.input.isKeyDown('a') || forge.input.isKeyDown('ArrowLeft')) dx -= SPEED * dt;
  if (forge.input.isKeyDown('d') || forge.input.isKeyDown('ArrowRight')) dx += SPEED * dt;

  const pos = forge.transform.getPosition();
  if (!pos) return;
  forge.transform.setPosition(pos.x + dx, pos.y + dy, pos.z);

  if (forge.input.isKeyPressed('e')) {
    forge.state.set('interactPressed', true);
  }
});`,
      enabled: true,
    },
    camera: {
      source: `// Top-Down Camera Follow
const SMOOTH = 0.08;

forge.onUpdate((dt) => {
  const players = forge.scene.findByName('Player');
  if (players.length === 0) return;

  const playerPos = forge.transform.getPosition(players[0]);
  const camPos = forge.transform.getPosition();
  if (!playerPos || !camPos) return;

  const newX = camPos.x + (playerPos.x - camPos.x) * SMOOTH;
  const newY = camPos.y + (playerPos.y - camPos.y) * SMOOTH;

  forge.transform.setPosition(newX, newY, 10);
});`,
      enabled: true,
    },
    npc_1: {
      source: `// NPC Dialogue Trigger
const INTERACT_DIST = 1.5;

forge.onUpdate(() => {
  if (!forge.state.get('interactPressed')) return;
  forge.state.set('interactPressed', false);

  const players = forge.scene.findByName('Player');
  if (players.length === 0) return;

  const playerPos = forge.transform.getPosition(players[0]);
  const myPos = forge.transform.getPosition();
  if (!playerPos || !myPos) return;

  const dx = playerPos.x - myPos.x;
  const dy = playerPos.y - myPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < INTERACT_DIST) {
    forge.ui.showText('npc1_dialogue', 'NPC: Welcome, traveler! Explore the world.', 10, 80, {
      fontSize: 16, color: '#ffcc00'
    });
    setTimeout(() => forge.ui.removeText('npc1_dialogue'), 3000);
  }
});`,
      enabled: true,
    },
    npc_2: {
      source: `// NPC Dialogue Trigger
const INTERACT_DIST = 1.5;

forge.onUpdate(() => {
  if (!forge.state.get('interactPressed')) return;
  forge.state.set('interactPressed', false);

  const players = forge.scene.findByName('Player');
  if (players.length === 0) return;

  const playerPos = forge.transform.getPosition(players[0]);
  const myPos = forge.transform.getPosition();
  if (!playerPos || !myPos) return;

  const dx = playerPos.x - myPos.x;
  const dy = playerPos.y - myPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < INTERACT_DIST) {
    forge.ui.showText('npc2_dialogue', 'NPC: I heard treasures lie beyond the walls!', 10, 80, {
      fontSize: 16, color: '#cc99ff'
    });
    setTimeout(() => forge.ui.removeText('npc2_dialogue'), 3000);
  }
});`,
      enabled: true,
    },
    game_manager: {
      source: `// Game Manager
let score = 0;

forge.onStart(() => {
  forge.ui.showText('score', 'Score: 0', 5, 5, { fontSize: 18, color: '#00ff00' });
  forge.ui.showText('hint', 'Use WASD to move, E to interact', 5, 92, {
    fontSize: 14, color: '#aaa'
  });

  const players = forge.scene.findByName('Player');
  if (players.length === 0) return;

  forge.physics2d.onCollisionEnter(players[0], (other) => {
    const name = forge.scene.getEntityName(other);
    if (name && name.startsWith('Item_')) {
      const collectible = forge.scene.getComponent(other, 'collectible');
      if (collectible) {
        score += collectible.value || 1;
        forge.setVisibility(other, false);
        forge.ui.updateText('score', 'Score: ' + score);
      }
    }
  });
});`,
      enabled: true,
    },
  },
};
