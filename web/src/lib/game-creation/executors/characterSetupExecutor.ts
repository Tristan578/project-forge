import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { resolveInputPreset } from '../inputPresetResolution';
import { PHYSICS_PRESETS } from '@/lib/ai/physicsFeel';
import {
  characterControllerFromProfile,
  DEFAULT_PRESET_KEY,
  feelDirectiveSchema,
  resolvePhysicsProfile,
} from '../physicsProfileResolution';

/**
 * What the controller looks like when no usable feel directive reached this
 * step — a direct invocation, or a plan whose GDD carried a malformed one.
 *
 * DERIVED, not hardcoded. This used to be a third table of movement numbers
 * (`{ speed: 5, jumpHeight: 2, gravityScale: 1 }`) sitting alongside
 * `PHYSICS_PRESETS` and `CharacterControllerData::default()` in Rust, and it had
 * already drifted from both — its `jumpHeight` of 2 against the engine's 8 and
 * `arcade_classic`'s 10. Deriving it from `DEFAULT_PRESET_KEY` means the
 * no-directive fallback and the unrecognized-feel fallback produce the same
 * player, which is the property the shared resolver exists to guarantee.
 */
const DEFAULT_CONTROLLER = characterControllerFromProfile(
  PHYSICS_PRESETS[DEFAULT_PRESET_KEY],
);

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
  // Deliberately lenient here, strict-parsed separately below. A malformed
  // directive must degrade to the defaults, not fail the whole rig step — and
  // `resolvePresetFromFeel` answers `arcade_classic` for a weight it does not
  // recognise, whose numbers are NOT the defaults. So the only way to actually
  // fall back is to decide usability BEFORE resolving, which means this field
  // cannot be the thing that rejects it.
  feelDirective: z.unknown().optional(),
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
    const { entity, entityId, projectType, systemConfig, movementType } = parsed.data;

    // The GDD's feel directive reaches every system step (planBuilder injects
    // it), but it used to stop here: the plan runs `physics_profile` first and
    // `character_setup` second, and `applyPhysicsProfile` only tunes a
    // CharacterController that ALREADY exists — which the player does not, at
    // that point. So the controller half of the profile was silently skipped
    // and this step then built one from hardcoded numbers, making every
    // generated 3D game move identically no matter what the GDD asked for.
    const feel = feelDirectiveSchema.safeParse(parsed.data.feelDirective);
    const controller = feel.success
      ? characterControllerFromProfile(resolvePhysicsProfile(feel.data, systemConfig))
      : DEFAULT_CONTROLLER;

    // The CharacterController is what makes the player movable, and it is not a
    // 3D-only concern: `system_character_controller` is the only input-driven
    // movement system the engine has, and `core/commands/sprites.rs` exposes no
    // movement verb at all (`set_2d_body_type` / `set_2d_collider_shape` are
    // rapier2d body and collider config, which no input touches). The 2D branch
    // used to add no movement component whatsoever, so every generated 2D game
    // shipped a player that could not move — silently, because the failure is a
    // command that was never sent. The engine maps this controller onto Y under
    // `ProjectType::TwoD` (PF-1124).
    //
    // The properties bag must be COMPLETE, but not for the reason it is tempting
    // to assume. `build_game_component` does NOT strict-deserialize it: it starts
    // from `CharacterControllerData::default()` and merges each key it recognises
    // via `prop_f32`, so a missing field is not rejected — it silently keeps the
    // ENGINE's default, which is a different table from the resolved one
    // (`jump_height` defaults to 8.0 there against the 10 `arcade_classic`
    // yields). A dropped key therefore produces a player that moves with numbers
    // no one chose, and `dispatchCommand` returns void so nothing reports the
    // divergence. Building the store value and converting keeps every field
    // accounted for by the typechecker.
    //
    // Routed through the store rather than `ctx.dispatchCommand` so the two do
    // not disagree: `addGameComponent` normalizes, writes
    // `allGameComponents`, and dispatches the SAME
    // `add_game_component` payload itself. Dispatching directly left the store
    // with no controller for the generated player — the Inspector showed none,
    // so the speed and jump the GDD asked for could not be seen or tuned, and a
    // later store-driven `update_game_component` (`applyPhysicsProfile`) would
    // reason from a store that disagreed with the engine.
    //
    // Normalizing is also what BOUNDS this. `systemConfig` is an LLM-authored
    // bag, so a `moveSpeed: 1e9` reaches here intact; the engine would clamp it
    // to 1000 and this step would report success on a player moving at a speed
    // nothing asked for. `addGameComponent` runs `normalizeGameComponent`, which
    // applies the same per-property ranges the engine does, so the store and the
    // engine agree on the clamped value rather than on the number the model
    // wrote (PF-1147).
    ctx.getStore().addGameComponent(entityId, {
      type: 'characterController',
      characterController: { ...controller, canDoubleJump: false },
    });

    // A controller with no bindings is still an immovable player: the engine
    // ships an EMPTY `InputMap` and `capture_input` has no fallback to
    // `default_bindings()`, so nothing drives the controller until
    // `set_input_preset` is dispatched — which nothing on the generation
    // pipeline ever did. See `inputPresetResolution.ts`.
    ctx.getStore().setInputPreset(resolveInputPreset(projectType, movementType));

    if (projectType === '2d') {
      // 2D also gets the skeleton for skeletal animation. `skeletonData` is
      // optional and the engine defaults it, so an empty rig needs no payload
      // beyond the entity. (This used to dispatch `set_skeleton_2d`, which is
      // not a command the engine implements — the rig was never created.)
      ctx.dispatchCommand('create_skeleton2d', { entityId });
    }

    return successResult({
      entityId,
      entityName: entity.name,
      projectType,
      rigApplied: projectType === '2d',
    });
  },
};
