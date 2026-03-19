/**
 * Smart Camera System — AI-driven camera presets for different game genres.
 *
 * Analyzes scene entities (game components, camera modes, physics, etc.) to
 * recommend an optimal camera configuration, then converts that config into
 * engine commands that can be dispatched to the Bevy ECS.
 */

import type { GameCameraMode } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Camera modes supported by the smart camera system. */
export type SmartCameraMode =
  | 'follow'
  | 'fixed'
  | 'orbit'
  | 'side_scroll'
  | 'top_down'
  | 'first_person';

/** Dead-zone configuration for camera follow. */
export interface DeadZone {
  x: number;
  y: number;
}

/** Camera bounds (optional). */
export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Screen shake settings. */
export interface ShakeConfig {
  enabled: boolean;
  trauma: number;
  decay: number;
}

/** A full camera preset with all tuning knobs. */
export interface CameraPreset {
  name: string;
  genre: string;
  mode: SmartCameraMode;
  followDistance: number;
  followHeight: number;
  followSmoothing: number;
  fov: number;
  lookAhead: number;
  deadZone: DeadZone;
  bounds?: CameraBounds;
  shake: ShakeConfig;
}

/** Minimal scene context used for auto-detection. */
export interface SmartCameraSceneContext {
  entityNames: string[];
  componentTypes: string[];
  gameCameraModes: string[];
  gameComponentTypes: string[];
  projectType: '2d' | '3d';
}

/** Engine command produced by the conversion step. */
export interface EngineCommand {
  command: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  platformer_2d: {
    name: 'Platformer 2D',
    genre: 'platformer_2d',
    mode: 'side_scroll',
    followDistance: 10,
    followHeight: 2,
    followSmoothing: 4,
    fov: 60,
    lookAhead: 2.5,
    deadZone: { x: 0.1, y: 0.25 },
    shake: { enabled: true, trauma: 0.3, decay: 3.0 },
  },
  platformer_3d: {
    name: 'Platformer 3D',
    genre: 'platformer_3d',
    mode: 'follow',
    followDistance: 8,
    followHeight: 4,
    followSmoothing: 5,
    fov: 65,
    lookAhead: 1.5,
    deadZone: { x: 0.15, y: 0.15 },
    shake: { enabled: true, trauma: 0.2, decay: 4.0 },
  },
  fps_shooter: {
    name: 'FPS Shooter',
    genre: 'fps_shooter',
    mode: 'first_person',
    followDistance: 0,
    followHeight: 1.7,
    followSmoothing: 10,
    fov: 70,
    lookAhead: 0,
    deadZone: { x: 0, y: 0 },
    shake: { enabled: true, trauma: 0.15, decay: 5.0 },
  },
  rpg_exploration: {
    name: 'RPG Exploration',
    genre: 'rpg_exploration',
    mode: 'orbit',
    followDistance: 12,
    followHeight: 5,
    followSmoothing: 3,
    fov: 75,
    lookAhead: 1.0,
    deadZone: { x: 0.2, y: 0.2 },
    shake: { enabled: false, trauma: 0, decay: 0 },
  },
  top_down_strategy: {
    name: 'Top-Down Strategy',
    genre: 'top_down_strategy',
    mode: 'top_down',
    followDistance: 0,
    followHeight: 20,
    followSmoothing: 2,
    fov: 50,
    lookAhead: 0,
    deadZone: { x: 0, y: 0 },
    bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50 },
    shake: { enabled: false, trauma: 0, decay: 0 },
  },
  racing: {
    name: 'Racing',
    genre: 'racing',
    mode: 'follow',
    followDistance: 6,
    followHeight: 2.5,
    followSmoothing: 7,
    fov: 80,
    lookAhead: 3.0,
    deadZone: { x: 0.05, y: 0.05 },
    shake: { enabled: true, trauma: 0.1, decay: 6.0 },
  },
  puzzle: {
    name: 'Puzzle',
    genre: 'puzzle',
    mode: 'fixed',
    followDistance: 15,
    followHeight: 10,
    followSmoothing: 1,
    fov: 55,
    lookAhead: 0,
    deadZone: { x: 0, y: 0 },
    shake: { enabled: false, trauma: 0, decay: 0 },
  },
  horror: {
    name: 'Horror',
    genre: 'horror',
    mode: 'follow',
    followDistance: 3,
    followHeight: 1.8,
    followSmoothing: 2,
    fov: 55,
    lookAhead: 0.5,
    deadZone: { x: 0.3, y: 0.3 },
    shake: { enabled: true, trauma: 0.4, decay: 2.0 },
  },
};

/** All preset keys for iteration. */
export const PRESET_KEYS = Object.keys(CAMERA_PRESETS);

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Maps a SmartCameraMode to the engine GameCameraMode. */
export function smartModeToEngine(mode: SmartCameraMode): GameCameraMode {
  switch (mode) {
    case 'follow':
      return 'thirdPersonFollow';
    case 'first_person':
      return 'firstPerson';
    case 'side_scroll':
      return 'sideScroller';
    case 'top_down':
      return 'topDown';
    case 'fixed':
      return 'fixed';
    case 'orbit':
      return 'orbital';
  }
}

/**
 * Score each preset against the scene context and return the best match.
 * Falls back to `platformer_3d` (a safe default) when nothing matches strongly.
 */
export function detectOptimalCamera(ctx: SmartCameraSceneContext): CameraPreset {
  const scores: Record<string, number> = {};
  for (const key of PRESET_KEYS) {
    scores[key] = 0;
  }

  const lowerNames = ctx.entityNames.map((n) => n.toLowerCase());
  const compSet = new Set(ctx.componentTypes);
  const gcSet = new Set(ctx.gameComponentTypes);

  // --- Project type ---
  if (ctx.projectType === '2d') {
    scores['platformer_2d'] += 4;
  } else {
    scores['platformer_3d'] += 1;
    scores['fps_shooter'] += 1;
    scores['rpg_exploration'] += 1;
  }

  // --- Game component heuristics ---
  if (gcSet.has('characterController')) {
    scores['platformer_3d'] += 3;
    scores['platformer_2d'] += 2;
    scores['rpg_exploration'] += 2;
  }
  if (gcSet.has('projectile')) {
    scores['fps_shooter'] += 3;
  }
  if (gcSet.has('health')) {
    scores['fps_shooter'] += 1;
    scores['rpg_exploration'] += 1;
    scores['horror'] += 1;
  }
  if (gcSet.has('collectible')) {
    scores['platformer_3d'] += 2;
    scores['platformer_2d'] += 2;
  }
  if (gcSet.has('movingPlatform')) {
    scores['platformer_3d'] += 3;
    scores['platformer_2d'] += 3;
  }
  if (gcSet.has('checkpoint')) {
    scores['platformer_3d'] += 2;
    scores['platformer_2d'] += 2;
    scores['racing'] += 2;
  }
  if (gcSet.has('spawner')) {
    scores['fps_shooter'] += 2;
    scores['top_down_strategy'] += 2;
  }
  if (gcSet.has('follower')) {
    scores['rpg_exploration'] += 2;
    scores['horror'] += 2;
  }
  if (gcSet.has('winCondition')) {
    scores['puzzle'] += 2;
  }
  if (gcSet.has('dialogueTrigger')) {
    scores['rpg_exploration'] += 3;
  }

  // --- Existing camera modes ---
  for (const mode of ctx.gameCameraModes) {
    if (mode === 'firstPerson') scores['fps_shooter'] += 4;
    if (mode === 'sideScroller') scores['platformer_2d'] += 4;
    if (mode === 'thirdPersonFollow') {
      scores['platformer_3d'] += 2;
      scores['rpg_exploration'] += 2;
      scores['horror'] += 1;
    }
    if (mode === 'topDown') scores['top_down_strategy'] += 4;
    if (mode === 'orbital') {
      scores['rpg_exploration'] += 2;
      scores['puzzle'] += 2;
    }
  }

  // --- Component-level signals ---
  if (compSet.has('Terrain') || compSet.has('TerrainEnabled')) {
    scores['rpg_exploration'] += 2;
    scores['top_down_strategy'] += 1;
  }
  if (compSet.has('Vehicle') || lowerNames.some((n) => n.includes('car') || n.includes('vehicle'))) {
    scores['racing'] += 4;
  }

  // --- Name-based heuristics ---
  if (lowerNames.some((n) => n.includes('zombie') || n.includes('ghost') || n.includes('dark'))) {
    scores['horror'] += 3;
  }
  if (lowerNames.some((n) => n.includes('gun') || n.includes('weapon') || n.includes('bullet'))) {
    scores['fps_shooter'] += 3;
  }
  if (lowerNames.some((n) => n.includes('coin') || n.includes('gem') || n.includes('ring'))) {
    scores['platformer_3d'] += 2;
    scores['platformer_2d'] += 2;
  }
  if (lowerNames.some((n) => n.includes('puzzle') || n.includes('block') || n.includes('switch'))) {
    scores['puzzle'] += 3;
  }
  if (lowerNames.some((n) => n.includes('army') || n.includes('unit') || n.includes('tower'))) {
    scores['top_down_strategy'] += 3;
  }

  // Pick highest scoring preset
  let bestKey = ctx.projectType === '2d' ? 'platformer_2d' : 'platformer_3d';
  let bestScore = scores[bestKey];
  for (const key of PRESET_KEYS) {
    if (scores[key] > bestScore) {
      bestScore = scores[key];
      bestKey = key;
    }
  }

  return CAMERA_PRESETS[bestKey];
}

// ---------------------------------------------------------------------------
// Command generation
// ---------------------------------------------------------------------------

/**
 * Convert a camera preset into engine commands that can be dispatched
 * via the WASM bridge's `handle_command`.
 */
export function cameraToCommands(preset: CameraPreset, entityId: string): EngineCommand[] {
  const engineMode = smartModeToEngine(preset.mode);
  const commands: EngineCommand[] = [];

  // Build the GameCameraData payload based on mode
  const gameCameraPayload: Record<string, unknown> = {
    entityId,
    mode: engineMode,
    targetEntity: null,
  };

  switch (engineMode) {
    case 'thirdPersonFollow':
      gameCameraPayload['followDistance'] = preset.followDistance;
      gameCameraPayload['followHeight'] = preset.followHeight;
      gameCameraPayload['followLookAhead'] = preset.lookAhead;
      gameCameraPayload['followSmoothing'] = preset.followSmoothing;
      break;
    case 'firstPerson':
      gameCameraPayload['firstPersonHeight'] = preset.followHeight;
      gameCameraPayload['firstPersonMouseSensitivity'] = 2;
      break;
    case 'sideScroller':
      gameCameraPayload['sideScrollerDistance'] = preset.followDistance;
      gameCameraPayload['sideScrollerHeight'] = preset.followHeight;
      break;
    case 'topDown':
      gameCameraPayload['topDownHeight'] = preset.followHeight;
      gameCameraPayload['topDownAngle'] = 60;
      break;
    case 'orbital':
      gameCameraPayload['orbitalDistance'] = preset.followDistance;
      gameCameraPayload['orbitalAutoRotateSpeed'] = 0;
      break;
    case 'fixed':
      // No extra params needed for fixed
      break;
  }

  commands.push({ command: 'set_game_camera', payload: gameCameraPayload });
  commands.push({ command: 'set_active_game_camera', payload: { entityId } });

  return commands;
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/** Linearly interpolate between two camera presets by factor t (0..1). */
export function interpolatePresets(a: CameraPreset, b: CameraPreset, t: number): CameraPreset {
  const clampedT = Math.max(0, Math.min(1, t));
  const lerp = (x: number, y: number): number => x + (y - x) * clampedT;

  return {
    // Use b's identity when t >= 0.5, otherwise a's
    name: clampedT >= 0.5 ? b.name : a.name,
    genre: clampedT >= 0.5 ? b.genre : a.genre,
    mode: clampedT >= 0.5 ? b.mode : a.mode,
    followDistance: lerp(a.followDistance, b.followDistance),
    followHeight: lerp(a.followHeight, b.followHeight),
    followSmoothing: lerp(a.followSmoothing, b.followSmoothing),
    fov: lerp(a.fov, b.fov),
    lookAhead: lerp(a.lookAhead, b.lookAhead),
    deadZone: {
      x: lerp(a.deadZone.x, b.deadZone.x),
      y: lerp(a.deadZone.y, b.deadZone.y),
    },
    bounds:
      a.bounds && b.bounds
        ? {
            minX: lerp(a.bounds.minX, b.bounds.minX),
            maxX: lerp(a.bounds.maxX, b.bounds.maxX),
            minY: lerp(a.bounds.minY, b.bounds.minY),
            maxY: lerp(a.bounds.maxY, b.bounds.maxY),
          }
        : a.bounds ?? b.bounds,
    shake: {
      enabled: clampedT >= 0.5 ? b.shake.enabled : a.shake.enabled,
      trauma: lerp(a.shake.trauma, b.shake.trauma),
      decay: lerp(a.shake.decay, b.shake.decay),
    },
  };
}
