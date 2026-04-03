import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';

const DEFAULT_PLAYER_ENTITY = {
  name: 'Player',
  role: 'player',
  appearance: 'default character',
  behaviors: ['move'],
};

const inputSchema = z.object({
  entity: z.object({
    name: z.string(),
    role: z.string(),
    appearance: z.string(),
    behaviors: z.array(z.string()),
  }).optional().default(DEFAULT_PLAYER_ENTITY),
  projectType: z.enum(['2d', '3d']),
  entityId: z.string().optional(),
  // Accepted from system registry but not required
  movementType: z.string().optional(),
  systemConfig: z.record(z.string(), z.unknown()).optional(),
});

export const characterSetupExecutor: ExecutorDefinition = {
  name: 'character_setup',
  inputSchema,
  userFacingErrorMessage:
    'Could not set up the character rig. The character will work without animations.',

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

    const { entity, projectType } = parsed.data;
    let { entityId } = parsed.data;

    // When called from system registry (no entityId), resolve from the store.
    // Entities are already spawned by entity_setup steps in planBuilder Phase 2 —
    // spawning here would create duplicates.
    if (!entityId) {
      // Look up the first entity matching the expected name in the scene graph
      const nodes = Object.values(ctx.store.sceneGraph.nodes);
      const match = nodes.find(n => n.name === entity.name);
      entityId = match?.entityId ?? entity.name;
    }

    // [B5] Route based on project type
    if (projectType === '2d') {
      // 2D: dispatch set_skeleton_2d for skeletal animation
      ctx.dispatchCommand('set_skeleton_2d', {
        entityId,
        bones: [],
      });
    } else {
      // 3D: Add CharacterController game component
      // Manifest: add_game_component requires { entityId, componentType }
      //           optional { properties: object }
      ctx.dispatchCommand('add_game_component', {
        entityId,
        componentType: 'character_controller',
        properties: {
          speed: 5,
          jumpHeight: 2,
          gravityScale: 1,
        },
      });
    }

    return successResult({
      entityId,
      entityName: entity.name,
      projectType,
      rigApplied: projectType === '2d',
    });
  },
};
