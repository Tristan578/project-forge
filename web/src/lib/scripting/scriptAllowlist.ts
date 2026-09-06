/**
 * The set of engine commands a user script is permitted to dispatch.
 *
 * This module exists so there is exactly ONE copy of the allowlist. It used to
 * live inside `useScriptRunner.ts` and be hand-copied into
 * `__tests__/scriptSandbox.test.ts` and `__tests__/scriptSecurity.test.ts`,
 * which made every allow/deny assertion in those suites tautological: they
 * asserted a literal against itself and could not notice the shipped allowlist
 * changing underneath them. Both copies had in fact drifted, missing the three
 * `audio_*_snapshot` / `audio_detect_loop_points` names.
 *
 * Deliberately dependency-free — no `@/stores`, no `@/hooks`, no React. The
 * security suites import it, and so does the parity pin
 * `__tests__/scriptAllowlistParity.test.ts`; none of them may drag the editor
 * store into their graph.
 *
 * EVERY NAME HERE IS NOW CHECKED against the engine, by that pin (PF-1180 /
 * #9284). A name is legal exactly two ways, and the pin proves which:
 *
 * - ENGINE — `fn route_domain` names it AND the domain's `pub fn dispatch` has a
 *   non-stub arm for it. Both halves are required: an unrouted name returns 255
 *   and never reaches its module, and an arm answering `Not yet implemented`
 *   does nothing (see `stores/slices/__tests__/commandArmParity.test.ts`).
 * - JS-SIDE — `localScriptCommands.ts` answers it before dispatch and it never
 *   reaches the engine at all. Marked JS-SIDE below.
 *
 * Sixteen names used to be neither. `dispatchCommand` discarded the engine's
 * `Err("Unknown command: …")`, so a script calling `forge.input.vibrate` — a
 * method `forgeTypes.ts` declares and Monaco autocompletes — got no error and no
 * effect. PF-1180 wired nine of them JS-SIDE, deleted the other seven along with
 * the `forge.*` methods and typings that reached them, and made an unanswered
 * dispatch log loudly (`reportDispatchFailure` in `useScriptRunner.ts`).
 *
 * Names deleted rather than fixed, and why:
 *
 * - `set_velocity`, `set_velocity2d`, `set_angular_velocity2d` — the engine's
 *   own spellings (`set_linear_velocity`, `set_linear_velocity_2d`,
 *   `set_angular_velocity_2d`) DO exist, so this looks like the near-miss rename
 *   `paint_tile`/`set_tile` was. It is not: all three are `Not yet implemented`
 *   stubs, so the rename would have swapped one silent no-op for another. There
 *   is no velocity write path in this engine yet (PF-1216 / #9748).
 * - `camera_set_position`, `camera_look_at` — the play-mode camera is derived
 *   from `mode` + `targetEntity` every frame, so a free position is meaningful
 *   only in `fixed` mode and would be silently overwritten in the other five.
 *   `forge.camera.setMode`/`setTarget`/`setProperty` are the real controls.
 * - `stop_skeletal_animation2d`, `set_ik_target2d` — no arm and no near miss:
 *   the engine's 2D skeletal surface has `play_skeletal_animation2d` and
 *   `create_ik_chain2d`, and nothing that stops or re-targets either.
 *
 * `set_tile` / `clear_tiles` / `resize_tilemap` were three more phantoms and are
 * gone; none of the three had ever been an engine command (PF-1181).
 */
export const SCRIPT_ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  // Transform / entity lifecycle
  'update_transform', 'spawn_entity', 'delete_entities',
  'set_visibility', 'update_material',
  // 3D physics
  'apply_force', 'apply_impulse',
  // 2D physics
  'apply_force2d', 'apply_impulse2d', 'set_gravity2d',
  // Audio (routed to WASM)
  'play_audio', 'stop_audio', 'pause_audio', 'set_audio', 'update_audio_bus',
  // Audio layering — JS-SIDE: `localScriptCommands` routes these to
  // `audioManager` and they never reach the engine.
  'audio_add_layer', 'audio_remove_layer', 'audio_remove_all_layers',
  'audio_crossfade', 'audio_play_one_shot', 'audio_fade_in', 'audio_fade_out',
  // Adaptive music — JS-SIDE, the same `audioManager` path as the layering names
  // above. Phantoms until PF-1180 despite reading exactly like their neighbours.
  'set_music_intensity', 'set_music_stems',
  // 3D animation
  'play_animation', 'pause_animation', 'resume_animation', 'stop_animation',
  'set_animation_speed', 'set_animation_loop',
  'set_animation_blend_weight', 'set_clip_speed',
  // Sprite animation — JS-SIDE. These are authoring verbs over the
  // `SpriteAnimator` / `AnimationStateMachine` store components, which dispatch
  // the real `set_sprite_animator` / `set_animation_state_machine` commands.
  'play_sprite_animation', 'stop_sprite_animation',
  'set_sprite_anim_speed', 'set_sprite_anim_param',
  // Particles
  'set_particle_preset', 'toggle_particle', 'burst_particle',
  // Camera — JS-SIDE, through the same game-camera store path the
  // `camera_set_mode` / `camera_set_target` worker messages already use.
  'camera_follow', 'camera_stop_follow',
  // Tilemap — the engine's own names. `set_tile`/`clear_tiles`/`resize_tilemap`
  // used to sit here and none of the three has ever been an engine command
  // (PF-1181).
  'paint_tile', 'erase_tile', 'fill_tiles',
  // Skeletal 2D
  'create_skeleton2d', 'add_bone2d', 'remove_bone2d', 'update_bone2d',
  'set_skeleton2d_skin', 'play_skeletal_animation2d',
  // Input — JS-SIDE: `navigator.vibrate` is a main-thread API a worker cannot
  // reach, and the engine has no notion of a device vibrator.
  'vibrate',
  // Audio snapshots & loop detection — JS-SIDE via `audioManager`
  'audio_save_snapshot', 'audio_load_snapshot', 'audio_detect_loop_points',
  // Scene control
  'stop',
]);

/** True when `name` is a command a user script may dispatch. */
export function isScriptAllowedCommand(name: string): boolean {
  return SCRIPT_ALLOWED_COMMANDS.has(name);
}
