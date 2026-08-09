import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { toWireComponent } from '@/lib/engine/gameComponentWire';

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

    // When the step carries no entityId, fall back to the store. Entities are
    // already spawned by entity_setup steps in planBuilder Phase 2 — spawning
    // here would create duplicates.
    if (!entityId) {
      // Look up the first entity matching the expected name in the scene graph
      const nodes = Object.values(ctx.store.sceneGraph.nodes);
      entityId = nodes.find(n => n.name === entity.name)?.entityId;
    }

    // No fallback to the entity NAME. The engine addresses entities by their
    // `EntityId` component — a UUID, and a separate component from
    // `EntityName` — and its match loops emit nothing when nothing matches, so
    // a name-bound command is a silent no-op that leaves the player with no
    // CharacterController and no way to move. Fail loudly instead.
    if (!entityId) {
      return failResult(
        makeStepError(
          'ENTITY_NOT_FOUND',
          `No engine entity id for "${entity.name}": the step carried none and no scene-graph node has that name.`,
          this.userFacingErrorMessage,
        ),
      );
    }

    // [B5] Route based on project type
    if (projectType === '2d') {
      // 2D: create the skeleton for skeletal animation. `skeletonData` is optional
      // and the engine defaults it, so an empty rig needs no payload beyond the
      // entity. (This used to dispatch `set_skeleton_2d`, which is not a command
      // the engine implements — the rig was never created.)
      ctx.dispatchCommand('create_skeleton2d', { entityId });
    } else {
      // 3D: add the CharacterController that makes the player movable.
      //
      // The properties bag must be COMPLETE. `build_game_component` deserializes
      // it with strict serde, and `CharacterControllerData` declares no serde
      // defaults, so a bag missing even one field fails to deserialize and the
      // component is dropped — leaving the generated player unable to move, with
      // no error surfaced (`dispatchCommand` returns void). Building the store
      // value and converting keeps every field accounted for by the typechecker.
      ctx.dispatchCommand('add_game_component', {
        entityId,
        ...toWireComponent({
          type: 'characterController',
          characterController: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false },
        }),
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
