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

/**
 * Largest magnitude a model-supplied number may carry into the engine.
 *
 * Every one of these values is cast to `f32` on the Rust side while JSON
 * carries f64, so a *finite* value past `f32::MAX` (~3.4e38) arrives as `inf`
 * and poisons whatever it touches. `.finite()` alone does not catch that band:
 * `1e308` is finite in JS and is `inf` in f32.
 */
export const F32_SAFE_MAX = 1e30;

/**
 * A single vector component: finite, and inside the f32 range.
 *
 * Clamped rather than rejected so one absurd component does not discard the
 * whole vector — the engine's own `prop_vec3` treats a vector as all-or-nothing,
 * and dropping a position leaves an entity wherever it happened to spawn.
 */
const zF32 = z.number().finite().transform((v) => Math.min(F32_SAFE_MAX, Math.max(-F32_SAFE_MAX, v)));

/** 3-component numeric vector as array (color RGB, etc.). */
export const zVec3 = z.tuple([zF32, zF32, zF32]);

/** 3-component numeric vector as { x, y, z } object (transform position/rotation/scale). */
export const zXYZ = z.object({ x: zF32, y: zF32, z: zF32 });

/** 4-component numeric vector (color RGBA). */
export const zVec4 = z.tuple([zF32, zF32, zF32, zF32]);

/** 2-component numeric vector (UV offset/scale, 2D position). */
export const zVec2 = z.tuple([zF32, zF32]);

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

/**
 * Read a keyed entry out of a store `Record` without walking the prototype chain.
 *
 * Handler entity ids come from the model through `zEntityId`, which is
 * `z.string().min(1)` and therefore accepts `'__proto__'`, `'constructor'` and
 * `'toString'`. A bare `record[id]` then resolves to an inherited value —
 * `Object.prototype` or a function — which is TRUTHY, so both of the guards
 * handlers rely on fail open: `record[id] ?? defaults()` never reaches the
 * fallback, and `if (!data) return error` never reports the entity as missing.
 * The first produces a full-replace command built from almost no real fields; the
 * second returns `Object.prototype` to the model as if it were entity data
 * (PF-1167).
 *
 * Tightening `zEntityId` would not be sufficient on its own — every handler that
 * indexes a `Record` by a model-supplied key has this shape, so the read is the
 * right place to fix it.
 */
export function ownEntry<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
