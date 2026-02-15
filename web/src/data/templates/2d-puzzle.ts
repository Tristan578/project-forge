/**
 * 2D Puzzle Game Template
 *
 * Match-3 or sliding puzzle game with grid cells and piece matching.
 */

import type { GameTemplate } from './index';

export const PUZZLE_2D_TEMPLATE: GameTemplate = {
  id: '2d-puzzle',
  name: '2D Puzzle Game',
  description: 'Match-3 puzzle game. Swap tiles to create matches.',
  category: '2d_puzzle',
  difficulty: 'intermediate',
  thumbnail: {
    gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    icon: 'Grid3x3',
    accentColor: '#8b5cf6',
  },
  tags: ['2d', 'puzzle', 'match-3', 'logic'],

  inputPreset: 'topdown',

  sceneData: {
    formatVersion: 3,
    metadata: {
      name: '2D Puzzle Game',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    environment: {
      skyboxBrightness: 0.5,
      iblIntensity: 0.3,
      iblRotationDegrees: 0,
      clearColor: [0.15, 0.1, 0.2],
      fogEnabled: false,
      fogColor: [0.5, 0.5, 0.5],
      fogStart: 10,
      fogEnd: 50,
      skyboxPreset: null,
      skyboxAssetId: null,
    },
    ambientLight: {
      color: [1, 1, 1],
      brightness: 900,
    },
    inputBindings: {},
    postProcessing: {
      bloomEnabled: true,
      bloomIntensity: 0.1,
      bloomThreshold: 0.9,
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
      // Grid cells (5x5 grid)
      ...Array.from({ length: 25 }, (_, i) => {
        const row = Math.floor(i / 5);
        const col = i % 5;
        const colors = [
          [1.0, 0.2, 0.2, 1.0],
          [0.2, 1.0, 0.2, 1.0],
          [0.2, 0.2, 1.0, 1.0],
          [1.0, 1.0, 0.2, 1.0],
          [1.0, 0.2, 1.0, 1.0],
        ];
        const colorIndex = (row + col) % 5;
        return {
          entityId: `cell_${String(row).padStart(2, '0')}_${String(col).padStart(2, '0')}`,
          entityName: `Cell_${row}_${col}`,
          entityType: 'Sprite',
          parentId: null,
          visible: true,
          transform: {
            translation: [(col - 2) * 1.2, (2 - row) * 1.2, 0] as [number, number, number],
            rotation: [0, 0, 0, 1] as [number, number, number, number],
            scale: [1, 1, 1] as [number, number, number],
          },
          material: {
            baseColor: colors[colorIndex] as [number, number, number, number],
            metallic: 0.3,
            perceptualRoughness: 0.6,
            reflectance: 0.5,
            emissive: [0, 0, 0, 0],
            emissiveExposureWeight: 0,
            alphaMode: 'opaque',
            alphaCutoff: 0.5,
            doubleSided: false,
            unlit: false,
          },
        };
      }),
      // Background
      {
        entityId: 'background',
        entityName: 'Background',
        entityType: 'Sprite',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 0, -1],
          rotation: [0, 0, 0, 1],
          scale: [10, 10, 1],
        },
        material: {
          baseColor: [0.1, 0.08, 0.15, 1.0],
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
    game_manager: {
      source: `// Puzzle Game Manager
let score = 0;
let moves = 0;
let selected = null;

const GRID_SIZE = 5;
const COLORS = [
  [1.0, 0.2, 0.2],
  [0.2, 1.0, 0.2],
  [0.2, 0.2, 1.0],
  [1.0, 1.0, 0.2],
  [1.0, 0.2, 1.0],
];

function getCellPos(name) {
  const match = name.match(/Cell_(\\d+)_(\\d+)/);
  if (!match) return null;
  return { row: parseInt(match[1]), col: parseInt(match[2]) };
}

function getCellName(row, col) {
  return 'Cell_' + row + '_' + col;
}

function swapCells(cell1, cell2) {
  const mat1 = forge.scene.getComponent(cell1, 'material');
  const mat2 = forge.scene.getComponent(cell2, 'material');
  if (!mat1 || !mat2) return;

  forge.material.setBaseColor(cell1, mat2.baseColor[0], mat2.baseColor[1], mat2.baseColor[2], 1);
  forge.material.setBaseColor(cell2, mat1.baseColor[0], mat1.baseColor[1], mat1.baseColor[2], 1);
}

function checkMatches() {
  let matchCount = 0;

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE - 2; col++) {
      const cells = [];
      for (let i = 0; i < 3; i++) {
        const cellId = forge.scene.findByName(getCellName(row, col + i))[0];
        if (!cellId) continue;
        const mat = forge.scene.getComponent(cellId, 'material');
        if (!mat) continue;
        cells.push({ id: cellId, color: mat.baseColor });
      }

      if (cells.length === 3 &&
          cells[0].color[0] === cells[1].color[0] &&
          cells[1].color[0] === cells[2].color[0]) {
        matchCount++;
        for (const cell of cells) {
          const newColor = COLORS[Math.floor(Math.random() * COLORS.length)];
          forge.material.setBaseColor(cell.id, newColor[0], newColor[1], newColor[2], 1);
        }
      }
    }
  }

  for (let col = 0; col < GRID_SIZE; col++) {
    for (let row = 0; row < GRID_SIZE - 2; row++) {
      const cells = [];
      for (let i = 0; i < 3; i++) {
        const cellId = forge.scene.findByName(getCellName(row + i, col))[0];
        if (!cellId) continue;
        const mat = forge.scene.getComponent(cellId, 'material');
        if (!mat) continue;
        cells.push({ id: cellId, color: mat.baseColor });
      }

      if (cells.length === 3 &&
          cells[0].color[0] === cells[1].color[0] &&
          cells[1].color[0] === cells[2].color[0]) {
        matchCount++;
        for (const cell of cells) {
          const newColor = COLORS[Math.floor(Math.random() * COLORS.length)];
          forge.material.setBaseColor(cell.id, newColor[0], newColor[1], newColor[2], 1);
        }
      }
    }
  }

  if (matchCount > 0) {
    score += matchCount * 10;
    forge.ui.updateText('score', 'Score: ' + score);
  }
}

forge.onStart(() => {
  forge.ui.showText('score', 'Score: 0', 5, 5, { fontSize: 20, color: '#ffcc00' });
  forge.ui.showText('moves', 'Moves: 0', 5, 10, { fontSize: 18, color: '#cccccc' });
  forge.ui.showText('hint', 'Click two adjacent tiles to swap', 5, 92, {
    fontSize: 14, color: '#aaa'
  });
});

forge.onUpdate(() => {
  if (forge.input.isMousePressed(0)) {
    const mousePos = forge.input.getMousePosition();
    const worldPos = forge.camera.screenToWorld(mousePos.x, mousePos.y);
    if (!worldPos) return;

    const cells = forge.scene.findByType('Sprite').filter(id => {
      const name = forge.scene.getEntityName(id);
      return name && name.startsWith('Cell_');
    });

    for (const cell of cells) {
      const pos = forge.transform.getPosition(cell);
      if (!pos) continue;

      const dx = worldPos.x - pos.x;
      const dy = worldPos.y - pos.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        if (!selected) {
          selected = cell;
          forge.material.setEmissive(cell, 0.3, 0.3, 0.3, 1);
        } else {
          const pos1 = getCellPos(forge.scene.getEntityName(selected));
          const pos2 = getCellPos(forge.scene.getEntityName(cell));

          if (pos1 && pos2) {
            const adjacent = (Math.abs(pos1.row - pos2.row) === 1 && pos1.col === pos2.col) ||
                            (Math.abs(pos1.col - pos2.col) === 1 && pos1.row === pos2.row);

            if (adjacent) {
              swapCells(selected, cell);
              moves++;
              forge.ui.updateText('moves', 'Moves: ' + moves);
              setTimeout(() => checkMatches(), 200);
            }
          }

          forge.material.setEmissive(selected, 0, 0, 0, 0);
          selected = null;
        }
        break;
      }
    }
  }
});`,
      enabled: true,
    },
  },
};
