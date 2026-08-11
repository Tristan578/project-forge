/**
 * Which engine input preset a generated game's player should be bound to.
 *
 * This exists because the engine ships NO input bindings by default.
 * `InputMap` derives `Default` (an empty action map) and is registered with
 * `init_resource`, and `capture_input` builds `InputState` strictly by iterating
 * `input_map.actions` — there is no fallback to `default_bindings()` anywhere.
 * `InputPreset::default_bindings()` is reachable only through the
 * `set_input_preset` command.
 *
 * So a generated game that never dispatches `set_input_preset` runs
 * `system_character_controller` against an empty `InputState`: every axis and
 * digital lookup misses, `movement.length_squared() > 0.0` is false, and the
 * player never moves. That is the same silent shape as PF-1124 itself — a
 * command that is never sent, and `dispatchCommand` returns void, so nothing
 * anywhere reports it. Adding a CharacterController is necessary but not
 * sufficient; the bindings that drive it are the other half.
 */

/** The four presets `InputPreset::from_str` accepts (`engine/src/core/input.rs`). */
export type EngineInputPreset = 'fps' | 'platformer' | 'topdown' | 'racing';

/**
 * The vocabulary is matched loosely on purpose. `movementType` is
 * `GameSystem.type`, which `systemDecomposer` fills from a keyword table
 * (`walk+jump`, `top-down`, `auto-run`, `vehicle`, `flight`, `walk`) but which
 * is typed `z.string()` and ultimately LLM-authored — so it can arrive as
 * `"side-scroller"`, `"twin stick"`, or anything else. Normalizing to bare
 * alphanumerics and substring-matching keeps an unrecognized phrasing on a
 * sensible preset instead of on no bindings at all.
 */
function normalize(movementType: string | undefined): string {
  return (movementType ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const VEHICLE_HINTS = ['vehicle', 'racing', 'race', 'driving', 'kart', 'car'];
const TOPDOWN_HINTS = ['topdown', 'overhead', 'isometric', 'twinstick', 'zelda'];
const PLATFORMER_HINTS = ['walkjump', 'platformer', 'sidescroll', 'sidescroller', 'jump'];

/**
 * Pick the preset whose bindings the character controller can actually read.
 *
 * The 2D/3D split is load-bearing, because `system_character_controller` reads
 * different actions per project type:
 *
 * - **2D top-down** needs `move_horizontal` AND `move_vertical` — only the
 *   `topdown` preset binds both, and `move_vertical` is exactly what the new 2D
 *   Y-mapping consumes.
 * - **2D platformer** takes `platformer`, which binds `move_horizontal` and
 *   `jump` and deliberately binds NO vertical axis. That is the correct
 *   behaviour rather than an omission: a side-scroller whose player could hold
 *   "up" to translate upward forever would have no level design left. Choosing
 *   the preset is therefore also how vertical walking is gated — no extra flag
 *   on the controller is needed.
 * - **3D** takes `fps`, the only preset binding `move_forward` (the action the
 *   3D branch maps onto -Z) alongside `move_right` and `jump`.
 *
 * The 2D fallback is `topdown` rather than `platformer`: with an unrecognized
 * movement type, two working axes is the outcome that leaves the player
 * controllable in the widest range of designs.
 */
export function resolveInputPreset(
  projectType: '2d' | '3d',
  movementType?: string,
): EngineInputPreset {
  const kind = normalize(movementType);
  const matches = (hints: string[]) => hints.some(h => kind.includes(h));

  // Racing is its own control scheme in both project types.
  if (matches(VEHICLE_HINTS)) return 'racing';

  if (matches(TOPDOWN_HINTS)) return 'topdown';

  if (projectType === '2d') {
    return matches(PLATFORMER_HINTS) ? 'platformer' : 'topdown';
  }

  return 'fps';
}
