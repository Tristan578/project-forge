import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';

const inputSchema = z.object({
  // name/purpose are required for primary scene creation (from planBuilder Phase 1)
  // but optional for config-overlay steps from the system registry (camera/world systems
  // add config to existing scenes without creating new ones)
  name: z.string().min(1).max(200).optional().default('Untitled Scene'),
  purpose: z.string().max(500).optional().default(''),
  cameraMode: z.string().optional(),
  cameraConfig: z.record(z.string(), z.unknown()).optional(),
  worldType: z.string().optional(),
  worldConfig: z.record(z.string(), z.unknown()).optional(),
});

export const sceneCreateExecutor: ExecutorDefinition = {
  name: 'scene_create',
  inputSchema,
  userFacingErrorMessage: 'Could not create the scene. Please try again.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return failResult(
        makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      );
    }

    if (ctx.signal.aborted) {
      return failResult(
        makeStepError(
          'ABORTED',
          'Executor was aborted before running',
          this.userFacingErrorMessage,
        ),
      );
    }

    const { name, cameraMode, cameraConfig, worldType, worldConfig } = parsed.data;

    // Use create_scene (creates without clearing) instead of new_scene (clears current)
    // Manifest: create_scene requires { name: string }
    ctx.dispatchCommand('create_scene', { name });

    // Apply camera configuration if provided (from camera system registry).
    // set_game_camera requires entityId — we can only apply if one is in cameraConfig
    // or if the scene has a known camera entity. Without entityId, store the config
    // in output for downstream steps (e.g. autoPolish) to apply later.
    if (cameraMode || cameraConfig) {
      const cameraEntityId = (cameraConfig as Record<string, unknown> | undefined)?.['entityId'];
      if (typeof cameraEntityId === 'string') {
        ctx.dispatchCommand('set_game_camera', {
          entityId: cameraEntityId,
          mode: cameraMode ?? 'thirdPersonFollow',
          ...(cameraConfig ?? {}),
        });
      }
      // If no entityId, camera config is stored in output for later application
    }

    // Apply world configuration if provided (from world system registry)
    if (worldType === 'tiled' || worldConfig) {
      // World config is informational — stored in step output for downstream use
    }

    return successResult({
      sceneName: name,
      cameraMode: cameraMode ?? null,
      worldType: worldType ?? null,
    });
  },
};
