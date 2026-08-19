import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError } from './shared';
// The same predicate `camera_setup` and `auto_polish` use to find the camera, so
// "this scene has no camera" cannot disagree with "here is the camera".
import { looksLikeCameraName } from '../cameraResolution';
// The REAL gate. `gameSlice.play()` calls this exact function before allowing
// Edit->Play, so verification and the Play button can no longer disagree
// (PF-1199). Do not restate its rules here — a second copy is how the two
// verdicts drift apart again. Value-import is RSC-safe: the validator's only
// `@/stores/` reference is an `import type`.
import { validateWinnability } from '@/lib/playMode/winnabilityValidator';
import type { WinnabilityReport } from '@/lib/playMode/winnabilityValidator';

// The verify executor takes no structured input — it reads the live store
const inputSchema = z.object({}).passthrough();

/**
 * Render the validator's own findings into the sentence the user reads.
 *
 * The issue TEXT is the validator's, verbatim — this function contributes only
 * the frame and the `[CODE]` prefix. The code is in the user-facing string on
 * purpose: it is the token that ties what the pipeline said to what the Play
 * button will say, and to the ticket if it needs reporting.
 */
function describeUnwinnable(report: WinnabilityReport): string {
  const bullets = report.issues.map(issue => `• [${issue.code}] ${issue.message}`);
  return [
    "This game can't be won yet, so the Play button will refuse it:",
    ...bullets,
    'Add or repair a win condition, then build again.',
  ].join('\n');
}

export const verifyExecutor: ExecutorDefinition = {
  name: 'verify_all_scenes',
  inputSchema,
  // NOT "…but your game is still playable." That sentence was an unconditional
  // playability claim made on the paths where verification could not even run,
  // by an executor that had never checked winnability (PF-1199).
  userFacingErrorMessage:
    'Verification could not confirm your game is playable.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      };
    }

    if (ctx.signal.aborted) {
      return {
        success: false,
        error: makeStepError(
          'ABORTED',
          'Executor was aborted before running',
          this.userFacingErrorMessage,
        ),
      };
    }

    const warnings: string[] = [];
    const issues: string[] = [];

    // Live, not the pipeline-start snapshot: `verify_all_scenes` is scheduled
    // after every entity-creation step, so a frozen graph would report on a
    // scene the pipeline has already replaced (empty_scene on a populated one).
    const { sceneGraph, allGameComponents } = ctx.getStore();
    const nodes = Object.values(sceneGraph.nodes);

    // Check 1: Empty scene
    if (nodes.length === 0) {
      warnings.push('Scene has no entities');
      issues.push('empty_scene');
    }

    // Check 2: No camera entity present
    const hasCamera = nodes.some(node => looksLikeCameraName(node.name));
    if (!hasCamera && nodes.length > 0) {
      warnings.push('No camera entity found in scene');
      issues.push('no_camera_on_player');
    }

    // Check 3: No ambient light
    // Heuristic: if there are entities but no light-related node names
    const hasLight = nodes.some(node => {
      const lower = node.name.toLowerCase();
      return lower.includes('light') || lower.includes('ambient') || lower.includes('sun');
    });
    if (!hasLight && nodes.length > 0) {
      issues.push('no_ambient_light');
    }

    // Check 4: Physics without collider — requires per-entity iteration
    // which is not available from the flat store snapshot. This check is
    // deferred to Phase 2D when the orchestrator has entity-level queries.

    // Check 5: No ground plane heuristic for 3D
    if (ctx.projectType === '3d' && nodes.length > 0) {
      const hasGround = nodes.some(node => {
        const lower = node.name.toLowerCase();
        return lower === 'ground' || lower === 'floor' || lower === 'plane' || lower.includes('ground');
      });
      if (!hasGround) {
        issues.push('no_ground_plane');
      }
    }

    // Check 6: winnability — the only check whose answer the user acts on.
    // Everything above is cosmetic; a scene that fails this one cannot be
    // played at all, so it is the one finding that must fail the step.
    const report = validateWinnability(sceneGraph, allGameComponents ?? {});
    const winnabilityIssues = report.issues.map(issue => issue.code);

    if (!report.winnable) {
      const message = describeUnwinnable(report);
      // Deliberately NOT `failResult()`: that returns `error` alone, and a step
      // error never reaches the panel (`orchestratorError` is only set from a
      // thrown exception). `onStepComplete` DOES fire on the failure branch and
      // `collectStepWarnings` reads `result.output`, so the explanation has to
      // ride on `output.warnings` to be seen at all — PF-1125, one layer up.
      return {
        success: false,
        error: makeStepError('NOT_WINNABLE', message, message),
        output: {
          warnings: [...warnings, message],
          issues,
          passed: false,
          entityCount: nodes.length,
          winnable: false,
          winnabilityIssues,
        },
      };
    }

    const passed = warnings.length === 0 && issues.length === 0;

    return {
      success: true,
      output: {
        warnings,
        issues,
        passed,
        entityCount: nodes.length,
        winnable: true,
        winnabilityIssues,
      },
    };
  },
};
