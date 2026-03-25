/**
 * Tool call executor — maps Claude tool calls to editorStore commands.
 * Uses a handler registry pattern; unknown tool names return an error directly.
 */

import type { EditorState } from '@/stores/editorStore';
import { getCommandDispatcher } from '@/stores/editorStore';
import type { ToolCallContext, ExecutionResult } from './handlers/types';

// Import all handler registries
import { transformHandlers } from './handlers/transformHandlers';
import { materialHandlers } from './handlers/materialHandlers';
import { queryHandlers } from './handlers/queryHandlers';
import { editModeHandlers } from './handlers/editModeHandlers';
import { audioHandlers } from './handlers/audioHandlers';
import { securityHandlers } from './handlers/securityHandlers';
import { exportHandlers } from './handlers/exportHandlers';
import { shaderHandlers } from './handlers/shaderHandlers';
import { performanceHandlers } from './handlers/performanceHandlers';
import { generationHandlers } from './handlers/generationHandlers';
import { handlers2d } from './handlers/handlers2d';
import { entityHandlers } from './handlers/entityHandlers';
import { sceneManagementHandlers } from './handlers/sceneManagementHandlers';
import { uiBuilderHandlers } from './handlers/uiBuilderHandlers';
import { dialogueHandlers } from './handlers/dialogueHandlers';
import { scriptLibraryHandlers } from './handlers/scriptLibraryHandlers';
import { physicsJointHandlers } from './handlers/physicsJointHandlers';
import { animationParticleHandlers } from './handlers/animationParticleHandlers';
import { gameplayHandlers } from './handlers/gameplayHandlers';
import { assetHandlers } from './handlers/assetHandlers';
import { audioEntityHandlers } from './handlers/audioEntityHandlers';
import { pixelArtHandlers } from './handlers/pixelArtHandlers';
import { compoundHandlers } from './handlers/compoundHandlers';
import { leaderboardHandlers } from './handlers/leaderboardHandlers';
import { ideaHandlers } from './handlers/ideaHandlers';
import { worldHandlers } from './handlers/worldHandlers';
import { localizationHandlers } from './handlers/localizationHandlers';
import { economyHandlers } from './handlers/economyHandlers';
import { cutsceneHandlers } from './handlers/cutsceneHandlers';
import { questHandlers } from './handlers/questHandlers';

/**
 * Merged handler registry.
 */
const handlerRegistry: Record<string, (args: Record<string, unknown>, ctx: ToolCallContext) => Promise<ExecutionResult>> = {
  ...transformHandlers,
  ...materialHandlers,
  ...queryHandlers,
  ...editModeHandlers,
  ...audioHandlers,
  ...securityHandlers,
  ...exportHandlers,
  ...shaderHandlers,
  ...performanceHandlers,
  ...generationHandlers,
  ...handlers2d,
  ...entityHandlers,
  ...sceneManagementHandlers,
  ...uiBuilderHandlers,
  ...dialogueHandlers,
  ...scriptLibraryHandlers,
  ...physicsJointHandlers,
  ...animationParticleHandlers,
  ...gameplayHandlers,
  ...assetHandlers,
  ...audioEntityHandlers,
  ...pixelArtHandlers,
  ...compoundHandlers,
  ...leaderboardHandlers,
  ...ideaHandlers,
  ...worldHandlers,
  ...localizationHandlers,
  ...economyHandlers,
  ...cutsceneHandlers,
  ...questHandlers,
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
    const dispatch = getCommandDispatcher();
    const ctx: ToolCallContext = {
      store,
      dispatchCommand: dispatch ?? ((_cmd: string, _payload: unknown) => {
        console.warn('Command dispatcher not initialized');
      }),
    };
    const handler = handlerRegistry[toolName];

    if (handler) {
      return await handler(input, ctx);
    }

    return { success: false, error: `Unknown tool: ${toolName}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' };
  }
}
