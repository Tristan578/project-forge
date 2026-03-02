/**
 * Shared types and Zod schemas for tool call handlers.
 */

import { z } from 'zod';
import type { EditorState } from '@/stores/editorStore';

export interface ToolCallContext {
  store: EditorState;
  dispatchCommand: (command: string, payload: unknown) => void;
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
