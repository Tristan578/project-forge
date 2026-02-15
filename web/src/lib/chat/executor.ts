/**
 * Tool call executor — maps Claude tool calls to editorStore commands.
 * Refactored to use handler registry pattern for maintainability.
 */

import type { EditorState } from '@/stores/editorStore';
import type { ToolCallContext, ExecutionResult } from './handlers/types';

// Import all handler registries
import { transformHandlers } from './handlers/transformHandlers';
import { materialHandlers } from './handlers/materialHandlers';
import { queryHandlers } from './handlers/queryHandlers';
import { editModeHandlers } from './handlers/editModeHandlers';
import { audioHandlers } from './handlers/audioHandlers';
import { multiplayerHandlers } from './handlers/multiplayerHandlers';
import { collaborationHandlers } from './handlers/collaborationHandlers';
import { securityHandlers } from './handlers/securityHandlers';
import { exportHandlers } from './handlers/exportHandlers';
import { shaderHandlers } from './handlers/shaderHandlers';
import { performanceHandlers } from './handlers/performanceHandlers';

// Import the legacy executor temporarily
import { executeToolCall as legacyExecuteToolCall } from './executor.legacy';

/**
 * Merged handler registry.
 * TODO: Complete the migration by creating remaining handler files.
 */
const handlerRegistry: Record<string, (args: Record<string, unknown>, ctx: ToolCallContext) => Promise<ExecutionResult>> = {
  ...transformHandlers,
  ...materialHandlers,
  ...queryHandlers,
  ...editModeHandlers,
  ...audioHandlers,
  ...multiplayerHandlers,
  ...collaborationHandlers,
  ...securityHandlers,
  ...exportHandlers,
  ...shaderHandlers,
  ...performanceHandlers,
};

/**
 * Execute a tool call against the editor store.
 * Returns the result to feed back to Claude if needed.
 */
export async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  store: EditorState
): Promise<ExecutionResult> {
  try {
    const ctx: ToolCallContext = { store };
    const handler = handlerRegistry[toolName];

    if (handler) {
      return await handler(input, ctx);
    }

    // Fallback to legacy executor for handlers not yet migrated
    return await legacyExecuteToolCall(toolName, input, store);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' };
  }
}
