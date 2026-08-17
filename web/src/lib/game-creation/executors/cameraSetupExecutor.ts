import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { buildSetGameCameraPayload } from '@/lib/game/gameCameraPayload';
import {
  cameraModeNeedsTarget,
  classifyCameraConfigKeys,
  filterCameraNumerics,
  normalizeCameraMode,
  resolveCameraEntityId,
} from '../cameraResolution';
// Type-only: erased at compile time, so this adds no module edge into `@/stores`
// (see `../__tests__/serverSafeImports.test.ts` — this file is reachable from an
// API route and a value-import of the store would break the RSC build).
import type { GameCameraData, GameCameraMode } from '@/stores/slices/types';

/**
 * Apply the GDD's camera directive to the scene's camera entity.
 *
 * This executor exists because the directive used to be DROPPED. The camera
 * system's setup step pointed at `scene_create`, whose camera branch fires only
 * when `cameraConfig.entityId` is a string — and the GDD never supplies one,
 * because at plan time no camera entity exists yet. So the directive was
 * normalized, allowlist-filtered, and returned as `pendingCameraConfig` for a
 * consumer that was never written: grep found zero production readers. Every
 * generated game got the engine's default `thirdPersonFollow`, including the 2D
 * ones, and no test or log could see it (PF-1125).
 *
 * A separate executor rather than a fix inside `scene_create`: the two run at
 * different times. Scene creation happens before any entity is spawned; camera
 * configuration can only happen after, which is precisely the ordering
 * `scene_create` could not express.
 */

const inputSchema = z.object({
  cameraMode: z.string().optional(),
  cameraConfig: z.record(z.string(), z.unknown()).optional(),
  /**
   * The entity the camera follows. Bound at plan time by `systems/camera.ts`
   * from the player-role entity, because the engine addresses entities by their
   * `EntityId` component and no name is usable here.
   *
   * `.min(1)`: an empty string is not "no target", it is a target id that can
   * never match, and it would reach `set_game_camera` as one.
   */
  targetEntityId: z.string().min(1).optional(),
});

export const cameraSetupExecutor: ExecutorDefinition = {
  name: 'camera_setup',
  inputSchema,
  userFacingErrorMessage:
    'Could not configure the game camera. Your game is playable — the camera uses engine defaults.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return failResult(
        makeStepError('INVALID_INPUT', parsed.error.message, this.userFacingErrorMessage),
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

    // Project-type aware: an unrecognized mode in a 2D game means `sideScroller`,
    // not a third-person camera orbiting a flat scene. `autoPolishExecutor` has
    // always branched this way when it repairs a missing camera, so a shared
    // fallback is also what stops the authoring path and the repair path
    // producing two different cameras for the same game.
    const mode: GameCameraMode = normalizeCameraMode(parsed.data.cameraMode, ctx.projectType);

    // Live read. The camera entity is spawned by an earlier step in the same
    // pipeline, so a snapshot taken at pipeline start cannot see it — and
    // `set_game_camera` against an id the engine does not have is a silent no-op
    // (PF-1118).
    const entityId = resolveCameraEntityId(Object.values(ctx.getStore().sceneGraph.nodes));

    if (!entityId) {
      // Not a failure: the game still plays on the engine's default camera, and
      // failing the step would abort a pipeline over a cosmetic gap. But it is
      // reported rather than swallowed, so the directive going unapplied is
      // visible in the step output instead of being indistinguishable from
      // success — which is how PF-1125 stayed invisible for as long as it did.
      return successResult({
        cameraMode: mode,
        applied: false,
        warning: 'No camera entity found in the scene — camera directive not applied',
      });
    }

    // Spread of an already-projected object, not of the raw GDD config:
    // `filterCameraNumerics` returns only own, finite values under keys drawn from
    // the translator's own field list, so this carries nothing the model chose.
    // The wire form is then PICKED key-by-key by `buildSetGameCameraPayload` —
    // a `satisfies` on a spread is inert, so picking is the only construction
    // that actually constrains what reaches the engine (PF-1126).
    const targetEntity = parsed.data.targetEntityId ?? null;

    const cameraData: Partial<GameCameraData> & { mode: GameCameraMode } = {
      mode,
      targetEntity,
      ...filterCameraNumerics(parsed.data.cameraConfig),
    };

    ctx.dispatchCommand('set_game_camera', buildSetGameCameraPayload(entityId, cameraData));
    // Configuring a camera the engine is not rendering through would be a no-op
    // from the player's point of view, so activation is part of the same step.
    ctx.dispatchCommand('set_active_game_camera', { entityId });

    // A follow mode with no target is the failure this executor exists to
    // prevent, one layer down: the engine skips its entire update arm, so the
    // camera keeps the mode and never moves. Report it rather than letting
    // `applied: true` stand in for "the player will see what the GDD asked
    // for" — the plan-time warning in `systems/camera.ts` catches the case the
    // plan can see, and this catches the rest.
    const warnings: string[] = [];

    if (targetEntity === null && cameraModeNeedsTarget(mode)) {
      warnings.push(
        `Camera set to ${mode} but nothing was given for it to follow — it will not move.`,
      );
    }

    // The GDD's camera vocabulary and the engine's parameter list were authored
    // independently and barely overlap, so most directives carry keys that reach
    // the engine as nothing. Dropping them is the honest outcome — a guessed unit
    // conversion would aim the camera wrongly rather than not at all — but
    // dropping them SILENTLY is the PF-1125 defect itself, one field down.
    //
    // One sentence per reason, because the reason is what the author acts on: an
    // unrecognized key needs a different key, a bad value needs a different
    // value, and a duplicate spelling needs neither. They shared a sentence that
    // named only the first case, so the other two were reported as something
    // they are not.
    const report = classifyCameraConfigKeys(parsed.data.cameraConfig);
    if (report.unknown.length > 0) {
      warnings.push(
        `Camera settings the engine has no parameter for were ignored: ${report.unknown.join(', ')}.`,
      );
    }
    if (report.unusable.length > 0) {
      const detail = report.unusable.map(({ key, reason }) => `${key} (${reason})`).join(', ');
      warnings.push(`Camera settings the engine cannot accept were ignored: ${detail}.`);
    }
    if (report.overridden.length > 0) {
      const detail = report.overridden
        .map(({ key, field }) => `${key} (superseded by ${field})`)
        .join(', ');
      warnings.push(`Camera settings given twice kept the engine spelling: ${detail}.`);
    }

    return successResult({
      cameraMode: mode,
      cameraEntityId: entityId,
      targetEntityId: targetEntity,
      applied: true,
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
    });
  },
};
