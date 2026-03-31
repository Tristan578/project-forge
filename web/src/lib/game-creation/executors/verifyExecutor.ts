import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, failResult } from './shared';

// The verify executor takes no structured input — it reads from ctx.store
const inputSchema = z.object({}).passthrough();

/**
 * Checks whether an entity name suggests it is a camera entity.
 * Convention: entities named "Camera", "camera", or ending with "Camera"/"_cam".
 */
function looksLikeCamera(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'camera' || lower.endsWith('camera') || lower.endsWith('_cam');
}

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

    const { sceneGraph } = ctx.store;
    const nodes = Object.values(sceneGraph.nodes);

    // Check 1: Empty scene
    if (nodes.length === 0) {
      warnings.push('Scene has no entities');
      issues.push('empty_scene');
    }

    // Check 2: No camera entity present
    const hasCamera = nodes.some(node => looksLikeCamera(node.name));
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

    // Check 4: Physics components without colliders
    // We check the physics store for entries where physicsEnabled is true
    // but the physics data has no collider shape info
    const { primaryPhysics, physicsEnabled } = ctx.store;
    if (physicsEnabled && primaryPhysics && !primaryPhysics.colliderShape) {
      warnings.push('Entity has physics enabled but no collider shape configured');
      issues.push('physics_without_collider');
    }

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

    const passed = warnings.length === 0;

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

