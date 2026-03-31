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

    // [FIX: NB4] Use the correct command name: "update_ambient_light"
    // Verified against actual source:
    //   - mcp-server/manifest/commands.json: "update_ambient_light"
    //   - web/src/lib/chat/handlers/materialHandlers.ts:
    //     update_ambient_light handler accepts { color, brightness }
    // The command accepts { color: [r,g,b] (0-1), brightness: number }
    if (issues.includes('no_ambient_light')) {
      ctx.dispatchCommand('update_ambient_light', {
        color: [1, 1, 1],
        brightness: 0.3,
      });
      fixes.push('Added ambient lighting');
    }

    if (issues.includes('no_camera_on_player')) {
      ctx.dispatchCommand('set_game_camera', {
        mode: parsed.data.projectType === '2d'
          ? 'SideScroller'
          : 'ThirdPerson',
        followSmoothing: 0.8,
      });
      fixes.push('Added player camera');
    }

    if (issues.includes('no_ground_plane')) {
      ctx.dispatchCommand('spawn_entity', {
        entityType: 'plane',
        name: 'Ground',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 50, y: 1, z: 50 },
      });
      fixes.push('Added ground plane');
    }

    if (issues.includes('player_no_physics')) {
      ctx.dispatchCommand('update_physics', {
        gravityScale: 1,
        friction: 0.5,
      });
      fixes.push('Added physics to player');
    }

    return successResult({
      fixesApplied: fixes,
      fixCount: fixes.length,
    });
  },
};

