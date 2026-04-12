import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';

// Map entity role to valid spawn_entity entityType enum values (lowercase)
// Manifest: entityType enum: cube, sphere, plane, cylinder, cone, torus, capsule, point_light, etc.
const ROLE_TO_ENTITY_TYPE: Record<string, string> = {
  player: 'capsule',
  enemy: 'cube',
  npc: 'cube',
  decoration: 'cube',
  trigger: 'cube',
  interactable: 'cube',
  projectile: 'sphere',
};

const entityBlueprintSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.enum([
    'player', 'enemy', 'npc', 'decoration', 'trigger', 'interactable', 'projectile',
  ]),
  systems: z.array(z.string()).optional(),
  appearance: z.string().optional(),
  behaviors: z.array(z.string()).optional(),
});

const inputSchema = z.object({
  entity: entityBlueprintSchema,
  scene: z.string().min(1),
  projectType: z.enum(['2d', '3d']),
});

export const entitySetupExecutor: ExecutorDefinition = {
  name: 'entity_setup',
  inputSchema,
  userFacingErrorMessage: 'Could not create an entity. It will be skipped.',

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

    const { entity, scene, projectType } = parsed.data;
    // Manifest: spawn_entity entityType is lowercase enum
    const entityType = projectType === '2d' ? 'plane' : (ROLE_TO_ENTITY_TYPE[entity.role] ?? 'cube');

    const commands = [
      { command: 'switch_scene', payload: { sceneId: scene } },
      { command: 'spawn_entity', payload: { entityType, name: entity.name } },
    ];

    if (ctx.dispatchCommandBatch) {
      const result = ctx.dispatchCommandBatch(commands);
      if (!result.success) {
        const failed = result.results.find((r) => !r.success);
        return failResult(
          makeStepError('COMMAND_FAILED', failed?.error ?? 'Batch command failed', this.userFacingErrorMessage),
        );
      }
    } else {
      for (const cmd of commands) ctx.dispatchCommand(cmd.command, cmd.payload);
    }

    return successResult({
      entityName: entity.name,
      role: entity.role,
      entityType,
    });
  },
};
