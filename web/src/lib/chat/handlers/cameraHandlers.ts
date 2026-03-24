/**
 * Smart camera handlers for MCP commands.
 *
 * Provides `configure_smart_camera` — an AI-driven camera configuration tool
 * that selects an optimal camera preset based on game genre, GDD context, and
 * scene entities, then dispatches the engine commands to apply it.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';
import {
  CAMERA_PRESETS,
  PRESET_KEYS,
  detectOptimalCamera,
  cameraToCommands,
  type CameraPreset,
  type SmartCameraSceneContext,
} from '@/lib/ai/smartCamera';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_GENRES = PRESET_KEYS.join(', ');

/**
 * Build a SmartCameraSceneContext from the editor store's current state.
 */
function buildSceneContext(
  store: Parameters<ToolHandler>[1]['store'],
  projectType: '2d' | '3d',
): SmartCameraSceneContext {
  const nodes = store.sceneGraph?.nodes ?? {};
  const entityNames: string[] = [];
  const componentTypes: string[] = [];
  const gameCameraModes: string[] = [];
  const gameComponentTypes: string[] = [];

  for (const node of Object.values(nodes)) {
    if (node && typeof node === 'object') {
      const n = node as { name?: string; components?: string[] };
      if (n.name) entityNames.push(n.name);
      if (Array.isArray(n.components)) {
        for (const c of n.components) {
          if (typeof c === 'string') componentTypes.push(c);
        }
      }
    }
  }

  // Pull game camera modes from allGameCameras
  const allCameras = store.allGameCameras ?? {};
  for (const cam of Object.values(allCameras)) {
    if (cam && typeof cam === 'object') {
      const c = cam as { mode?: string };
      if (c.mode) gameCameraModes.push(c.mode);
    }
  }

  // Pull game component types from allGameComponents
  const allComponents = store.allGameComponents ?? {};
  for (const comps of Object.values(allComponents)) {
    if (Array.isArray(comps)) {
      for (const gc of comps) {
        if (gc && typeof gc === 'object') {
          const g = gc as { type?: string };
          if (g.type) gameComponentTypes.push(g.type);
        }
      }
    }
  }

  return {
    entityNames: entityNames.slice(0, 20),
    componentTypes: [...new Set(componentTypes)],
    gameCameraModes: [...new Set(gameCameraModes)],
    gameComponentTypes: [...new Set(gameComponentTypes)],
    projectType,
  };
}

/**
 * Attempt to resolve a genre string to a known preset key.
 * Normalises common user-facing names (e.g. "horror game", "fps", "platformer").
 * Returns null if no match found.
 */
function resolveGenre(raw: string): string | null {
  const lower = raw.toLowerCase().trim();

  // Exact preset key match
  if (PRESET_KEYS.includes(lower)) return lower;

  // Fuzzy aliases
  const aliases: Record<string, string> = {
    platformer: 'platformer_3d',
    '2d platformer': 'platformer_2d',
    '3d platformer': 'platformer_3d',
    fps: 'fps_shooter',
    'first person': 'fps_shooter',
    'first-person': 'fps_shooter',
    shooter: 'fps_shooter',
    rpg: 'rpg_exploration',
    exploration: 'rpg_exploration',
    'top down': 'top_down_strategy',
    'top-down': 'top_down_strategy',
    strategy: 'top_down_strategy',
    race: 'racing',
    car: 'racing',
    puzzle: 'puzzle',
    horror: 'horror',
    scary: 'horror',
    survival: 'horror',
  };

  for (const [alias, key] of Object.entries(aliases)) {
    if (lower.includes(alias)) return key;
  }

  return null;
}

/**
 * Select a CameraPreset from a genre string (exact or fuzzy), falling back to
 * heuristic detection when the genre is not recognised.
 */
function selectPreset(
  genreInput: string | undefined,
  sceneCtx: SmartCameraSceneContext,
): { preset: CameraPreset; resolvedGenre: string; usedHeuristic: boolean } {
  if (genreInput) {
    const key = resolveGenre(genreInput);
    if (key) {
      return { preset: CAMERA_PRESETS[key], resolvedGenre: key, usedHeuristic: false };
    }
  }

  // Heuristic fallback
  const preset = detectOptimalCamera(sceneCtx);
  return { preset, resolvedGenre: preset.genre, usedHeuristic: true };
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

export const cameraHandlers: Record<string, ToolHandler> = {
  /**
   * Configure a camera entity using a genre-appropriate smart preset.
   *
   * When `genre` is provided it maps to a known preset (exact key or fuzzy
   * alias). When omitted the heuristic scorer analyses the scene context to
   * pick the best match. The resulting engine commands are dispatched
   * immediately so play mode reflects the new configuration.
   */
  configure_smart_camera: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        genre: z.string().optional(),
        projectType: z.enum(['2d', '3d']).optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { entityId, genre, projectType = '3d' } = p.data;

    const sceneCtx = buildSceneContext(ctx.store, projectType);
    const { preset, resolvedGenre, usedHeuristic } = selectPreset(genre, sceneCtx);

    const commands = cameraToCommands(preset, entityId);
    for (const cmd of commands) {
      ctx.dispatchCommand(cmd.command, cmd.payload);
    }

    const detectionMethod = usedHeuristic ? 'auto-detected from scene' : `matched from "${genre}"`;
    const message = [
      `Applied "${preset.name}" camera preset (${detectionMethod}).`,
      `Mode: ${preset.mode} | FOV: ${preset.fov}° | Follow distance: ${preset.followDistance}`,
      preset.shake.enabled
        ? `Screen shake: enabled (trauma ${preset.shake.trauma}, decay ${preset.shake.decay}/s)`
        : 'Screen shake: disabled',
    ].join(' ');

    return {
      success: true,
      result: {
        preset,
        resolvedGenre,
        usedHeuristic,
        commandsDispatched: commands.map((c) => c.command),
      },
      message,
    };
  },

  /**
   * List all available smart camera presets with their genre and mode.
   * Useful for AI introspection before calling configure_smart_camera.
   */
  list_camera_presets: async (_args, _ctx) => {
    return {
      success: true,
      result: {
        presets: PRESET_KEYS.map((key) => {
          const p = CAMERA_PRESETS[key];
          return {
            key,
            name: p.name,
            genre: p.genre,
            mode: p.mode,
            fov: p.fov,
            shakeEnabled: p.shake.enabled,
          };
        }),
        validGenres: VALID_GENRES,
      },
    };
  },
};
