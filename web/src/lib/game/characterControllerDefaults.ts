import { PHYSICS_PRESETS, maxApexHeightForAirtime } from '@/lib/ai/physicsFeel';
import {
  characterControllerFromProfile,
  DEFAULT_PRESET_KEY,
} from '@/lib/game-creation/physicsProfileResolution';
import type { CharacterControllerData } from '@/stores/slices/types';

/**
 * What "Add Component -> Character Controller" should hand a creator, and how
 * far the Jump Height slider should go — both of which depend on the project
 * type, because `jumpHeight` does not mean the same thing in the two projects.
 *
 * # Why this is not one number
 *
 * `CharacterControllerData::jump_height` is read by two engine paths
 * (`engine/src/core/game_components.rs`, struct doc comment):
 *
 * * The **kinematic** path — a 3D character with a collider, the normal case —
 *   treats it as an APEX HEIGHT in world units and integrates against gravity.
 * * The **legacy direct-translation** path — every 2D project, and any 3D
 *   character with no collider — has no gravity integrator at all and nudges
 *   the transform by `jump_height * 0.5 * dt`, i.e. reads it as a rise RATE.
 *
 * The engine's own `Default` (8.0) is the value the legacy path was tuned
 * against, and it stays there: converging the two paths means giving the legacy
 * one a real gravity integrator, which is 2D character-controller work. But 8.0
 * as an apex height is a 2.6-second hang time over a 26-foot jump, and that is
 * what the manual Add Component shipped into every 3D project.
 *
 * So the number is chosen here, where the project type is known, and the engine
 * `Default` is left alone.
 */
export type ControllerProjectType = '2d' | '3d';

/**
 * The engine's `CharacterControllerData::default()`, mirrored.
 *
 * Used verbatim for 2D, where it is the value the legacy path's rise-rate
 * arithmetic was tuned against — changing it would make every 2D jump a crawl
 * to fix a 3D problem. Pinned against the Rust source by this module's test, so
 * the mirror cannot drift silently.
 */
const ENGINE_DEFAULT: CharacterControllerData = {
  speed: 5,
  jumpHeight: 8,
  gravityScale: 1,
  canDoubleJump: false,
};

/**
 * The 3D default, DERIVED from the same preset every generated player is built
 * from (`characterSetupExecutor`'s `DEFAULT_CONTROLLER`), not hand-picked.
 *
 * A hand-picked number here would be a fourth movement table alongside
 * `PHYSICS_PRESETS`, the pipeline's fallback and the engine's `Default` — and
 * the last time this repo had three of those, two had already drifted. Deriving
 * it means a character added by hand and a character the pipeline rigs start
 * out feeling the same, which is the only defensible answer to "what should the
 * default be".
 */
const PRESET_DEFAULT: CharacterControllerData = {
  ...characterControllerFromProfile(PHYSICS_PRESETS[DEFAULT_PRESET_KEY]),
  canDoubleJump: false,
};

/** The controller a manually-added component starts with, for this project type. */
export function defaultCharacterController(
  projectType: ControllerProjectType,
): CharacterControllerData {
  return projectType === '2d' ? { ...ENGINE_DEFAULT } : { ...PRESET_DEFAULT };
}

/**
 * The 2D Jump Height slider's ceiling.
 *
 * Unchanged from what the inspector always used. On the legacy path the number
 * is a rise rate with no airtime to bound it, so there is no physical ceiling to
 * derive — 20 is an authoring range, and saying so is more honest than dressing
 * it up as a calculation.
 */
export const JUMP_RATE_SLIDER_MAX_2D = 20;

/**
 * How far the Jump Height slider goes for `projectType`, given the gravity
 * scale the same controller is currently set to.
 *
 * In 3D the ceiling is the airtime cap the generated-game path already enforces
 * ({@link maxApexHeightForAirtime}), so the two paths agree on what counts as a
 * jump rather than a slow ascent. It tracks `gravityScale` because the apex
 * reachable in a fixed airtime scales with gravity: pinning a constant would
 * either cut a heavy-gravity game's jump short or hand a floaty one a range it
 * can never use.
 *
 * `currentValue` raises the ceiling when a controller is already holding
 * something higher — an imported scene, or a value typed before this bound
 * existed. Without it the thumb would sit pinned at the end of the track while
 * the readout showed a larger number, which reads as a broken slider and
 * invites a drag that silently discards the authored value.
 */
export function jumpHeightSliderMax(
  projectType: ControllerProjectType,
  gravityScale: number,
  currentValue: number,
): number {
  const ceiling =
    projectType === '2d' ? JUMP_RATE_SLIDER_MAX_2D : maxApexHeightForAirtime(gravityScale);
  return Number.isFinite(currentValue) && currentValue > ceiling ? currentValue : ceiling;
}

/**
 * The unit shown next to the Jump Height readout, or `null` where the number
 * has no unit to show.
 *
 * 3D is metres — the same world units the Transform panel uses. 2D deliberately
 * shows nothing: the legacy path's number is a rise rate whose unit
 * (`units/second`, halved) is an artifact of the missing integrator rather than
 * anything a creator should be told to reason in. The tooltip carries the
 * caveat instead.
 */
export function jumpHeightUnit(projectType: ControllerProjectType): string | null {
  return projectType === '2d' ? null : 'm';
}
