import { z } from 'zod';
import { generateRig, rigToCommands } from '@/lib/ai/autoRigging';
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

    // When called from system registry (no entityId), spawn the character entity first
    if (!entityId) {
      entityId = `player_${crypto.randomUUID().slice(0, 8)}`;
      ctx.dispatchCommand('spawn_entity', {
        entityId,
        name: entity.name,
        type: projectType === '2d' ? 'Sprite' : 'Cube',
      });
    }

    // [B5] Route based on project type
    if (projectType === '2d') {
      // 2D: rigToCommands emits set_skeleton_2d -- correct for 2D
      const rig = await generateRig(entity.appearance);
      const commands = rigToCommands(rig, entityId);
      for (const cmd of commands) {
        ctx.dispatchCommand(cmd.command, cmd.payload);
      }
    } else {
      // 3D: Use game components for character controller
      // autoRigging.rigToCommands emits set_skeleton_2d which is 2D-only.
      // For 3D, we add a CharacterController game component instead.
      ctx.dispatchCommand('add_game_component', {
        entityId,
        componentType: 'character_controller',
        speed: 5,
        jumpHeight: 2,
        gravityScale: 1,
      });
    }

    return successResult({
      entityId,
      projectType,
      rigApplied: projectType === '2d',
    });
  },
};

