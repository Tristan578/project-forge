import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { engineEntityId, sendCommands, waitForEngineFrame } from './engineDispatch';
import { resolveEntityShape } from '../entityShape';

const entityBlueprintSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.enum([
    'player', 'enemy', 'npc', 'decoration', 'trigger', 'interactable', 'projectile',
  ]),
  systems: z.array(z.string()).optional(),
  appearance: z.string().optional(),
});

const inputSchema = z.object({
  entity: entityBlueprintSchema,
  // Optional so a step built before this field existed still runs; when absent the
  // engine assigns its own UUID and nothing downstream can address the entity.
  entityId: engineEntityId.optional(),
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

    // `scene` stays a required input (a plan step that names no scene is malformed)
    // but is not dispatched — see the note on `commands` below.
    const { entity, entityId, projectType } = parsed.data;
    // Manifest: spawn_entity entityType is lowercase enum. Resolved by the
    // shared `entityShape` module rather than a local table, because
    // `physics_enable` has to derive the entity's COLLIDER from the same answer
    // — a second copy here would drift and leave a capsule player floating
    // inside a cuboid collider.
    const entityType = resolveEntityShape(entity.role, entity.appearance, projectType);

    // Spawn into the engine's active scene. The engine holds exactly one scene at a
    // time and rejects `switch_scene` by design — multi-scene management is JS-side
    // (`lib/scenes/sceneManager`), and the plan's `scene` field is JS-side metadata.
    // Leading the batch with it made every entity step fail on the rejection (PF-1097).
    // The engine honors a caller-supplied `id` on spawn_entity (see
    // core/entity_factory.rs `is_valid_override_id`) precisely so JS can address the
    // entity without waiting for the async SELECTION_CHANGED round-trip. Every later
    // step in the plan binds to this id.
    const commands = [
      {
        command: 'spawn_entity',
        payload: { entityType, name: entity.name, ...(entityId ? { id: entityId } : {}) },
      },
    ];

    if (!sendCommands(ctx, commands)) {
      return failResult(
        makeStepError('COMMAND_FAILED', 'Engine command rejected', this.userFacingErrorMessage),
      );
    }

    // The engine applies spawn requests on its frame loop. Do not let the next
    // pipeline step observe the pre-spawn scene graph and reject this entity as
    // missing merely because rendering is slower than the JS pipeline.
    await waitForEngineFrame();

    return successResult({
      entityName: entity.name,
      role: entity.role,
      entityType,
      ...(entityId ? { entityId } : {}),
    });
  },
};
