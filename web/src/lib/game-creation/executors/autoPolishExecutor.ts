import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { buildSetGameCameraPayload } from '@/lib/game/gameCameraPayload';
import { resolveCameraEntityId } from '../cameraResolution';

// [B4] diagnoseIssues() requires GameMetrics (avgPlayTime, completionRate, etc.)
// which do not exist on a freshly-built game. auto_polish uses STRUCTURAL
// heuristics instead -- checking for common setup problems, not player behavior.

const inputSchema = z.object({
  projectType: z.enum(['2d', '3d']),
  feelDirective: z.object({
    mood: z.string(),
    pacing: z.enum(['slow', 'medium', 'fast']),
    weight: z.enum(['floaty', 'light', 'medium', 'heavy', 'weighty']),
    referenceGames: z.array(z.string()),
    oneLiner: z.string(),
  }),
});

export const autoPolishExecutor: ExecutorDefinition = {
  name: 'auto_polish',
  inputSchema,
  userFacingErrorMessage:
    'Auto-polish could not run. Your game is ready as-is.',

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

    // Read verification results from the prior verify step
    const verifyOutput = ctx.resolveStepOutput('verify_all_scenes');
    const issues = (verifyOutput?.['issues'] as string[]) ?? [];

    const fixes: string[] = [];
    const commands: Array<{ command: string; payload?: unknown }> = [];

    // [B4] Structural heuristics only -- no telemetry data required

    // [FIX: NB4] update_ambient_light — manifest: { color: [r,g,b] (0-1), brightness: number }
    if (issues.includes('no_ambient_light')) {
      commands.push({ command: 'update_ambient_light', payload: { color: [1, 1, 1], brightness: 0.3 } });
      fixes.push('Added ambient lighting');
    }

    // set_game_camera — manifest requires { entityId, mode }
    if (issues.includes('no_camera_on_player')) {
      // Live read: this runs at the end of the pipeline, and the entityId below
      // is dispatched straight to the engine. A snapshot taken before the
      // pipeline started names entities that no longer exist, and
      // `set_game_camera` against a despawned id is a silent no-op (PF-1118).
      // Same heuristic as `camera_setup`, shared rather than copied — two
      // executors resolving "the scene's camera" by different rules is how one
      // of them silently configures nothing.
      const cameraEntityId = resolveCameraEntityId(Object.values(ctx.getStore().sceneGraph.nodes));

      // The issue being fixed is `no_camera_on_player`, and both modes below are
      // follow modes: the engine skips their entire update arm when
      // `target_entity` is `None`, so a targetless "fix" produces a motionless
      // camera while reporting `Configured camera as …` in the user-visible fix
      // list. `character_setup` is the step that rigged the player, and its
      // output carries the id the plan minted for it.
      const playerEntityId = ctx.resolveStepOutput('character_setup')?.['entityId'];
      const targetEntity = typeof playerEntityId === 'string' && playerEntityId.length > 0
        ? playerEntityId
        : null;

      if (cameraEntityId) {
        const mode = parsed.data.projectType === '2d' ? 'sideScroller' : 'thirdPersonFollow';
        // Translated, never flat: the store's authoring names share no key with
        // the engine's wire form, and the engine drops every key it does not
        // recognize without an error (PF-1126).
        //
        // No `followSmoothing` here. It used to send 0.8, read as a 0..1 blend
        // factor — but the engine's `damping` is a RATE PER SECOND
        // (`let t = (damping * delta).min(1.0)`), so 0.8 is roughly six times
        // slower than the default 5.0, and every auto-polished 3D game shipped a
        // sluggish follow camera. Omitting the field is how you ask for the
        // engine default, and it carries no second copy of that number to drift.
        commands.push({
          command: 'set_game_camera',
          payload: buildSetGameCameraPayload(cameraEntityId, {
            mode,
            targetEntity,
          }),
        });
        // Configuring a camera the engine is not rendering through changes
        // nothing a player can see. `game_camera_system`, `first_person_look_system`
        // and `orbital_system` are each `With<ActiveGameCamera>`, and the ONLY
        // things that insert that marker are `set_active_game_camera` and a
        // snapshot restore of a camera that was already active — so
        // `set_game_camera` alone leaves this repair inert in exactly the way it
        // was written to prevent. `camera_setup` pairs the two commands for the
        // same reason.
        commands.push({
          command: 'set_active_game_camera',
          payload: { entityId: cameraEntityId },
        });
        fixes.push(
          targetEntity
            ? `Configured camera as ${mode}`
            : `Configured camera as ${mode}, but found no player for it to follow — it will not move`,
        );
      } else {
        fixes.push('Warning: no camera entity found to configure');
      }
    }

    // spawn_entity — manifest: { entityType, name?, position?: [x,y,z] }
    if (issues.includes('no_ground_plane')) {
      commands.push({ command: 'spawn_entity', payload: { entityType: 'plane', name: 'Ground', position: [0, 0, 0] } });
      fixes.push('Added ground plane');
    }

    // update_physics — manifest requires { entityId }
    if (issues.includes('physics_without_collider')) {
      fixes.push('Warning: entity has physics without collider — manual fix needed');
    }

    if (commands.length > 0) {
      if (ctx.dispatchCommandBatch) {
        const result = ctx.dispatchCommandBatch(commands);
        if (!result.success) {
          return failResult(
            makeStepError('COMMAND_FAILED', 'Engine command rejected', this.userFacingErrorMessage),
          );
        }
      } else {
        for (const cmd of commands) ctx.dispatchCommand(cmd.command, cmd.payload);
      }
    }

    return successResult({
      fixesApplied: fixes,
      fixCount: fixes.length,
    });
  },
};
