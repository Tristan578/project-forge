/**
 * Shared types for tool call handlers.
 */

import type { EditorState } from '@/stores/editorStore';

export interface ToolCallContext {
  store: EditorState;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolCallContext
) => Promise<ExecutionResult>;

export interface ExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

// Re-export common types that handlers need
export type { EditorState, MaterialData, LightData, PhysicsData, EntityType, InputBinding, ParticlePreset, SceneNode, GameCameraData } from '@/stores/editorStore';
