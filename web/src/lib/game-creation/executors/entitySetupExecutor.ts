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

// Mirrors the engine's `is_valid_override_id` (core/entity_factory.rs): trimmed,
// non-empty, at most 64 BYTES, no control characters. An id the engine rejects is
// not an error there — it silently falls back to a random UUID, which is exactly
// the invisible failure this id exists to prevent. Reject it here instead.
const engineEntityId = z.string().refine((raw) => {
  const id = raw.trim();
  const hasControlChar = [...id].some((c) => {
    const code = c.codePointAt(0)!;
    return code < 0x20 || code === 0x7f;
  });
  return id.length > 0
    && !hasControlChar
    && new TextEncoder().encode(id).length <= 64;
}, 'entityId must be 1-64 bytes with no control characters');

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
    // Manifest: spawn_entity entityType is lowercase enum
    const entityType = projectType === '2d' ? 'plane' : (ROLE_TO_ENTITY_TYPE[entity.role] ?? 'cube');

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

    if (ctx.dispatchCommandBatch) {
      const result = ctx.dispatchCommandBatch(commands);
      if (!result.success) {
        return failResult(
          makeStepError('COMMAND_FAILED', 'Engine command rejected', this.userFacingErrorMessage),
        );
      }
    } else {
      for (const cmd of commands) ctx.dispatchCommand(cmd.command, cmd.payload);
    }

    return successResult({
      entityName: entity.name,
      role: entity.role,
      entityType,
      ...(entityId ? { entityId } : {}),
    });
  },
};
