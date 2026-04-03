import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';

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

    // [B4] Structural heuristics only -- no telemetry data required

    // [FIX: NB4] update_ambient_light — manifest: { color: [r,g,b] (0-1), brightness: number }
    if (issues.includes('no_ambient_light')) {
      ctx.dispatchCommand('update_ambient_light', {
        color: [1, 1, 1],
        brightness: 0.3,
      });
      fixes.push('Added ambient lighting');
    }

    // set_game_camera — manifest requires { entityId, mode }
    // Every scene has a default Camera entity (Undeletable). Find it from the store
    // and configure it as a player-following camera.
    if (issues.includes('no_camera_on_player')) {
      const nodes = Object.values(ctx.store.sceneGraph.nodes);
      const cameraNode = nodes.find(n => {
        const lower = n.name.toLowerCase();
        return lower === 'camera' || lower.endsWith('camera') || lower.endsWith('_cam');
      });

      if (cameraNode) {
        const mode = parsed.data.projectType === '2d' ? 'sideScroller' : 'thirdPersonFollow';
        ctx.dispatchCommand('set_game_camera', {
          entityId: cameraNode.entityId,
          mode,
          followSmoothing: 0.8,
        });
        fixes.push(`Configured camera as ${mode}`);
      } else {
        fixes.push('Warning: no camera entity found to configure');
      }
    }

    // spawn_entity — manifest: { entityType, name?, position?: [x,y,z] }
    // No 'scale' param — use update_transform after spawn for scaling
    if (issues.includes('no_ground_plane')) {
      ctx.dispatchCommand('spawn_entity', {
        entityType: 'plane',
        name: 'Ground',
        position: [0, 0, 0],
      });
      fixes.push('Added ground plane');
    }

    // update_physics — manifest requires { entityId }
    // verify_all_scenes emits 'physics_without_collider' (not 'player_no_physics')
    if (issues.includes('physics_without_collider')) {
      // Cannot fix without knowing the specific entityId that has the issue.
      // Log it as a warning for the user to address manually.
      fixes.push('Warning: entity has physics without collider — manual fix needed');
    }

    return successResult({
      fixesApplied: fixes,
      fixCount: fixes.length,
    });
  },
};
