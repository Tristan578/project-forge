import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { toWireComponent } from '@/lib/engine/gameComponentWire';

const inputSchema = z.object({
  // Both required. The engine addresses entities by their `EntityId` component
  // — a UUID, and a separate component from `EntityName` — and its match loops
  // emit nothing when nothing matches, so a command that cannot name the id is
  // a silent no-op. The plan mints the id and the movement system forwards it;
  // a step arriving without one is a programming error, not a data shape to
  // absorb with a default named 'Player' that matches whatever happens to be in
  // the scene.
  // Only the fields this step reads. It used to require `appearance` and
  // `behaviors` and read neither — `appearance` is consumed by `entity_setup` at
  // spawn time and `behaviors` no longer exists, so demanding them here would
  // only fail the rig step on a blueprint that is otherwise fine (PF-1111).
  entity: z.object({
    name: z.string(),
    role: z.string(),
  }),
  entityId: z.string().min(1),
  projectType: z.enum(['2d', '3d']),
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

    // The id is required, so there is no scene-graph name lookup here. The old
    // fallback raced the engine: `entity_setup` dispatches `spawn_entity` and
    // the scene graph is only repopulated when the engine emits back, so the
    // lookup ran against a graph that did not yet contain the entity it wanted
    // and returned ENTITY_NOT_FOUND — which, on a non-optional step, abandoned
    // the whole build.
    const { entity, entityId, projectType } = parsed.data;

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
