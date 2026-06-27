/**
 * Shared types and Zod schemas for tool call handlers.
 */

import { z } from 'zod';
import type { EditorState } from '@/stores/editorStore';

export interface ToolCallContext {
  store: EditorState;
  dispatchCommand: (command: string, payload: unknown) => void;
  dispatchCommandBatch?: (commands: Array<{ command: string; payload?: unknown }>) => import('@/hooks/useEngine').BatchResult;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolCallContext
) => Promise<ExecutionResult>;

export interface ExecutionResult {
  success: boolean;
  result?: unknown;
  message?: string;
  error?: string;
}

// Re-export common types that handlers need
export type { EditorState, MaterialData, LightData, PhysicsData, EntityType, InputBinding, ParticlePreset, SceneNode, GameCameraData } from '@/stores/editorStore';

// ===== Shared Zod Schemas =====

/** Non-empty entity ID string. */
export const zEntityId = z.string().min(1);

/** 3-component numeric vector as array (color RGB, etc.). */
export const zVec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

/** 3-component numeric vector as { x, y, z } object (transform position/rotation/scale). */
export const zXYZ = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });

/** 4-component numeric vector (color RGBA). */
export const zVec4 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);

/** 2-component numeric vector (UV offset/scale, 2D position). */
export const zVec2 = z.tuple([z.number().finite(), z.number().finite()]);

/** Selection mode enum. */
export const zSelectionMode = z.enum(['replace', 'add', 'toggle']);

/** Gizmo mode enum. */
export const zGizmoMode = z.enum(['translate', 'rotate', 'scale']);

/** Camera preset enum. */
export const zCameraPreset = z.enum(['top', 'front', 'right', 'perspective']);

/**
 * Args for the `setup_game_from_description` compound tool. A plain-text
 * description deterministically scaffolds a playable game (player + enemies +
 * coins + goal + ground + lighting + input + win condition). `genre` is an
 * optional hint; `targetTier` opts into parallel `generate_*` asset jobs that
 * auto-wire back onto the scaffolded entities (#8540).
 */
export const zSetupGameFromDescription = z.object({
  description: z.string().min(1),
  genre: z.string().optional(),
  targetTier: z.enum(['low', 'mid', 'high']).optional(),
});

/**
 * Validate handler args with a Zod schema. Returns parsed data or an error result.
 */
export function parseArgs<T>(
  schema: z.ZodType<T>,
  args: Record<string, unknown>,
): { data: T; error?: undefined } | { data?: undefined; error: ExecutionResult } {
  const result = schema.safeParse(args);
  if (result.success) {
    return { data: result.data };
  }
  const issues = result.error.issues.map(
    (i) => `${i.path.join('.')}: ${i.message}`
  ).join('; ');
  return { error: { success: false, error: `Invalid arguments: ${issues}` } };
}
