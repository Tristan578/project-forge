/**
 * Tool call executor — legacy shell.
 *
 * All 8 compound action handlers have been migrated to
 * web/src/lib/chat/handlers/compoundHandlers.ts and registered in executor.ts.
 *
 * This file is kept as a fallback stub so that executor.ts can still call
 * legacyExecuteToolCall() for any tool name that is not found in the registry.
 * It will always return an "Unknown tool" error, which is the correct behaviour
 * for truly unrecognised commands.
 */

import type { EditorState } from '@/stores/editorStore';

interface ExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Legacy fallback — returns an Unknown tool error for any tool name.
 * All real handlers are now in the registry in executor.ts.
 */
export async function executeToolCall(
  toolName: string,
  _input: Record<string, unknown>,
  _store: EditorState
): Promise<ExecutionResult> {
  return { success: false, error: `Unknown tool: ${toolName}` };
}

// Re-export material preset helpers retained here for backward compatibility
export { getPresetsByCategory, saveCustomMaterial, deleteCustomMaterial, loadCustomMaterials, MATERIAL_PRESETS } from '@/lib/materialPresets';
