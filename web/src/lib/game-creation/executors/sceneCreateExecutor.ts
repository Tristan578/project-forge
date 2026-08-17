import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { createScene, loadProjectScenes, saveProjectScenes } from '@/lib/scenes/sceneManager';

/**
 * Camera configuration used to live here and no longer does — it moved to the
 * `camera_setup` executor in PF-1125.
 *
 * It could never work from this step. Scene creation runs before any entity is
 * spawned, so there is no camera entity to configure, and the branch was gated on
 * a `cameraConfig.entityId` the GDD has no way to supply. The directive was
 * normalized, filtered, and returned as `pendingCameraConfig` for a downstream
 * consumer that was never written.
 *
 * `cameraMode`/`cameraConfig` are gone from the schema below rather than left as
 * ignored fields, deliberately: `z.object` strips unknown keys silently, so an
 * accepted-but-unused field is the exact shape of the silent-drop defect this
 * campaign exists to close. Removing them makes a mis-pointed camera step a
 * visible no-op in the step input instead of a value that vanishes mid-pipeline.
 */
const inputSchema = z.object({
  // name/purpose are required for primary scene creation (from planBuilder Phase 1)
  // but optional for config-overlay steps from the system registry (the world
  // system adds config to existing scenes without creating new ones)
  name: z.string().min(1).max(200).optional().default('Untitled Scene'),
  purpose: z.string().max(500).optional().default(''),
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

    const { name, worldType, worldConfig } = parsed.data;

    // Determine if this is a primary scene creation or a config overlay.
    // Config overlays come from the world system registry step — it has
    // worldType but no explicit name (defaults to 'Untitled Scene').
    // Only create a new scene for primary creation steps.
    const isConfigOverlay = (worldType || worldConfig) && name === 'Untitled Scene';

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

    // `worldConfig` is parsed and then dropped. There is no scene-level world
    // build command to send it to: `create_tilemap`, `set_tile` and
    // `create_tileset` are routed in `core/commands/mod.rs` with no handler
    // behind them, so a GDD that specifies a tiled world produces a scene with
    // no world in it. Tracked separately — this executor cannot fix it, and the
    // `if (worldType === 'tiled' || worldConfig) {}` that used to sit here, with
    // an empty body and a comment claiming the config was "stored in step output
    // for downstream use", read like it did.

    // `pendingCameraConfig` used to be returned here, described as something
    // `auto_polish` would apply "once a camera entity exists". Nothing ever read
    // it — the comment was aspirational, not a description — so it was a
    // sanitized value with no consumer, i.e. a drop with extra steps. The camera
    // directive now reaches the engine through `camera_setup`.
    return successResult({
      sceneName: name,
      worldType: worldType ?? null,
    });
  },
};
