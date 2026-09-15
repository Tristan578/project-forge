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
      source: `// Match-3 Puzzle Game Manager
//
// KEYBOARD-DRIVEN, and deliberately so. This template used to reach for a
// mouse-and-material API the script sandbox never exposed: a material namespace,
// a transform namespace, a scene component reader, a camera screen-to-world
// helper, mouse-button and mouse-position input, and start/update lifecycle
// hooks called as members of the forge object. None of those exist in
// forgeTypes.ts, so every call threw and the match loop never advanced; the
// score readout it drew could never change (#9815). It also scheduled its match
// check with a timer global, which does not survive the sandbox either.
//
// The rewrite below uses only the real surface: a cursor moved with the default
// move actions, action_primary to select and swap, setColor to repaint a cell
// and setEmissive to highlight one, a board model kept in the script, and the
// forge game win call for the reachable objective. No mouse APIs, no component
// reads, no timers. Lifecycle is the real contract - bare top-level onStart and
// onUpdate functions the worker picks up by name.

const SIZE = 5;
const WIN_SCORE = 30;
const COLORS = [
  [1.0, 0.2, 0.2],
  [0.2, 1.0, 0.2],
  [0.2, 0.2, 1.0],
  [1.0, 1.0, 0.2],
  [1.0, 0.2, 1.0],
];

// A seeded board with NO starting match and a guaranteed one-swap match:
// swapping (2,0) with (2,1) makes column 0 rows 0-2 all colour 0, a vertical
// three, which clears three cells for 3 * 10 = WIN_SCORE. The win is therefore
// reachable from the initial layout with a single legal move.
const board = [
  [0, 1, 2, 3, 4],
  [0, 2, 3, 4, 1],
  [1, 0, 4, 2, 3],
  [2, 3, 0, 1, 4],
  [3, 4, 1, 0, 2],
];

let score = 0;
let moves = 0;
let won = false;
let cursorRow = 0;
let cursorCol = 0;
let selected = null;

function cellId(r, c) {
  return forge.scene.findByNameExact('Cell_' + r + '_' + c)[0];
}

function paintCell(r, c) {
  const id = cellId(r, c);
  if (!id) return;
  const col = COLORS[board[r][c]];
  forge.setColor(id, col[0], col[1], col[2], 1);
}

function highlight() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const id = cellId(r, c);
      if (id) forge.setEmissive(id, 0, 0, 0, 0);
    }
  }
  const cur = cellId(cursorRow, cursorCol);
  if (cur) forge.setEmissive(cur, 0.4, 0.4, 0.4, 1);
  if (selected) {
    const sel = cellId(selected.r, selected.c);
    if (sel) forge.setEmissive(sel, 0.7, 0.7, 0.2, 1);
  }
}

// Scan rows and columns for runs of three or more of the same colour, clear
// them (refill with a shifted colour so the same cell is not instantly a match
// again), score ten per cleared cell, and declare the win at WIN_SCORE. No
// cascade recursion and no timers: one synchronous pass per swap.
function checkMatches() {
  const matched = [];
  const seen = {};
  const mark = (r, c) => {
    const key = r + '_' + c;
    if (!seen[key]) { seen[key] = true; matched.push({ r: r, c: c }); }
  };

  for (let r = 0; r < SIZE; r++) {
    let start = 0;
    for (let c = 1; c <= SIZE; c++) {
      if (c < SIZE && board[r][c] === board[r][start]) continue;
      if (c - start >= 3) { for (let k = start; k < c; k++) mark(r, k); }
      start = c;
    }
  }
  for (let c = 0; c < SIZE; c++) {
    let start = 0;
    for (let r = 1; r <= SIZE; r++) {
      if (r < SIZE && board[r][c] === board[start][c]) continue;
      if (r - start >= 3) { for (let k = start; k < r; k++) mark(k, c); }
      start = r;
    }
  }

  if (matched.length === 0) return;
  for (const cell of matched) {
    board[cell.r][cell.c] = (board[cell.r][cell.c] + 2) % COLORS.length;
    paintCell(cell.r, cell.c);
  }
  score += matched.length * 10;
  forge.ui.updateText('score', 'Score: ' + score);
  forge.game.setScore(score);

  if (score >= WIN_SCORE && !won) {
    won = true;
    forge.ui.showText('win', 'YOU WIN!', 35, 45, { fontSize: 36, color: '#00ff00' });
    forge.game.win();
  }
}

function onStart() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) paintCell(r, c);
  }
  forge.game.setScore(0);
  forge.ui.showText('score', 'Score: 0', 5, 5, { fontSize: 20, color: '#ffcc00' });
  forge.ui.showText('moves', 'Moves: 0', 5, 10, { fontSize: 18, color: '#cccccc' });
  forge.ui.showText('hint', 'Arrows/WASD move cursor, J to select and swap', 5, 92, {
    fontSize: 14, color: '#aaa'
  });
  highlight();
}

function onUpdate(dt) {
  if (won) return;

  let changed = false;
  if (forge.input.justPressed('move_left') && cursorCol > 0) { cursorCol--; changed = true; }
  if (forge.input.justPressed('move_right') && cursorCol < SIZE - 1) { cursorCol++; changed = true; }
  if (forge.input.justPressed('move_up') && cursorRow > 0) { cursorRow--; changed = true; }
  if (forge.input.justPressed('move_down') && cursorRow < SIZE - 1) { cursorRow++; changed = true; }

  if (forge.input.justPressed('action_primary')) {
    if (!selected) {
      selected = { r: cursorRow, c: cursorCol };
    } else {
      const adjacent =
        Math.abs(selected.r - cursorRow) + Math.abs(selected.c - cursorCol) === 1;
      if (adjacent) {
        const tmp = board[selected.r][selected.c];
        board[selected.r][selected.c] = board[cursorRow][cursorCol];
        board[cursorRow][cursorCol] = tmp;
        paintCell(selected.r, selected.c);
        paintCell(cursorRow, cursorCol);
        moves++;
        forge.ui.updateText('moves', 'Moves: ' + moves);
        selected = null;
        checkMatches();
      } else {
        // Not adjacent: move the selection to the new cursor cell instead.
        selected = { r: cursorRow, c: cursorCol };
      }
    }
    changed = true;
  }

  if (changed) highlight();
}`,
      enabled: true,
    },
  },
};
