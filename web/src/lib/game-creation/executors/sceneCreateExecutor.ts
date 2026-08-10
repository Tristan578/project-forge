import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { createScene, loadProjectScenes, saveProjectScenes } from '@/lib/scenes/sceneManager';
import { buildSetGameCameraPayload, TRANSLATED_CAMERA_FIELDS } from '@/lib/game/gameCameraPayload';
// Type-only: erased at compile time, so this adds no module edge into `@/stores`
// (see `__tests__/serverSafeImports.test.ts` — this file is reachable from an
// API route and a value-import of the store would break the RSC build).
import type { GameCameraData } from '@/stores/slices/types';

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
      // Primary scene creation. `create_scene` is an engine stub that rejects by
      // design — scenes live JS-side in `lib/scenes/sceneManager` — and because
      // single dispatch returns void, the rejection was unobservable and this step
      // was a silent no-op that still reported success (PF-1097).
      const project = loadProjectScenes();
      const { project: withScene, sceneId } = createScene(project, name);
      saveProjectScenes({ ...withScene, activeSceneId: sceneId });
      ctx.getStore().setScenes(
        withScene.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
        sceneId,
      );
      // Clear the starter scene (Ground/Player/Sun from the engine's Startup
      // `setup_scene`) so the generated game is not stacked on top of it.
      // `new_scene` despawns deletable entities and resets editor state; it does
      // not re-run `setup_scene`.
      ctx.dispatchCommand('new_scene', {});
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
        // Allowlist known safe numeric camera params from LLM config.
        // Rejects arbitrary keys, __proto__, Infinity, NaN.
        //
        // Derived from the translator's own field list rather than re-typed, so
        // a parameter cannot be accepted here without an engine mapping. The
        // hand-written list this replaces carried two names no engine variant
        // has — `sideScrollerHeight` (SideScroller is z_offset/follow_y/y_bounds/
        // damping) and `topDownAngle` (TopDown is height/damping/follow_rotation).
        const cameraData: GameCameraData = { mode: validMode, targetEntity: null };
        const rawConfig = (cameraConfig ?? {}) as Record<string, unknown>;
        for (const key of TRANSLATED_CAMERA_FIELDS) {
          if (key === 'mode' || key === 'targetEntity') continue;
          // Own keys only. `cameraConfig` is GDD-derived, so the model controls
          // its keys. Zod's `z.record()` parse already rebuilds it as a plain
          // object, which strips any inherited property — this is the local,
          // independently-true version of that guarantee, so the read stays
          // correct if the schema is ever loosened to `z.custom`/passthrough.
          if (!Object.hasOwn(rawConfig, key)) continue;
          const val = rawConfig[key];
          if (typeof val === 'number' && Number.isFinite(val)) {
            cameraData[key] = val;
          }
        }
        // Translated, never spread: these params are the store's AUTHORING
        // vocabulary and share no name with the engine's wire form, so
        // dispatching them flat sent the engine nothing it could read (PF-1126).
        ctx.dispatchCommand('set_game_camera', buildSetGameCameraPayload(cameraEntityId, cameraData));
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
    // Use the normalized+validated mode computed in the camera block above,
    // or normalize here if we didn't enter that block.
    const hasCameraEntityId = typeof (cameraConfig as Record<string, unknown> | undefined)?.['entityId'] === 'string';
    const CAMERA_ALIASES: Record<string, string> = {
      'side-scroller': 'sideScroller', 'side_scroller': 'sideScroller',
      'third-person': 'thirdPersonFollow', 'third_person': 'thirdPersonFollow',
      'first-person': 'firstPerson', 'first_person': 'firstPerson',
      'top-down': 'topDown', 'top_down': 'topDown',
    };
    const resolvedMode = typeof cameraMode === 'string'
      ? (CAMERA_ALIASES[cameraMode.toLowerCase()] ?? cameraMode)
      : cameraMode;
    const safeMode = VALID_CAMERA_MODES.includes(resolvedMode as CameraMode)
      ? resolvedMode : 'thirdPersonFollow';
    // Filter pendingCamera config through the same allowlist as the dispatch path.
    // Downstream steps receive sanitized data, not raw LLM objects.
    let pendingFilteredConfig: Record<string, number> | undefined;
    if (cameraMode && !hasCameraEntityId && cameraConfig) {
      // Same derived allowlist as the dispatch path above, so the two cannot
      // drift. The hand-written list this replaces carried `topDownAngle`, which
      // no engine camera variant has, and omitted `firstPersonMouseSensitivity`,
      // which one does.
      pendingFilteredConfig = {};
      const raw = cameraConfig as Record<string, unknown>;
      for (const key of TRANSLATED_CAMERA_FIELDS) {
        if (key === 'mode' || key === 'targetEntity') continue;
        const val = raw[key];
        if (typeof val === 'number' && Number.isFinite(val)) {
          pendingFilteredConfig[key] = val;
        }
      }
    }
    const pendingCamera = (cameraMode && !hasCameraEntityId)
      ? { mode: safeMode, config: pendingFilteredConfig ?? {} }
      : null;

    return successResult({
      sceneName: name,
      cameraMode: cameraMode ?? null,
      pendingCameraConfig: pendingCamera,
      worldType: worldType ?? null,
    });
  },
};
