import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';

// Valid camera modes per engine manifest (set_game_camera.mode enum)
const VALID_CAMERA_MODES = [
  'thirdPersonFollow', 'firstPerson', 'sideScroller',
  'topDown', 'fixed', 'orbital',
] as const;
type CameraMode = typeof VALID_CAMERA_MODES[number];

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

    // Determine if this is a primary scene creation or a config overlay.
    // Config overlays come from camera/world system registry steps — they have
    // cameraMode/worldType but no explicit name (defaults to 'Untitled Scene').
    // Only create a new scene for primary creation steps.
    const isConfigOverlay = (cameraMode || cameraConfig || worldType || worldConfig)
      && name === 'Untitled Scene';

    if (!isConfigOverlay) {
      // Primary scene creation — manifest: create_scene requires { name: string }
      ctx.dispatchCommand('create_scene', { name });
    }

    // Apply camera configuration if provided (from camera system registry).
    // set_game_camera requires entityId + valid mode enum.
    if (cameraMode || cameraConfig) {
      const cameraEntityId = (cameraConfig as Record<string, unknown> | undefined)?.['entityId'];

      // Normalize hyphenated camera modes from LLM output to camelCase engine enum.
      // e.g. "side-scroller" → "sideScroller", "third-person" → "thirdPersonFollow"
      const CAMERA_MODE_ALIASES: Record<string, CameraMode> = {
        'side-scroller': 'sideScroller',
        'side_scroller': 'sideScroller',
        'third-person': 'thirdPersonFollow',
        'third_person': 'thirdPersonFollow',
        'first-person': 'firstPerson',
        'first_person': 'firstPerson',
        'top-down': 'topDown',
        'top_down': 'topDown',
      };
      const normalized = typeof cameraMode === 'string'
        ? CAMERA_MODE_ALIASES[cameraMode.toLowerCase()] ?? cameraMode
        : cameraMode;
      const validMode: CameraMode = VALID_CAMERA_MODES.includes(normalized as CameraMode)
        ? (normalized as CameraMode)
        : 'thirdPersonFollow';

      if (typeof cameraEntityId === 'string') {
        // Destructure cameraConfig to extract only safe numeric params.
        // LLM-sourced cameraConfig could include entityId/mode — never let
        // those overwrite the validated values above.
        const { entityId: _drop, mode: _dropMode, ...safeConfig } = (cameraConfig ?? {}) as Record<string, unknown>;
        ctx.dispatchCommand('set_game_camera', {
          entityId: cameraEntityId,
          mode: validMode,
          ...safeConfig,
        });
      }
      // If no entityId, camera config stored in output for downstream steps
    }

    // Apply world configuration if provided (from world system registry)
    if (worldType === 'tiled' || worldConfig) {
      // World config is informational — stored in step output for downstream use
    }

    // Store pending camera config in output so downstream steps (auto_polish)
    // can apply it once a camera entity exists. Without this, camera preferences
    // from the GDD are silently lost when no entityId is available at scene creation.
    const hasCameraEntityId = typeof (cameraConfig as Record<string, unknown> | undefined)?.['entityId'] === 'string';
    const pendingCamera = (cameraMode && !hasCameraEntityId)
      ? { mode: VALID_CAMERA_MODES.includes(cameraMode as CameraMode) ? cameraMode : 'thirdPersonFollow', config: cameraConfig }
      : null;

    return successResult({
      sceneName: name,
      cameraMode: cameraMode ?? null,
      pendingCameraConfig: pendingCamera,
      worldType: worldType ?? null,
    });
  },
};
