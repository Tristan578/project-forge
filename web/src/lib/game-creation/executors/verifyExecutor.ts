import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, failResult } from './shared';
// The same predicate `camera_setup` and `auto_polish` use to find the camera, so
// "this scene has no camera" cannot disagree with "here is the camera".
import { looksLikeCameraName } from '../cameraResolution';

// The verify executor takes no structured input — it reads the live store
const inputSchema = z.object({}).passthrough();

export const verifyExecutor: ExecutorDefinition = {
  name: 'verify_all_scenes',
  inputSchema,
  userFacingErrorMessage:
    'Verification found issues, but your game is still playable.',

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

    const warnings: string[] = [];
    const issues: string[] = [];

    // Live, not the pipeline-start snapshot: `verify_all_scenes` is scheduled
    // after every entity-creation step, so a frozen graph would report on a
    // scene the pipeline has already replaced (empty_scene on a populated one).
    const { sceneGraph } = ctx.getStore();
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

    const passed = warnings.length === 0 && issues.length === 0;

    return {
      success: true,
      output: {
        warnings,
        issues,
        passed,
        entityCount: nodes.length,
      },
    };
  },
};

