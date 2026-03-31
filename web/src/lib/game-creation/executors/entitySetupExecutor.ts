import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';

// Map entity role to a default entity type to spawn
const ROLE_TO_ENTITY_TYPE: Record<string, string> = {
  player: 'Cube',
  enemy: 'Cube',
  npc: 'Cube',
  decoration: 'Cube',
  trigger: 'Cube',
  interactable: 'Cube',
  projectile: 'Sphere',
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
    const entityType = projectType === '2d' ? 'Sprite' : (ROLE_TO_ENTITY_TYPE[entity.role] ?? 'Cube');

    ctx.dispatchCommand('spawn_entity', {
      entityType,
      name: entity.name,
      scene,
    });

    return successResult({
      entityName: entity.name,
      role: entity.role,
      entityType,
    });
  },
};

